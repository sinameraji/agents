import { Agent, callable, getAgentByName } from 'agents'
import { getSandbox } from '@cloudflare/sandbox'
import { createOpencode } from '@cloudflare/sandbox/opencode'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { buildOpencodeConfig, hasProviderKey } from '../opencode-config'
import { mapPart, usageFromInfo, isAssistantComplete } from '../harness/opencode-map'
import { runCfAgentLoop, summarizeMessages } from '../harness/cfagent'
import type { ModelMessage } from 'ai'
// The bridge (pi/KimiFlare/AI-SDK host) ships INSIDE the worker and is written into the container
// at runtime, so its version always matches this deploy — no image rebuilds, no warm-pool staleness.
import bridgeSource from '../../../bridge/dist/bridge.mjs?raw'
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

const BRIDGE_HASH = (() => {
  let h = 5381
  for (let i = 0; i < bridgeSource.length; i++) h = ((h * 33) ^ bridgeSource.charCodeAt(i)) >>> 0
  return h.toString(16)
})()
const BRIDGE_PATH = '/tmp/dw-bridge.mjs'

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
  private emittedParts = new Map<string, string>()
  private cfAbort: AbortController | null = null
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
    // Self-heal: a deploy can kill an isolate mid-turn, leaving status stuck on busy/booting.
    // If nothing has progressed in 5 minutes, the run is dead — report idle (or error if the
    // last assistant turn errored) and sync the sidebar.
    if (this.state.status === 'busy' || this.state.status === 'booting') {
      const last = this.transcript.turns[this.transcript.turns.length - 1]
      const lastActivity = last ? Math.max(last.createdAt, last.completedAt ?? 0) : 0
      if (Date.now() - lastActivity > 5 * 60 * 1000) {
        const errored = last?.role === 'assistant' && last.status === 'error'
        this.setStatus(errored ? 'error' : 'idle')
      }
    }
    return {
      turns: this.transcript.turns,
      todos: this.transcript.todos,
      permissions: this.transcript.permissions,
      status: this.state.status,
    }
  }

  // --- workspace hydration + persistence ----------------------------------------------------
  /** Restore a prior snapshot, or clone the source repo, if the container's /workspace is empty. */
  private async ensureWorkspace(sandbox: ReturnType<typeof getSandbox>): Promise<void> {
    const empty = await sandbox
      .exec('sh -lc \'[ -z "$(ls -A /workspace 2>/dev/null)" ] && echo EMPTY || echo FULL\'')
      .then((r) => (r as { stdout?: string }).stdout?.includes('EMPTY'))
      .catch(() => false)
    if (!empty) return

    const backup = this.getKv<{ id: string; dir: string; localBucket?: boolean } | null>('backup', null)
    if (backup) {
      try {
        await sandbox.restoreBackup(backup as never)
        return
      } catch (e) {
        console.error('[dreamweav] restore failed', e)
      }
    }

    const cfg = this.config()
    if (cfg.source.kind === 'github') {
      const conn = await this.connections()
      const url = cfg.source.url.replace(/\.git$/, '').replace(/\/$/, '')
      const auth = conn.githubPat ? url.replace('https://github.com/', `https://x-access-token:${conn.githubPat}@github.com/`) : url
      const branch = cfg.source.branch ? `-b ${cfg.source.branch}` : ''
      await sandbox.exec(`sh -lc 'cd /workspace && git clone --depth 50 ${branch} ${auth}.git . 2>&1 | tail -3'`).catch((e) => {
        console.error('[dreamweav] clone failed', e)
      })
    }
  }

  /** Copy uploaded files from R2 into the sandbox at /workspace/uploads/. */
  private async copyAttachments(attachments: { key: string; name: string; size: number }[]): Promise<void> {
    try {
      const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '10m' })
      await sandbox.mkdir('/workspace/uploads', { recursive: true }).catch(() => null)
      for (const att of attachments) {
        const obj = await this.env.STORE.get(att.key)
        if (!obj) continue
        const bytes = new Uint8Array(await obj.arrayBuffer())
        await sandbox.writeFile(`/workspace/uploads/${att.name}`, bytes as never).catch((e) => {
          console.error('[dreamweav] attachment copy failed', att.name, e)
        })
      }
    } catch (e) {
      console.error('[dreamweav] copyAttachments failed', e)
    }
  }

  /** Snapshot /workspace to R2 so it survives container sleep. */
  private async checkpoint(): Promise<void> {
    try {
      const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
      const backup = await sandbox.createBackup({
        dir: '/workspace',
        excludes: ['node_modules', '.git/objects', '*.log', '.cache', 'dist', '.next'],
        localBucket: true,
        ttl: 7 * 24 * 60 * 60,
      } as never)
      this.putKv('backup', backup)
    } catch (e) {
      console.error('[dreamweav] checkpoint failed', e)
    }
  }

  // --- bridge harnesses (pi / KimiFlare / built-in AI SDK) ---------------------------------
  private bridgeStarted = false

  private async ensureBridge(): Promise<ReturnType<typeof getSandbox>> {
    const cfg = this.config()
    const conn = await this.connections()
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '10m' })
    await this.ensureWorkspace(sandbox)
    // (Re)start the bridge process and confirm it's healthy (it may have died on container restart).
    const healthy = await this.bridgeFetch(sandbox, 'GET', '/health')
      .then((r) => (r?.ok ?? false) && (r?.json as { rev?: string })?.rev === BRIDGE_HASH)
      .catch(() => false)
    if (!healthy) {
      this.bridgeStarted = false
      // Kill any stale bridge, write THIS deploy's bridge into the container, and launch it.
      await sandbox.exec("sh -lc 'pkill -f dw-bridge.mjs || true'").catch(() => null)
      await sandbox.writeFile(BRIDGE_PATH, bridgeSource)
      const startRes = await sandbox
        .exec(`sh -lc 'BRIDGE_REV=${BRIDGE_HASH} nohup node ${BRIDGE_PATH} > /tmp/bridge.log 2>&1 & echo started'`)
        .then((r) => (r as { stdout?: string }).stdout ?? '')
        .catch((e) => `start-error: ${String(e)}`)
      let ok = false
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const h = await this.bridgeFetch(sandbox, 'GET', '/health').catch(() => null)
        ok = (h?.ok ?? false) && (h?.json as { rev?: string })?.rev === BRIDGE_HASH
        if (ok) break
      }
      if (!ok) {
        const log = await sandbox
          .exec("sh -lc 'tail -c 500 /tmp/bridge.log 2>/dev/null || echo NO_LOG'")
          .then((r) => (r as { stdout?: string }).stdout ?? '')
          .catch(() => 'log-read-fail')
        throw new Error(`Bridge did not start. start=${startRes.trim()}; log=${log.trim()}`)
      }
    }
    if (!this.bridgeStarted) {
      const res = await this.bridgeFetch(sandbox, 'POST', '/start', {
        harness: cfg.harness,
        config: { provider: cfg.provider, model: cfg.model, cwd: '/workspace', mode: this.state.mode, creds: conn },
      })
      if (!res?.ok) throw new Error('Bridge failed to start the harness.')
      this.bridgeStarted = true
    }
    return sandbox
  }

  private async bridgeFetch(sandbox: ReturnType<typeof getSandbox>, method: string, path: string, body?: unknown): Promise<{ ok: boolean; json: unknown } | null> {
    try {
      const res = await sandbox.containerFetch(
        `http://localhost:7700${path}`,
        { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) },
        7700,
      )
      const json = await res.json().catch(() => ({}))
      return { ok: res.ok, json }
    } catch {
      return null
    }
  }

  /** The Cloudflare-native harness: the agent loop runs right here in the DO, streaming live. */
  private async runCfAgentTurn(text: string): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    if (!hasProviderKey(cfg.provider, conn)) {
      throw new Error(`No ${cfg.provider} key set. Open Settings and add your key.`)
    }

    this.setStatus('booting')
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '10m' })
    await this.ensureWorkspace(sandbox)
    this.setStatus('busy')

    const history = this.getKv<ModelMessage[]>('cfagent:messages', [])
    history.push({ role: 'user', content: text })

    const turnId = `a-${crypto.randomUUID()}`
    this.emit({
      t: 'turn.start',
      turn: { id: turnId, role: 'assistant', createdAt: Date.now(), status: 'streaming', model: { providerId: cfg.provider, modelId: cfg.model }, parts: [] },
    })
    this.cfAbort = new AbortController()

    try {
      const { text: finalText, usage } = await runCfAgentLoop({
        sandbox,
        provider: cfg.provider,
        model: cfg.model,
        creds: conn,
        mode: this.state.mode,
        messages: history,
        signal: this.cfAbort.signal,
        emit: {
          part: (part) => this.emit({ t: 'part.upsert', turnId, part }),
          usage: (usage) => this.emit({ t: 'usage', usage }),
        },
      })
      history.push({ role: 'assistant', content: finalText })
      this.putKv('cfagent:messages', history.slice(-40))
      this.emit({ t: 'turn.update', id: turnId, patch: { status: 'complete', usage, completedAt: Date.now() } })
      this.setStatus('idle')
      await this.checkpoint()
    } catch (e) {
      const message = (e as Error).message
      const aborted = this.cfAbort?.signal.aborted ?? false
      this.emit({ t: 'part.upsert', turnId, part: { kind: 'error', id: `${turnId}:err`, name: aborted ? 'aborted' : 'error', message: aborted ? 'Stopped.' : message } })
      this.emit({ t: 'turn.update', id: turnId, patch: { status: aborted ? 'aborted' : 'error', completedAt: Date.now(), error: aborted ? undefined : { name: 'error', message } } })
      this.setStatus(aborted ? 'idle' : 'error')
    } finally {
      this.cfAbort = null
    }
  }

  private async runBridgeTurn(text: string): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    if (cfg.harness === 'kimiflare') {
      if (!conn.cloudflareAccountId || !conn.cloudflareApiToken) {
        throw new Error('KimiFlare runs on YOUR Cloudflare account: add your Cloudflare Account ID and API token (and optionally an AI Gateway id) in Settings → Cloudflare AI Gateway.')
      }
      const verify = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${conn.cloudflareApiToken}` },
      }).then((r) => r.json() as Promise<{ success?: boolean }>).catch(() => ({ success: false }))
      if (!verify.success) {
        throw new Error('Your Cloudflare API token was rejected (invalid or expired). Create a fresh token with Workers AI + AI Gateway permissions and update it in Settings → Cloudflare AI Gateway.')
      }
    } else if (!hasProviderKey(cfg.provider, conn)) {
      throw new Error(`No ${cfg.provider} key set. Open Settings and add your key.`)
    }

    this.setStatus('booting')
    const sandbox = await this.ensureBridge()
    this.setStatus('busy')
    this.emittedParts.clear()

    await this.bridgeFetch(sandbox, 'POST', '/prompt', { text })
    const turnId = `a-${crypto.randomUUID()}`
    this.emit({ t: 'turn.start', turn: { id: turnId, role: 'assistant', createdAt: Date.now(), status: 'streaming', parts: [] } })

    const deadline = Date.now() + 8 * 60 * 1000
    let stable = 0
    let lastSnapshot = ''
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 600))
        const res = await this.bridgeFetch(sandbox, 'GET', '/state')
        const state = (res?.json ?? {}) as { status?: string; turns?: NormTurn[]; todos?: TranscriptState['todos']; permissions?: TranscriptState['permissions'] }
        // The bridge's last assistant turn holds this prompt's parts.
        const assistant = [...(state.turns ?? [])].reverse().find((t) => t.role === 'assistant')
        if (assistant) {
          for (const part of assistant.parts) {
            const ser = JSON.stringify(part)
            if (this.emittedParts.get(part.id) === ser) continue
            this.emittedParts.set(part.id, ser)
            this.emit({ t: 'part.upsert', turnId, part })
          }
          if (assistant.usage) this.emit({ t: 'usage', usage: assistant.usage })
          if (assistant.error) {
            const errPartId = `${turnId}:err`
            const ser = JSON.stringify(assistant.error)
            if (this.emittedParts.get(errPartId) !== ser) {
              this.emittedParts.set(errPartId, ser)
              this.emit({ t: 'part.upsert', turnId, part: { kind: 'error', id: errPartId, name: assistant.error.name, message: assistant.error.message } })
              this.emit({ t: 'turn.update', id: turnId, patch: { status: 'error', error: assistant.error } })
            }
          }
        }
        for (const perm of state.permissions ?? []) this.emit({ t: 'permission.ask', permission: perm })
        if (state.todos?.length) this.emit({ t: 'todos', todos: state.todos })
        const snapshot = JSON.stringify(assistant?.parts?.length ?? 0) + (state.status ?? '')
        if (snapshot === lastSnapshot) stable += 1
        else stable = 0
        lastSnapshot = snapshot
        if (state.status === 'idle' && stable >= 1) break
      }
    } finally {
      for (const turn of this.transcript.turns) {
        if (turn.role === 'assistant' && turn.status === 'streaming') this.emit({ t: 'turn.update', id: turn.id, patch: { status: 'complete', completedAt: Date.now() } })
      }
    }
    this.setStatus('idle')
    await this.checkpoint()
  }

  // --- OpenCode lifecycle -------------------------------------------------------------------
  private async ensureOpencode(): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    const { config } = buildOpencodeConfig(cfg.provider, cfg.model, conn)
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '10m' })
    await this.ensureWorkspace(sandbox)
    const booted = createOpencode(sandbox, { directory: '/workspace', config })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('OpenCode did not start in the sandbox within 120s.')), 120_000),
    )
    const { client } = (await Promise.race([booted, timeout])) as Awaited<typeof booted>
    this.opencode = client
  }

  private async ensureOpencodeSession(): Promise<string> {
    const known = this.opencodeSessionId ?? this.getKv<string | null>('opencodeSessionId', null)
    if (known) {
      // The container may have been recycled since this id was minted — verify it still exists
      // on the live OpenCode server before reusing it (a stale id makes turns hang forever).
      const alive = await this.opencode!.session
        .get({ sessionID: known } as never)
        .then((r) => !!(r as { data?: { id?: string } }).data?.id)
        .catch(() => false)
      if (alive) {
        this.opencodeSessionId = known
        return known
      }
      this.opencodeSessionId = undefined
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
  async sendMessage(input: {
    text: string
    messageId?: string
    attachments?: { key: string; name: string; size: number }[]
    /** What actually goes to the harness when it differs from the displayed text (command templates). */
    runText?: string
  }): Promise<{ ok: true }> {
    this.hydrate()
    const id = input.messageId ?? `u-${crypto.randomUUID()}`
    const userTurn: NormTurn = {
      id,
      role: 'user',
      createdAt: Date.now(),
      status: 'complete',
      parts: [
        { kind: 'text', id: `${id}:text`, text: input.text },
        ...(input.attachments?.length
          ? [{ kind: 'text' as const, id: `${id}:att`, text: input.attachments.map((a) => `📎 ${a.name}`).join(' · ') }]
          : []),
      ],
    }
    this.emit({ t: 'turn.start', turn: userTurn })
    // Auto-title: the first prompt names an untitled session.
    if (this.state.meta && (this.state.meta.name === 'Untitled session' || !this.state.meta.name)) {
      const name = input.text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Untitled session'
      this.setState({ ...this.state, meta: { ...this.state.meta, name } })
      void getAgentByName(this.env.UserAgent, this.config().owner).then((u) => u.upsertSessionSummary({ id: this.name, name }))
    }
    this.setStatus('busy')
    const harness = this.config().harness
    const promptText = input.runText ?? input.text
    const text = input.attachments?.length
      ? `${promptText}\n\n[The user attached ${input.attachments.length} file(s), copied into ./uploads/: ${input.attachments.map((a) => a.name).join(', ')}]`
      : promptText
    const run = (async () => {
      if (input.attachments?.length) await this.copyAttachments(input.attachments)
      if (harness === 'opencode') return this.runOpencodeTurn(text)
      if (harness === 'cfagent') return this.runCfAgentTurn(text)
      return this.runBridgeTurn(text)
    })()
    void run.catch((err) => {
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

  private async runOpencodeTurn(text: string): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    if (!hasProviderKey(cfg.provider, conn)) {
      throw new Error(`No ${cfg.provider} key set. Open Settings and add your key.`)
    }

    this.setStatus('booting')
    await this.ensureOpencode()
    const ocSession = await this.ensureOpencodeSession()
    this.setStatus('busy')
    this.emittedParts.clear()

    const client = this.opencode!
    const mode = this.state.mode
    await client.session.promptAsync({
      sessionID: ocSession,
      parts: [{ type: 'text', text }],
      ...(mode === 'plan' ? { agent: 'plan' } : {}),
    } as never)

    // The SDK's event.subscribe() SSE does not stream over the Sandbox transport, so we POLL
    // session.messages (+ todos) and diff against what we've already emitted. All of OpenCode's
    // assistant messages for this prompt are grouped into ONE Dreamweav turn.
    const turnId = `a-${crypto.randomUUID()}`
    this.emit({ t: 'turn.start', turn: { id: turnId, role: 'assistant', createdAt: Date.now(), status: 'streaming', parts: [] } })

    const deadline = Date.now() + 8 * 60 * 1000
    let stable = 0
    let lastSnapshot = ''
    let sawComplete = false
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 600))
        const res = await client.session
          .messages({ sessionID: ocSession } as never)
          .catch(() => ({ data: [] as unknown[] }))
        const data = ((res as { data?: unknown[] }).data ?? []) as Array<{ info?: Record<string, unknown>; parts?: unknown[] }>

        const assistants = data.filter((m) => (m.info as Record<string, unknown>)?.role === 'assistant')
        // Only include assistant messages produced for THIS prompt: those after the last user message.
        const lastUserIdx = data.map((m) => (m.info as Record<string, unknown>)?.role).lastIndexOf('user')
        const relevant = data.slice(lastUserIdx + 1).filter((m) => (m.info as Record<string, unknown>)?.role === 'assistant')

        let usageIn = 0, usageOut = 0, usageReason = 0, cost = 0
        let allComplete = relevant.length > 0
        let anyError: { name: string; message: string } | undefined
        for (const msg of relevant) {
          const info = (msg.info ?? {}) as Record<string, unknown>
          const msgId = String(info.id ?? '')
          const complete = isAssistantComplete(info)
          if (!complete) allComplete = false
          if (info.error) anyError = { name: 'error', message: String(((info.error as Record<string, unknown>).data as Record<string, unknown>)?.message ?? 'Agent error') }
          for (const rawPart of msg.parts ?? []) {
            const np = mapPart(rawPart as Record<string, unknown>)
            if (!np) continue
            np.id = `${msgId}:${np.id}`
            if ((np.kind === 'text' || np.kind === 'reasoning') && !complete) np.streaming = true
            const ser = JSON.stringify(np)
            if (this.emittedParts.get(np.id) === ser) continue
            this.emittedParts.set(np.id, ser)
            this.emit({ t: 'part.upsert', turnId, part: np })
          }
          const u = usageFromInfo(info)
          usageIn += u.input; usageOut += u.output; usageReason += u.reasoning ?? 0; cost += u.cost ?? 0
        }
        const usage = { input: usageIn, output: usageOut, reasoning: usageReason || undefined, cost: cost || undefined }
        this.emit({ t: 'turn.update', id: turnId, patch: { status: anyError ? 'error' : allComplete ? 'complete' : 'streaming', usage, error: anyError, completedAt: allComplete ? Date.now() : undefined } })
        this.emit({ t: 'usage', usage })
        if (allComplete) sawComplete = true
        void assistants

        try {
          const todoRes = await client.session.todo({ sessionID: ocSession } as never)
          const todos = ((todoRes as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>
          if (todos.length) {
            this.emit({
              t: 'todos',
              todos: todos.map((td) => ({
                content: String(td.content ?? ''),
                status: String(td.status ?? 'pending') as 'pending' | 'in_progress' | 'completed' | 'cancelled',
                priority: td.priority as 'high' | 'medium' | 'low' | undefined,
              })),
            })
          }
        } catch { /* ignore */ }

        const snapshot = JSON.stringify(relevant.map((m) => ({ i: m.info?.id, c: (m.info as Record<string, unknown>)?.time, p: (m.parts ?? []).length })))
        if (snapshot === lastSnapshot) stable += 1
        else stable = 0
        lastSnapshot = snapshot
        if (sawComplete && stable >= 1) break
      }
    } finally {
      for (const turn of this.transcript.turns) {
        if (turn.role === 'assistant' && turn.status === 'streaming') {
          this.emit({ t: 'turn.update', id: turn.id, patch: { status: 'complete', completedAt: Date.now() } })
        }
      }
    }
    this.setStatus('idle')
    await this.checkpoint()
  }

  @callable()
  async stop(): Promise<{ ok: true }> {
    if (this.opencode && this.opencodeSessionId) {
      try {
        await this.opencode.session.abort({ sessionID: this.opencodeSessionId } as never)
      } catch { /* ignore */ }
    }
    this.cfAbort?.abort()
    if (this.config().harness !== 'opencode' && this.config().harness !== 'cfagent') {
      const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
      await this.bridgeFetch(sandbox, 'POST', '/abort').catch(() => null)
    }
    this.setStatus('idle')
    return { ok: true }
  }

  @callable()
  async respondPermission(id: string, reply: PermissionReply, note?: string): Promise<{ ok: true }> {
    this.emit({ t: 'permission.resolve', id })
    try {
      if (this.config().harness === 'opencode') {
        if (this.opencode) await this.opencode.permission.reply({ requestID: id, reply, message: note } as never)
      } else {
        const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
        await this.bridgeFetch(sandbox, 'POST', '/permission', { id, reply, note })
      }
    } catch (e) {
      console.error('[dreamweav] permission reply failed', e)
    }
    return { ok: true }
  }

  // --- harness slash-commands ----------------------------------------------------------------
  /** OpenCode-backed session operations; boots OpenCode if needed. */
  private async ocOp<T>(fn: (sid: string) => Promise<T>): Promise<T> {
    if (this.config().harness !== 'opencode') throw new Error('This command is only available on OpenCode sessions (for now).')
    await this.ensureOpencode()
    const sid = await this.ensureOpencodeSession()
    return fn(sid)
  }

  /** Surface a slash-command result in the transcript as a small assistant note. */
  private noteTurn(text: string): void {
    const id = `note-${Date.now()}`
    this.emit({
      t: 'turn.start',
      turn: {
        id, role: 'assistant', createdAt: Date.now(), status: 'complete', completedAt: Date.now(),
        parts: [{ kind: 'text', id: `${id}:t`, text }],
      },
    })
  }

  private noted(res: { ok: boolean; note: string }): { ok: boolean; note: string } {
    this.noteTurn(res.note)
    return res
  }

  @callable()
  async compact(): Promise<{ ok: boolean; note: string }> {
    const harness = this.config().harness
    if (harness === 'opencode') {
      await this.ocOp((sid) => this.opencode!.session.summarize({ sessionID: sid } as never))
      return this.noted({ ok: true, note: 'Compacted the conversation (older turns summarized).' })
    }
    if (harness === 'cfagent') {
      const history = this.getKv<ModelMessage[]>('cfagent:messages', [])
      if (!history.length) return this.noted({ ok: true, note: 'Nothing to compact yet.' })
      const cfg = this.config()
      const summary = await summarizeMessages({ provider: cfg.provider, model: cfg.model, creds: await this.connections(), messages: history })
      this.putKv('cfagent:messages', [{ role: 'user', content: `Context summary of the conversation so far:\n${summary}` }])
      return this.noted({ ok: true, note: 'Context compacted — older turns condensed into a summary.' })
    }
    return this.bridgeCommand('compact')
  }

  @callable()
  async undo(): Promise<{ ok: boolean; note: string }> {
    await this.ocOp((sid) => this.opencode!.session.revert({ sessionID: sid } as never))
    return this.noted({ ok: true, note: 'Reverted the last change.' })
  }

  @callable()
  async redo(): Promise<{ ok: boolean; note: string }> {
    await this.ocOp((sid) => this.opencode!.session.unrevert({ sessionID: sid } as never))
    return this.noted({ ok: true, note: 'Restored the reverted change.' })
  }

  @callable()
  async initProject(): Promise<{ ok: boolean; note: string }> {
    await this.ocOp((sid) => this.opencode!.session.init({ sessionID: sid } as never))
    return this.noted({ ok: true, note: 'Scanned the project and wrote AGENTS.md.' })
  }

  @callable()
  async share(): Promise<{ ok: boolean; note: string }> {
    const res = await this.ocOp((sid) => this.opencode!.session.share({ sessionID: sid } as never))
    const url = (res as { data?: { share?: { url?: string } } }).data?.share?.url ?? ''
    return this.noted({ ok: true, note: url ? `Session shared: ${url}` : 'Session shared.' })
  }

  @callable()
  async unshare(): Promise<{ ok: boolean; note: string }> {
    await this.ocOp((sid) => this.opencode!.session.unshare({ sessionID: sid } as never))
    return this.noted({ ok: true, note: 'Session share link revoked.' })
  }

  /** Proxy a slash command to the bridge harness process (pi extras, aisdk compact). */
  @callable()
  async bridgeCommand(name: string): Promise<{ ok: boolean; note: string }> {
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    const res = await this.bridgeFetch(sandbox, 'POST', '/command', { name })
    if (!res || !res.ok) {
      return this.noted({ ok: false, note: 'The harness is not running yet — send a message first.' })
    }
    const out = res.json as { ok?: boolean; note?: string }
    return this.noted({ ok: !!out.ok, note: out.note ?? (out.ok ? 'Done.' : 'The harness rejected the command.') })
  }

  /** Commands the harness itself advertises (OpenCode custom/skill/MCP commands, pi extensions). */
  @callable()
  async harnessCommands(): Promise<{ commands: { name: string; description?: string }[] }> {
    const clean = (list: Array<Record<string, unknown>>) =>
      list
        .map((c) => ({ name: String(c.name ?? ''), description: typeof c.description === 'string' ? c.description : undefined }))
        .filter((c) => c.name)
    try {
      const harness = this.config().harness
      if (harness === 'opencode') {
        if (!this.opencode) return { commands: [] } // don't boot a sandbox just to fill a menu
        const res = await this.opencode.command.list({} as never)
        return { commands: clean(((res as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>) }
      }
      if (harness === 'pi') {
        const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
        const res = await this.bridgeFetch(sandbox, 'POST', '/command', { name: 'commands' })
        const data = (res?.json as { data?: unknown } | undefined)?.data
        return { commands: Array.isArray(data) ? clean(data as Array<Record<string, unknown>>) : [] }
      }
    } catch { /* menu stays static */ }
    return { commands: [] }
  }

  /** Run a harness-advertised command: OpenCode expands the command's prompt template; pi passes the slash text through. */
  @callable()
  async runCustomCommand(name: string): Promise<{ ok: boolean; note: string }> {
    const harness = this.config().harness
    if (harness === 'opencode') {
      const res = await this.ocOp(() => this.opencode!.command.list({} as never))
      const list = ((res as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>
      const cmd = list.find((c) => c.name === name)
      if (!cmd) return { ok: false, note: `Unknown command: /${name}` }
      const template = String(cmd.template ?? '').replaceAll('$ARGUMENTS', '').trim()
      if (!template) return { ok: false, note: `/${name} has no prompt template.` }
      await this.sendMessage({ text: `/${name}`, runText: template })
      return { ok: true, note: `Running /${name}.` }
    }
    if (harness === 'pi') {
      await this.sendMessage({ text: `/${name}` })
      return { ok: true, note: `Running /${name}.` }
    }
    return { ok: false, note: 'Custom commands are not supported on this harness.' }
  }

  @callable()
  async showDiff(): Promise<{ ok: boolean; note: string }> {
    const diff = await this.ocOp((sid) => this.opencode!.session.diff({ sessionID: sid } as never))
    const data = ((diff as { data?: unknown[] }).data ?? []) as Array<Record<string, unknown>>
    const files = data.map((d) => ({
      path: String(d.file ?? d.path ?? d.filename ?? '?'),
      additions: typeof d.additions === 'number' ? d.additions : undefined,
      deletions: typeof d.deletions === 'number' ? d.deletions : undefined,
      patch: typeof d.patch === 'string' ? d.patch : typeof d.diff === 'string' ? d.diff : undefined,
    }))
    const turnId = `d-${Date.now()}`
    this.emit({
      t: 'turn.start',
      turn: {
        id: turnId, role: 'assistant', createdAt: Date.now(), status: 'complete', completedAt: Date.now(),
        parts: files.length
          ? [{ kind: 'diff', id: `${turnId}:diff`, files }]
          : [{ kind: 'text', id: `${turnId}:t`, text: '_No changes in this session yet._' }],
      },
    })
    return { ok: true, note: files.length ? `Showing ${files.length} changed file(s).` : 'No changes yet.' }
  }

  @callable()
  clearTranscript(): { ok: true } {
    this.sql`DELETE FROM turns`
    this.putKv('todos', [])
    this.putKv('permissions', [])
    this.putKv('cfagent:messages', [])
    this.emittedParts.clear()
    this.transcript = emptyTranscript()
    this.hydrated = true
    this.broadcast(JSON.stringify({ t: 'reset' }))
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
      let res = (await sandbox.listFiles(path)) as {
        files?: { name: string; absolutePath: string; type: string; size: number }[]
      }
      if (path === '/workspace' && !(res.files ?? []).length) {
        // Container disk does not survive sleep — restore the workspace (backup / clone) and retry.
        await this.ensureWorkspace(sandbox).catch(() => null)
        res = (await sandbox.listFiles(path)) as typeof res
      }
      const files = (res.files ?? []).map((f) => ({
        name: f.name,
        path: f.absolutePath,
        isDirectory: f.type === 'directory',
        size: f.size,
      }))
      return { files }
    } catch {
      return { files: [] }
    }
  }

  @callable()
  async writeFile(path: string, content: string): Promise<{ ok: boolean }> {
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    try {
      await sandbox.writeFile(path, content)
      return { ok: true }
    } catch {
      return { ok: false }
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
