import { Agent, callable } from 'agents'
import { decryptSecret, encryptSecret, maskSecret } from '../crypto'
import {
  DEFAULT_SETTINGS,
  type Connections,
  type Harness,
  type MaskedConnections,
  type Provider,
  type SessionSource,
  type SessionStatus,
  type SessionSummary,
  type UserSettings,
} from '~shared/protocol'

const CONNECTION_FIELDS: (keyof Connections)[] = [
  'openrouterKey',
  'cloudflareAccountId',
  'cloudflareApiToken',
  'cloudflareGatewayId',
  'anthropicKey',
  'openaiKey',
  'githubPat',
]

interface SessionRow {
  id: string
  name: string
  repo: string
  branch: string
  harness: string
  status: string
  model: string
  provider: string
  region: string
  source_json: string
  last_activity: string
  cost: number
  unread: number
  created_at: string
}

/**
 * One instance per user (name = user id). Owns the session index shown in the sidebar and the
 * user's settings + encrypted connections. The browser talks to it over WebSocket via `useAgent`.
 */
export class UserAgent extends Agent<Env, { ready: boolean }> {
  initialState = { ready: false }

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      harness TEXT NOT NULL DEFAULT 'pi',
      status TEXT NOT NULL DEFAULT 'provisioning',
      model TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'openrouter',
      region TEXT NOT NULL DEFAULT 'iad1',
      source_json TEXT NOT NULL DEFAULT '{}',
      last_activity TEXT NOT NULL DEFAULT 'now',
      cost REAL NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`
    this.sql`CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)`
    if (!this.state.ready) this.setState({ ready: true })
  }

  private getSetting<T>(key: string, fallback: T): T {
    const rows = this.sql<{ v: string }>`SELECT v FROM settings WHERE k = ${key}`
    if (!rows.length) return fallback
    try {
      return JSON.parse(rows[0].v) as T
    } catch {
      return fallback
    }
  }

  private putSetting(key: string, value: unknown) {
    this.sql`INSERT INTO settings (k, v) VALUES (${key}, ${JSON.stringify(value)})
             ON CONFLICT(k) DO UPDATE SET v = excluded.v`
  }

  private rowToSummary(r: SessionRow): SessionSummary {
    return {
      id: r.id,
      name: r.name,
      repo: r.repo,
      branch: r.branch,
      harness: r.harness as Harness,
      status: r.status as SessionStatus,
      model: r.model,
      region: r.region as SessionSummary['region'],
      lastActivity: r.last_activity,
      costUsd: r.cost,
      unread: r.unread === 1,
    }
  }

  // --- sessions index -----------------------------------------------------------------------
  @callable()
  listSessions(): SessionSummary[] {
    const rows = this.sql<SessionRow>`SELECT * FROM sessions ORDER BY created_at DESC`
    return rows.map((r) => this.rowToSummary(r))
  }

  @callable()
  createSession(input: {
    source: SessionSource
    name?: string
    harness?: Harness
    provider?: Provider
    model?: string
  }): { id: string } {
    const settings = this.getSettings().settings
    const id = crypto.randomUUID()
    const harness = input.harness ?? settings.defaultHarness
    const provider = input.provider ?? settings.defaultProvider
    const model = input.model ?? settings.defaultModel
    const repo =
      input.source.kind === 'github' ? input.source.url.replace(/^https?:\/\/github\.com\//, '') : ''
    const name = input.name ?? (repo || 'Untitled session')
    const branch = `dreamweav/${id.slice(0, 8)}`
    this.sql`INSERT INTO sessions (id, name, repo, branch, harness, status, model, provider, source_json, created_at)
             VALUES (${id}, ${name}, ${repo}, ${branch}, ${harness}, 'provisioning', ${model}, ${provider},
                     ${JSON.stringify(input.source)}, ${new Date().toISOString()})`
    // P1.3: also getAgentByName(env.SessionAgent, id).init({owner, source, harness, provider, model})
    return { id }
  }

  @callable()
  deleteSession(id: string): { ok: true } {
    this.sql`DELETE FROM sessions WHERE id = ${id}`
    return { ok: true }
  }

  @callable()
  renameSession(id: string, name: string): { ok: true } {
    this.sql`UPDATE sessions SET name = ${name} WHERE id = ${id}`
    return { ok: true }
  }

  @callable()
  markRead(id: string): { ok: true } {
    this.sql`UPDATE sessions SET unread = 0 WHERE id = ${id}`
    return { ok: true }
  }

  /** Called by SessionAgent (server-side RPC) to keep the sidebar in sync. */
  upsertSessionSummary(s: Partial<SessionSummary> & { id: string }): void {
    const existing = this.sql<SessionRow>`SELECT * FROM sessions WHERE id = ${s.id}`
    if (!existing.length) return
    const r = existing[0]
    this.sql`UPDATE sessions SET
      name = ${s.name ?? r.name},
      repo = ${s.repo ?? r.repo},
      branch = ${s.branch ?? r.branch},
      status = ${s.status ?? r.status},
      model = ${s.model ?? r.model},
      region = ${s.region ?? r.region},
      last_activity = ${s.lastActivity ?? r.last_activity},
      cost = ${s.costUsd ?? r.cost},
      unread = ${s.unread === undefined ? r.unread : s.unread ? 1 : 0}
      WHERE id = ${s.id}`
  }

  // --- settings + connections ---------------------------------------------------------------
  @callable()
  getSettings(): { settings: UserSettings; connections: MaskedConnections } {
    const settings = this.getSetting<UserSettings>('settings', DEFAULT_SETTINGS)
    const masked = {} as MaskedConnections
    for (const f of CONNECTION_FIELDS) {
      const enc = this.getSetting<string | null>(`conn:${f}`, null)
      masked[f] = enc ? maskSecret('••••••••••••') : null // presence only; value hidden
    }
    return { settings: { ...DEFAULT_SETTINGS, ...settings }, connections: masked }
  }

  @callable()
  async saveSettings(input: {
    settings?: Partial<UserSettings>
    connections?: Partial<Record<keyof Connections, string>>
  }): Promise<{ settings: UserSettings; connections: MaskedConnections }> {
    if (input.settings) {
      const merged = { ...this.getSetting<UserSettings>('settings', DEFAULT_SETTINGS), ...input.settings }
      this.putSetting('settings', merged)
    }
    if (input.connections) {
      const key = this.env.ENCRYPTION_KEY
      for (const [field, value] of Object.entries(input.connections)) {
        const k = `conn:${field}`
        if (value === '') {
          this.sql`DELETE FROM settings WHERE k = ${k}` // explicit clear
        } else if (value != null) {
          this.putSetting(k, await encryptSecret(value, key))
        }
      }
    }
    return this.getSettings()
  }

  /** Decrypt all stored connections (server-side use only, e.g. handed to a SessionAgent). */
  async getDecryptedConnections(): Promise<Connections> {
    const out: Connections = {}
    const key = this.env.ENCRYPTION_KEY
    for (const f of CONNECTION_FIELDS) {
      const enc = this.getSetting<string | null>(`conn:${f}`, null)
      if (enc) out[f] = await decryptSecret(enc, key)
    }
    return out
  }
}
