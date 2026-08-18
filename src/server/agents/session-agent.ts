import { Agent, callable, getAgentByName } from 'agents'
import { getSandbox } from '@cloudflare/sandbox'
import { createOpencode } from '@cloudflare/sandbox/opencode'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { buildOpencodeConfig, hasProviderKey } from '../opencode-config'
import { OpencodeMapper, isSessionIdle } from '../harness/opencode-map'
import { applyEvent, emptyTranscript } from '~shared/agent-reduce'
import type { AgentEvent, NormTurn, PermissionReply, SessionStatus, TranscriptState } from '~shared/agent'
import type {
  Connections,
  Harness,
  Provider,
  SessionMode,
  SessionSource,
} from '~shared/protocol'

interface SessionConfig {
  owner: string
  source: SessionSource
  harness: Harness
  provider: Provider
  model: string
  name: string
  repo: string
  branch: string
}

interface SessionMeta {
  id: string
  name: string
  repo: string
  branch: string
  harness: Harness
  provider: Provider
  model: string
  region: string
  createdAt: string
  lastActivity: string
}

interface SessionAgentState {
  meta: SessionMeta | null
  status: SessionStatus
  mode: SessionMode
  usage: { tokensIn: number; tokensOut: number; costUsd: number }
}

interface TurnRow {
  id: string
  seq: number
  data_json: string
}

/**
 * One instance per session (name = session id). Thin supervisor: owns the Sandbox + the OpenCode
 * server, PERSISTS the transcript as turns/parts, owns the authoritative status (driven by real
 * harness events — never the client), and relays a normalized AgentEvent stream to the browser.
 */
export class SessionAgent extends Agent<Env, SessionAgentState> {
  initialState: SessionAgentState = {
    meta: null,
    status: 'idle',
    mode: 'build',
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
  }

  private opencode?: OpencodeClient
  private opencodeSessionId?: string
  private mapper = new OpencodeMapper()
  private transcript: TranscriptState = emptyTranscript()
  private hydrated = false

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, data_json TEXT NOT NULL)`
    this.sql`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`
  }

  private hydrate() {
    if (this.hydrated) return
    const rows = this.sql<TurnRow>`SELECT id, seq, data_json FROM turns ORDER BY seq ASC`
    this.transcript = {
      turns: rows.map((r) => JSON.parse(r.data_json) as NormTurn),
      todos: this.getKv<TranscriptState['todos']>('todos', []),
      permissions: this.getKv<TranscriptState['permissions']>('permissions', []),
    }
    this.hydrated = true
  }

  private getKv<T>(key: string, fallback: T): T {
    const rows = this.sql<{ v: string }>`SELECT v FROM kv WHERE k = ${key}`
    if (!rows.length) return fallback
    try {
      return JSON.parse(rows[0].v) as T
    } catch {
      return fallback
    }
  }
  private putKv(key: string, value: unknown) {
    this.sql`INSERT INTO kv (k, v) VALUES (${key}, ${JSON.stringify(value)})
             ON CONFLICT(k) DO UPDATE SET v = excluded.v`
  }

  // --- seeding + config ---------------------------------------------------------------------
  init(config: SessionConfig): { ok: true } {
    this.putKv('config', config)
    const meta: SessionMeta = {
      id: this.name,
      name: config.name,
      repo: config.repo,
      branch: config.branch,
      harness: config.harness,
      provider: config.provider,
      model: config.model,
      region: 'iad1',
      createdAt: new Date().toISOString(),
      lastActivity: 'now',
    }
    const status: SessionStatus = config.source.kind === 'blank' ? 'idle' : 'idle'
    this.setState({ ...this.state, meta, status })
    return { ok: true }
  }

  private config(): SessionConfig {
    const c = this.getKv<SessionConfig | null>('config', null)
    if (!c) throw new Error('session not initialized')
    return c
  }

  private async connections(): Promise<Connections> {
    const user = await getAgentByName(this.env.UserAgent, this.config().owner)
    return (await user.getDecryptedConnections()) as Connections
  }

  private setStatus(status: SessionStatus) {
    this.setState({ ...this.state, status, meta: this.state.meta ? { ...this.state.meta, lastActivity: 'now' } : null })
    const cfg = this.getKv<SessionConfig | null>('config', null)
    if (cfg) {
      void getAgentByName(this.env.UserAgent, cfg.owner).then((u) =>
        u.upsertSessionSummary({ id: this.name, status, lastActivity: 'now', costUsd: this.state.usage.costUsd }),
      )
    }
  }

  // --- transcript persistence + broadcast ---------------------------------------------------
  private nextSeq(): number {
    const rows = this.sql<{ m: number | null }>`SELECT MAX(seq) as m FROM turns`
    return (rows[0]?.m ?? 0) + 1
  }

  private persistTurn(turnId: string, seq?: number) {
    const turn = this.transcript.turns.find((t) => t.id === turnId)
    if (!turn) return
    const existing = this.sql<{ seq: number }>`SELECT seq FROM turns WHERE id = ${turnId}`
    const s = existing.length ? existing[0].seq : (seq ?? this.nextSeq())
    this.sql`INSERT INTO turns (id, seq, data_json) VALUES (${turnId}, ${s}, ${JSON.stringify(turn)})
             ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json`
  }

  /** Apply one AgentEvent to the in-memory transcript, persist what changed, broadcast to clients. */
  private emit(ev: AgentEvent) {
    this.transcript = applyEvent(this.transcript, ev)
    switch (ev.t) {
      case 'turn.start':
        this.persistTurn(ev.turn.id, this.nextSeq())
        break
      case 'turn.update':
        this.persistTurn(ev.id)
        break
      case 'part.upsert':
      case 'part.delta':
      case 'part.remove':
        this.persistTurn(ev.turnId)
        break
      case 'usage': {
        const last = this.transcript.turns[this.transcript.turns.length - 1]
        if (last) this.persistTurn(last.id)
        this.setState({
          ...this.state,
          usage: {
            tokensIn: ev.usage.input,
            tokensOut: ev.usage.output + (ev.usage.reasoning ?? 0),
            costUsd: ev.usage.cost ?? this.state.usage.costUsd,
          },
        })
        break
      }
      case 'todos':
        this.putKv('todos', this.transcript.todos)
        break
      case 'permission.ask':
      case 'permission.resolve':
        this.putKv('permissions', this.transcript.permissions)
        break
    }
    this.broadcast(JSON.stringify({ t: 'agent', event: ev }))
  }

  @callable()
  getTurns(): { turns: NormTurn[]; todos: TranscriptState['todos']; permissions: TranscriptState['permissions']; status: SessionStatus } {
    this.hydrate()
    return {
      turns: this.transcript.turns,
      todos: this.transcript.todos,
      permissions: this.transcript.permissions,
      status: this.state.status,
    }
  }

  // --- OpenCode lifecycle -------------------------------------------------------------------
  private async ensureOpencode(): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    const { config } = buildOpencodeConfig(cfg.provider, cfg.model, conn)
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '20m' })
    const booted = createOpencode(sandbox, { directory: '/workspace', config })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('OpenCode did not start in the sandbox within 120s.')), 120_000),
    )
    const { client } = (await Promise.race([booted, timeout])) as Awaited<typeof booted>
    this.opencode = client
  }

  private async ensureOpencodeSession(): Promise<string> {
    if (this.opencodeSessionId) return this.opencodeSessionId
    const stored = this.getKv<string | null>('opencodeSessionId', null)
    if (stored) {
      this.opencodeSessionId = stored
      return stored
    }
    const res = await this.opencode!.session.create({ title: this.state.meta?.name ?? 'session' }, { throwOnError: true } as never)
    const id = (res as { data?: { id?: string } }).data?.id ?? (res as { id?: string }).id
    if (!id) throw new Error('opencode session create returned no id')
    this.opencodeSessionId = id
    this.putKv('opencodeSessionId', id)
    return id
  }

  // --- the turn -----------------------------------------------------------------------------
  @callable()
  async sendMessage(input: { text: string; messageId?: string }): Promise<{ ok: true }> {
    this.hydrate()
    const id = input.messageId ?? `u-${crypto.randomUUID()}`
    const userTurn: NormTurn = {
      id,
      role: 'user',
      createdAt: Date.now(),
      status: 'complete',
      parts: [{ kind: 'text', id: `${id}:text`, text: input.text }],
    }
    this.emit({ t: 'turn.start', turn: userTurn })
    this.setStatus('busy')
    void this.runTurn(input.text).catch((err) => {
      const message = (err as Error).message
      console.error('[dreamweav] turn failed:', (err as Error).stack ?? err)
      const errId = `err-${Date.now()}`
      this.emit({
        t: 'turn.start',
        turn: { id: errId, role: 'assistant', createdAt: Date.now(), status: 'error', error: { name: 'error', message }, parts: [{ kind: 'error', id: `${errId}:e`, name: 'error', message }] },
      })
      this.setStatus('error')
    })
    return { ok: true }
  }

  private async runTurn(text: string): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    if (!hasProviderKey(cfg.provider, conn)) {
      throw new Error(`No ${cfg.provider} key set. Open Settings and add your key.`)
    }

    this.setStatus('booting')
    await this.ensureOpencode()
    const ocSession = await this.ensureOpencodeSession()
    this.setStatus('busy')
    this.mapper.reset()

    const events = await this.opencode!.event.subscribe()
    await this.opencode!.session.promptAsync({ sessionID: ocSession, parts: [{ type: 'text', text }] } as never)

    const deadline = Date.now() + 5 * 60 * 1000
    try {
      for await (const ev of (events as { stream: AsyncIterable<Record<string, unknown>> }).stream) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for the agent (5 min).')
        for (const ae of this.mapper.map(ev)) this.emit(ae)
        if (isSessionIdle(ev, ocSession)) break
      }
    } finally {
      // Finalize: clear streaming flags + mark the active assistant turn complete.
      for (const turn of this.transcript.turns) {
        if (turn.role !== 'assistant' || turn.status !== 'streaming') continue
        this.emit({ t: 'turn.update', id: turn.id, patch: { status: 'complete', completedAt: Date.now() } })
        for (const part of turn.parts) {
          if ((part.kind === 'text' || part.kind === 'reasoning') && part.streaming) {
            this.emit({ t: 'part.upsert', turnId: turn.id, part: { ...part, streaming: false } })
          }
        }
      }
    }
    this.setStatus('idle')
  }

  @callable()
  async stop(): Promise<{ ok: true }> {
    if (this.opencode && this.opencodeSessionId) {
      try {
        await this.opencode.session.abort({ sessionID: this.opencodeSessionId } as never)
      } catch {
        /* ignore */
      }
    }
    this.setStatus('idle')
    return { ok: true }
  }

  @callable()
  async respondPermission(id: string, reply: PermissionReply, note?: string): Promise<{ ok: true }> {
    this.emit({ t: 'permission.resolve', id })
    try {
      if (this.opencode) {
        await this.opencode.permission.reply({ requestID: id, reply, message: note } as never)
      }
    } catch (e) {
      console.error('[dreamweav] permission reply failed', e)
    }
    return { ok: true }
  }

  @callable()
  setMode(mode: SessionMode): { ok: true } {
    this.setState({ ...this.state, mode })
    return { ok: true }
  }

  @callable()
  setModel(model: string): { ok: true } {
    const cfg = this.config()
    this.putKv('config', { ...cfg, model })
    if (this.state.meta) this.setState({ ...this.state, meta: { ...this.state.meta, model } })
    void getAgentByName(this.env.UserAgent, cfg.owner).then((u) => u.upsertSessionSummary({ id: this.name, model }))
    return { ok: true }
  }

  @callable()
  rename(name: string): { ok: true } {
    if (this.state.meta) this.setState({ ...this.state, meta: { ...this.state.meta, name } })
    void getAgentByName(this.env.UserAgent, this.config().owner).then((u) => u.upsertSessionSummary({ id: this.name, name }))
    return { ok: true }
  }

  // --- workspace (files, preview) — used by the workspace dock ------------------------------
  @callable()
  async listFiles(path = '/workspace'): Promise<{ files: { name: string; path: string; isDirectory: boolean; size: number }[] }> {
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    try {
      const files = (await sandbox.listFiles(path)) as unknown as { name: string; path: string; isDirectory: boolean; size: number }[]
      return { files }
    } catch {
      return { files: [] }
    }
  }

  @callable()
  async readFile(path: string): Promise<{ content: string | null }> {
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    try {
      const res = (await sandbox.readFile(path)) as { content?: string }
      return { content: res.content ?? null }
    } catch {
      return { content: null }
    }
  }

  @callable()
  async exposePort(port: number, hostname = 'dreamweav.com'): Promise<{ url: string | null }> {
    // Preview URLs require a custom domain with wildcard DNS (*.dreamweav.com). Until that is
    // wired the returned URL won't resolve — the client shows a "preview needs the domain" state.
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    try {
      const res = (await sandbox.exposePort(port, { hostname })) as { url?: string }
      return { url: res.url ?? null }
    } catch {
      return { url: null }
    }
  }
}
