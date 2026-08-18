import { Agent, callable, getAgentByName } from 'agents'
import { getSandbox } from '@cloudflare/sandbox'
import { createOpencode } from '@cloudflare/sandbox/opencode'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { buildOpencodeConfig, hasProviderKey } from '../opencode-config'
import { mapPart, usageFromInfo, isAssistantComplete } from '../harness/opencode-map'
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
  private emittedParts = new Map<string, string>()
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
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '20m' })
    await this.ensureWorkspace(sandbox)
    // (Re)start the bridge process and confirm it's healthy (it may have died on container restart).
    const healthy = await this.bridgeFetch(sandbox, 'GET', '/health').then((r) => r?.ok).catch(() => false)
    if (!healthy) {
      this.bridgeStarted = false
      const nodeCheck = await sandbox.exec('node --version 2>&1 || echo NO_NODE').then((r) => (r as { stdout?: string }).stdout?.trim()).catch((e) => String(e))
      const exists = await sandbox.exec('ls -la /opt/dreamweav/ 2>&1').then((r) => (r as { stdout?: string }).stdout ?? '').catch(() => '')
      await sandbox.startProcess('node /opt/dreamweav/bridge.mjs', { processId: 'bridge' }).catch(() => {})
      let ok = false
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        ok = await this.bridgeFetch(sandbox, 'GET', '/health').then((r) => r?.ok ?? false).catch(() => false)
        if (ok) break
      }
      if (!ok) {
        const logs = await sandbox.getProcessLogs('bridge').then((l) => JSON.stringify(l).slice(0, 600)).catch(() => 'no logs')
        throw new Error(`Bridge did not start. node=${nodeCheck}; /opt/dreamweav=${exists.slice(0, 200)}; logs=${logs}`)
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

  private async runBridgeTurn(text: string): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    if (!hasProviderKey(cfg.provider, conn)) throw new Error(`No ${cfg.provider} key set. Open Settings and add your key.`)

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
        await new Promise((r) => setTimeout(r, 1200))
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
        }
        for (const perm of state.permissions ?? []) this.emit({ t: 'permission.ask', permission: perm })
        if (state.todos?.length) this.emit({ t: 'todos', todos: state.todos })
        const snapshot = JSON.stringify(assistant?.parts?.length ?? 0) + (state.status ?? '')
        if (snapshot === lastSnapshot) stable += 1
        else stable = 0
        lastSnapshot = snapshot
        if (state.status === 'idle' && stable >= 2) break
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
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '20m' })
    await this.ensureWorkspace(sandbox)
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
    const harness = this.config().harness
    const run = harness === 'opencode' ? this.runOpencodeTurn(input.text) : this.runBridgeTurn(input.text)
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
        await new Promise((r) => setTimeout(r, 1200))
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
        if (sawComplete && stable >= 3) break
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
    if (this.config().harness !== 'opencode') {
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
      const res = (await sandbox.listFiles(path)) as {
        files?: { name: string; absolutePath: string; type: string; size: number }[]
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
