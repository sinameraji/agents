import { Agent, callable, getAgentByName } from 'agents'
import { getSandbox } from '@cloudflare/sandbox'
import { createOpencode } from '@cloudflare/sandbox/opencode'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { buildOpencodeProvider } from '../opencode-config'
import type {
  Connections,
  Harness,
  Message,
  Provider,
  SessionSource,
  SessionStatus,
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
  status: SessionStatus
  region: string
  createdAt: string
  lastActivity: string
}

interface SessionAgentState {
  meta: SessionMeta | null
  usage: { tokensIn: number; tokensOut: number; costUsd: number }
  bridge: 'down' | 'booting' | 'up'
}

interface MessageRow {
  id: string
  role: string
  seq: number
  created_at: string
  text: string | null
  steps_json: string | null
  diff_json: string | null
}

/**
 * One instance per session (name = session id). Thin supervisor: owns the Sandbox container and the
 * OpenCode server running inside it, persists the chat log, and relays OpenCode's event stream to
 * the browser over WebSocket. The heavy lifting (tools, LLM calls) happens inside the container.
 */
export class SessionAgent extends Agent<Env, SessionAgentState> {
  initialState: SessionAgentState = {
    meta: null,
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
    bridge: 'down',
  }

  private opencode?: OpencodeClient
  private opencodeSessionId?: string

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      text TEXT,
      steps_json TEXT,
      diff_json TEXT
    )`
    this.sql`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`
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

  /** Called by UserAgent.createSession (server-side) to seed this session. */
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
      status: 'provisioning',
      region: 'iad1',
      createdAt: new Date().toISOString(),
      lastActivity: 'now',
    }
    this.setState({ ...this.state, meta })
    return { ok: true }
  }

  private config(): SessionConfig {
    const c = this.getKv<SessionConfig | null>('config', null)
    if (!c) throw new Error('session not initialized')
    return c
  }

  private async connections(): Promise<Connections> {
    const cfg = this.config()
    const user = await getAgentByName(this.env.UserAgent, cfg.owner)
    return (await user.getDecryptedConnections()) as Connections
  }

  private setStatus(status: SessionStatus) {
    if (!this.state.meta) return
    this.setState({ ...this.state, meta: { ...this.state.meta, status, lastActivity: 'now' } })
    // Mirror into the sidebar.
    void getAgentByName(this.env.UserAgent, this.config().owner).then((u) =>
      u.upsertSessionSummary({ id: this.name, status, lastActivity: 'now', costUsd: this.state.usage.costUsd }),
    )
  }

  private nextSeq(): number {
    const rows = this.sql<{ m: number | null }>`SELECT MAX(seq) as m FROM messages`
    return (rows[0]?.m ?? 0) + 1
  }

  private persistMessage(m: Message & { seq: number }) {
    this.sql`INSERT INTO messages (id, role, seq, created_at, text, steps_json, diff_json)
             VALUES (${m.id}, ${m.role}, ${m.seq}, ${m.createdAt}, ${m.text ?? null},
                     ${m.steps ? JSON.stringify(m.steps) : null}, ${m.diff ? JSON.stringify(m.diff) : null})
             ON CONFLICT(id) DO UPDATE SET text = excluded.text, steps_json = excluded.steps_json, diff_json = excluded.diff_json`
  }

  @callable()
  getMessages(input?: { after?: number }): Message[] {
    const after = input?.after ?? 0
    const rows = this.sql<MessageRow>`SELECT * FROM messages WHERE seq > ${after} ORDER BY seq ASC`
    return rows.map((r) => ({
      id: r.id,
      role: r.role as Message['role'],
      createdAt: r.created_at,
      text: r.text ?? undefined,
      steps: r.steps_json ? JSON.parse(r.steps_json) : undefined,
      diff: r.diff_json ? JSON.parse(r.diff_json) : undefined,
    }))
  }

  /** Boot the container + OpenCode without prompting — used to verify the pipeline end to end. */
  @callable()
  async debugBoot(): Promise<{ ok: boolean; providers?: unknown; error?: string }> {
    try {
      await this.ensureOpencode()
      const providers = await this.opencode!.provider.list({ throwOnError: true } as never)
      return { ok: true, providers: (providers as { data?: unknown }).data ?? providers }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  private async ensureOpencode(): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    const { config } = buildOpencodeProvider(cfg.provider, cfg.model, conn)
    this.setState({ ...this.state, bridge: 'booting' })
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`, { sleepAfter: '20m' })
    // Blank sessions run in /workspace; git/upload hydration comes in a later step.
    const { client } = await createOpencode(sandbox, {
      directory: '/workspace',
      config,
    })
    this.opencode = client
    this.setState({ ...this.state, bridge: 'up' })
  }

  private async ensureOpencodeSession(): Promise<string> {
    if (this.opencodeSessionId) return this.opencodeSessionId
    const stored = this.getKv<string | null>('opencodeSessionId', null)
    if (stored) {
      this.opencodeSessionId = stored
      return stored
    }
    const res = await this.opencode!.session.create(
      { title: this.state.meta?.name ?? 'session' },
      { throwOnError: true } as never,
    )
    const id = (res as { data?: { id?: string } }).data?.id ?? (res as { id?: string }).id
    if (!id) throw new Error('opencode session create returned no id')
    this.opencodeSessionId = id
    this.putKv('opencodeSessionId', id)
    return id
  }

  @callable()
  async sendMessage(input: { text: string }): Promise<{ ok: true }> {
    const seq = this.nextSeq()
    const userMsg: Message & { seq: number } = {
      id: `u-${Date.now()}`,
      role: 'user',
      createdAt: new Date().toISOString(),
      text: input.text,
      seq,
    }
    this.persistMessage(userMsg)
    this.broadcast(JSON.stringify({ t: 'message.upsert', message: userMsg }))
    this.setStatus('running')

    // Run the turn in a durable fiber so an eviction mid-turn recovers cleanly.
    void this.runTurn(input.text).catch((err) => {
      this.broadcast(JSON.stringify({ t: 'error', message: (err as Error).message }))
      this.setStatus('error')
    })
    return { ok: true }
  }

  private async runTurn(text: string): Promise<void> {
    const cfg = this.config()
    const conn = await this.connections()
    const { model } = buildOpencodeProvider(cfg.provider, cfg.model, conn)
    await this.ensureOpencode()
    const ocSession = await this.ensureOpencodeSession()

    const assistantId = `a-${Date.now()}`
    const seq = this.nextSeq()
    let assistantText = ''
    const assistant: Message & { seq: number } = {
      id: assistantId,
      role: 'agent',
      createdAt: new Date().toISOString(),
      text: '',
      steps: [],
      seq,
    }
    this.persistMessage(assistant)
    this.broadcast(JSON.stringify({ t: 'message.upsert', message: assistant }))

    // Subscribe to the OpenCode event bus, then fire the prompt.
    const events = await this.opencode!.event.subscribe()
    await this.opencode!.session.promptAsync({
      sessionID: ocSession,
      model,
      parts: [{ type: 'text', text }],
    } as never)

    for await (const event of (events as { stream: AsyncIterable<Record<string, unknown>> }).stream) {
      const type = event.type as string
      const props = (event.properties ?? {}) as Record<string, unknown>
      if (type === 'message.part.updated') {
        const part = (props.part ?? {}) as Record<string, unknown>
        if (part.sessionID && part.sessionID !== ocSession) continue
        if (part.type === 'text' && typeof part.text === 'string') {
          assistantText = part.text
          this.broadcast(JSON.stringify({ t: 'text.set', messageId: assistantId, text: assistantText }))
        } else if (part.type === 'tool') {
          const tool = (part.tool ?? part.name ?? 'tool') as string
          const step = { id: String(part.id ?? tool), label: String(tool), status: 'running' as const }
          this.broadcast(JSON.stringify({ t: 'step.upsert', messageId: assistantId, step }))
        }
      } else if (type === 'session.idle') {
        if ((props.sessionID ?? props.id) === ocSession) break
      } else if (type === 'session.error') {
        this.broadcast(JSON.stringify({ t: 'error', message: JSON.stringify(props) }))
        break
      }
    }

    assistant.text = assistantText
    this.persistMessage(assistant)
    this.broadcast(JSON.stringify({ t: 'message.upsert', message: assistant }))
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
  rename(name: string): { ok: true } {
    if (this.state.meta) this.setState({ ...this.state, meta: { ...this.state.meta, name } })
    void getAgentByName(this.env.UserAgent, this.config().owner).then((u) =>
      u.upsertSessionSummary({ id: this.name, name }),
    )
    return { ok: true }
  }
}
