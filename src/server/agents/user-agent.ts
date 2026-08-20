import { Agent, callable, getAgentByName } from 'agents'
import { getSandbox } from '@cloudflare/sandbox'
import { decryptSecret, encryptSecret, maskSecret } from '../crypto'
import { deriveZone, describeCfError, isCfAuthError, normalizeHostname, type DomainWizardState } from '~shared/domain'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SETTINGS,
  modelFitsProvider,
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
  async createSession(input: {
    source: SessionSource
    name?: string
    harness?: Harness
    provider?: Provider
    model?: string
  }): Promise<{ id: string }> {
    const settings = (await this.getSettings()).settings
    const id = crypto.randomUUID()
    const harness = input.harness ?? settings.defaultHarness
    const provider = input.provider ?? settings.defaultProvider
    let model = input.model ?? settings.defaultModel
    // A model id that doesn't fit the provider guarantees a broken first turn (e.g. an
    // OpenRouter-style id sent through the Cloudflare gateway routes to the wrong upstream).
    if (!modelFitsProvider(provider, model)) model = DEFAULT_MODEL_BY_PROVIDER[provider]
    const repo =
      input.source.kind === 'github'
        ? input.source.url.replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/^https?:\/\//, '').replace(/\.git$/, '')
        : ''
    const name = input.name ?? (repo || 'Untitled session')
    const branch = `agents/${id.slice(0, 8)}`
    this.sql`INSERT INTO sessions (id, name, repo, branch, harness, status, model, provider, source_json, created_at)
             VALUES (${id}, ${name}, ${repo}, ${branch}, ${harness}, 'provisioning', ${model}, ${provider},
                     ${JSON.stringify(input.source)}, ${new Date().toISOString()})`
    void getAgentByName(this.env.SessionAgent, id).then((sa) =>
      sa.init({ owner: this.name, source: input.source, harness, provider, model, name, repo, branch }),
    )
    return { id }
  }

  /** Factory-reset this account: every session (transcripts + sandboxes) and all settings and
   *  encrypted connections. The user sees the app exactly as a brand-new user would. */
  @callable()
  async resetAccount(): Promise<{ ok: true; sessions: number }> {
    await this.revokeCfOauth() // sever the OAuth grant at Cloudflare, not just our copy
    const rows = this.sql<{ id: string }>`SELECT id FROM sessions`
    for (const r of rows) {
      await getAgentByName(this.env.SessionAgent, r.id)
        .then((sa) => sa.wipe())
        .catch(() => null)
    }
    this.sql`DELETE FROM sessions`
    this.sql`DELETE FROM settings`
    return { ok: true, sessions: rows.length }
  }

  @callable()
  deleteSession(id: string): { ok: true } {
    this.sql`DELETE FROM sessions WHERE id = ${id}`
    // Kill the session's container immediately so deleted sessions never idle-bill.
    try {
      const sandbox = getSandbox(this.env.Sandbox, `sess-${id}`)
      void sandbox.destroy().catch(() => null)
    } catch { /* ignore */ }
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
  async getSettings(): Promise<{ settings: UserSettings; connections: MaskedConnections }> {
    const settings = this.getSetting<UserSettings>('settings', DEFAULT_SETTINGS)
    // Migration: the old default was an expensive model; upgrade stored settings to the cheap default.
    if (settings.defaultModel === 'anthropic/claude-sonnet-4.5') {
      settings.defaultModel = DEFAULT_SETTINGS.defaultModel
      this.putSetting('settings', settings)
    }
    const masked = {} as MaskedConnections
    const IDENTIFIERS: (keyof Connections)[] = ['cloudflareAccountId', 'cloudflareGatewayId']
    for (const f of CONNECTION_FIELDS) {
      const enc = this.getSetting<string | null>(`conn:${f}`, null)
      if (!enc) {
        masked[f] = null
      } else if (IDENTIFIERS.includes(f)) {
        // Account/gateway ids are identifiers, not credentials, the UI needs the real values
        // (show the gateway name, build dashboard links).
        masked[f] = await decryptSecret(enc, this.env.ENCRYPTION_KEY)
      } else {
        masked[f] = maskSecret('••••••••••••') // presence only; value hidden
      }
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

  private async gatewayApi(): Promise<{ base: string; headers: Record<string, string> } | null> {
    const conn = await this.getDecryptedConnections()
    const token = await this.cfControlToken()
    if (!conn.cloudflareAccountId || !token) return null
    return {
      base: `https://api.cloudflare.com/client/v4/accounts/${conn.cloudflareAccountId}/ai-gateway/gateways`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    }
  }

  /** List the account's AI Gateways so the user can pick one, it's their account. */
  @callable()
  async listAiGateways(): Promise<{ ok: boolean; gateways: string[]; note?: string }> {
    const api = await this.gatewayApi()
    if (!api) return { ok: false, gateways: [], note: 'Connect Cloudflare first.' }
    const res = (await fetch(`${api.base}?per_page=50`, { headers: api.headers }).then((r) => r.json()).catch(() => ({}))) as {
      success?: boolean
      result?: Array<{ id?: string }>
      errors?: Array<{ message?: string }>
    }
    if (!res.success) return { ok: false, gateways: [], note: res.errors?.[0]?.message ?? 'Could not list gateways.' }
    return { ok: true, gateways: (res.result ?? []).map((g) => String(g.id ?? '')).filter(Boolean) }
  }

  /** Create a gateway with the user's chosen name and attach it. */
  @callable()
  async createAiGateway(name: string): Promise<{ ok: boolean; gatewayId?: string; note?: string }> {
    const api = await this.gatewayApi()
    if (!api) return { ok: false, note: 'Connect Cloudflare first.' }
    const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 64)
    if (!id) return { ok: false, note: 'Enter a gateway name (letters, numbers, dashes).' }
    const created = (await fetch(api.base, {
      method: 'POST',
      headers: api.headers,
      body: JSON.stringify({
        id,
        cache_invalidate_on_update: false,
        cache_ttl: 0,
        collect_logs: true,
        rate_limiting_interval: 0,
        rate_limiting_limit: 0,
        rate_limiting_technique: 'fixed',
        // Authenticated gateway is a prerequisite for unified billing: without it the gateway
        // ignores cf-aig-authorization and forwards vendor requests upstream with NO key.
        authentication: true,
      }),
    })
      .then((r) => r.json())
      .catch(() => ({}))) as { success?: boolean; result?: { id?: string }; errors?: Array<{ message?: string }> }
    if (!created.success || !created.result?.id) {
      return { ok: false, note: created.errors?.[0]?.message ?? 'Could not create the gateway.' }
    }
    await this.saveSettings({ connections: { cloudflareGatewayId: created.result.id } })
    return { ok: true, gatewayId: created.result.id }
  }

  /** Wire a custom domain using the token stored from "Log in with Cloudflare" — no manual token.
   *  Needs the login to carry DNS + Workers Routes scopes (added to the OAuth client). */
  @callable()
  async setupCustomDomainAuto(domain: string): Promise<{ ok: boolean; note: string; needsReconnect?: boolean }> {
    const token = await this.cfControlToken()
    if (!token) {
      return { ok: false, note: 'Connect Cloudflare first (log in with Cloudflare), then try again.', needsReconnect: true }
    }
    return this.wireDomain(domain, token, true)
  }

  /** Wire a custom domain for a self-hosted instance: proxied DNS for the apex and wildcard
   *  (previews need *.domain) plus worker routes. The token is used once and never stored. */
  @callable()
  async setupCustomDomain(domain: string, apiToken: string): Promise<{ ok: boolean; note: string }> {
    if (!apiToken.trim()) return { ok: false, note: 'Paste an API token with Zone DNS Edit + Workers Routes Edit.' }
    return this.wireDomain(domain, apiToken.trim(), false)
  }

  private async wireDomain(domain: string, apiToken: string, viaLogin: boolean): Promise<{ ok: boolean; note: string; needsReconnect?: boolean }> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(clean)) return { ok: false, note: 'Enter a domain like example.com.' }
    let permDenied = false
    const AUTH_CODES = new Set([9109, 9106, 10000, 9038, 1001])
    const api = (path: string, init?: RequestInit) =>
      fetch(`https://api.cloudflare.com/client/v4${path}`, {
        ...init,
        headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      })
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { success?: boolean; errors?: Array<{ code?: number; message?: string }> }
          // An under-scoped token may 403, OR return 200 with an auth error code / message.
          if (r.status === 403 || r.status === 401) permDenied = true
          if (j.success === false) {
            for (const e of j.errors ?? []) {
              if ((e.code && AUTH_CODES.has(e.code)) || /unauthor|authenticat|not allowed|permission/i.test(e.message ?? ''))
                permDenied = true
            }
          }
          return j
        }) as Promise<{ success?: boolean; result?: unknown; errors?: Array<{ message?: string; code?: number }> }>

    // The entered name may be a subdomain; walk up the labels to find its zone.
    const labels = clean.split('.')
    let zone: { id: string; name: string } | null = null
    for (let i = 0; i < labels.length - 1 && !zone; i++) {
      const name = labels.slice(i).join('.')
      const r = await api(`/zones?name=${encodeURIComponent(name)}`)
      const z = (Array.isArray(r.result) ? r.result : [])[0] as { id?: string; name?: string } | undefined
      if (z?.id) zone = { id: z.id, name: z.name ?? name }
    }
    if (!zone) {
      if (viaLogin) {
        // Either the login lacks DNS scopes (stale token) or the domain isn't on the account.
        // Both are fixed the same way from here, so offer reconnect.
        return {
          ok: false,
          needsReconnect: true,
          note: permDenied
            ? 'Your Cloudflare login does not include DNS access yet. Reconnect Cloudflare to grant it, then try again.'
            : `Couldn't find ${clean} on your Cloudflare account. If it is there, your login may need DNS access — reconnect Cloudflare and retry. Otherwise, add the domain to Cloudflare first.`,
        }
      }
      return {
        ok: false,
        note: `No zone for ${clean} on this token's account. The token needs Zone:Read (to find the zone), plus DNS:Edit and Workers Routes:Edit. Add the domain to Cloudflare first.`,
      }
    }
    const script = (this.env as unknown as { WORKER_NAME?: string }).WORKER_NAME ?? 'dreamweav'

    // A record must be an A record and proxied (orange-cloud) for the worker route to catch it;
    // an existing CNAME or grey-cloud record would silently break previews, so verify, don't
    // just "exists".
    const ensureRecord = async (name: string) => {
      const list = await api(`/zones/${zone!.id}/dns_records?name=${encodeURIComponent(name)}`)
      const existing = (Array.isArray(list.result) ? list.result : []) as Array<{ id?: string; type?: string; proxied?: boolean }>
      const ours = existing.find((r) => r.type === 'A' && r.proxied === true)
      if (ours) return true
      const conflict = existing.find((r) => r.type === 'CNAME' || r.proxied === false)
      if (conflict?.id) {
        const upd = await api(`/zones/${zone!.id}/dns_records/${conflict.id}`, {
          method: 'PUT',
          body: JSON.stringify({ type: 'A', name, content: '192.0.2.1', proxied: true, ttl: 1, comment: 'agents' }),
        })
        return upd.success === true
      }
      const r = await api(`/zones/${zone!.id}/dns_records`, {
        method: 'POST',
        body: JSON.stringify({ type: 'A', name, content: '192.0.2.1', proxied: true, ttl: 1, comment: 'agents' }),
      })
      return r.success === true
    }
    const ensureRoute = async (pattern: string) => {
      const list = await api(`/zones/${zone!.id}/workers/routes`)
      const routes = (Array.isArray(list.result) ? list.result : []) as Array<{ pattern?: string; script?: string }>
      // A route with our pattern pointing at a DIFFERENT script would swallow the traffic; only
      // treat it as satisfied when it already targets this worker.
      const match = routes.find((rt) => rt.pattern === pattern)
      if (match) return match.script === script
      const r = await api(`/zones/${zone!.id}/workers/routes`, {
        method: 'POST',
        body: JSON.stringify({ pattern, script }),
      })
      return r.success === true
    }

    const results = [
      await ensureRecord(clean),
      await ensureRecord(`*.${clean}`),
      await ensureRoute(`${clean}/*`),
      await ensureRoute(`*.${clean}/*`),
    ]
    if (results.every(Boolean)) return { ok: true, note: `https://${clean} is wired: app + wildcard previews.` }
    if (permDenied && viaLogin) {
      return {
        ok: false,
        needsReconnect: true,
        note: 'Your Cloudflare login is missing DNS or Workers Routes access. Reconnect Cloudflare to grant it, then try again.',
      }
    }
    return {
      ok: false,
      note: viaLogin
        ? 'Some records or routes could not be created. Try reconnecting Cloudflare, or use a manual token.'
        : 'Some records or routes failed. Check the token has Zone DNS Edit and Workers Routes Edit for this zone.',
    }
  }

  // --- domain onboarding wizard (Settings → Domain) -------------------------------------------
  // Called ONLY from the admin-gated /api/domain routes in src/server/api/domain.ts, over plain
  // server-side DO RPC (deliberately NOT @callable, so the browser cannot reach these without
  // passing the admin gate). Flow: find-or-create the zone on the user's own account, show the
  // assigned nameservers, poll until the zone is active, then wire this worker to the hostname.
  // State persists in the settings KV so a page reload resumes mid-wait.

  private async cfDomainFetch(token: string, path: string, init?: RequestInit) {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean
      result?: unknown
      errors?: Array<{ code?: number; message?: string }>
    }
    return { httpStatus: res.status, json }
  }

  private static readonly RECONNECT_NOTE = 'Connect Cloudflare first (log in with Cloudflare), then try again.'

  async domainWizardState(): Promise<DomainWizardState | null> {
    return this.getSetting<DomainWizardState | null>('domainWizard', null)
  }

  async domainWizardReset(): Promise<{ ok: true }> {
    this.sql`DELETE FROM settings WHERE k = ${'domainWizard'}`
    return { ok: true }
  }

  /** Step 1: validate the hostname, derive its registrable zone, then find-or-create that zone
   *  (full setup, plan-free) on the user's account. Returns the nameservers to show. */
  async domainStart(input: { hostname: string; zone?: string }): Promise<
    { ok: true; state: DomainWizardState } | { ok: false; note: string; needsReconnect?: boolean }
  > {
    const derived = deriveZone(input.hostname ?? '', input.zone)
    if (!derived.ok) return { ok: false, note: derived.error }
    const token = await this.cfControlToken()
    if (!token) return { ok: false, note: UserAgent.RECONNECT_NOTE, needsReconnect: true }

    // Find the zone on THIS account first; create only when it is genuinely absent.
    const found = await this.cfDomainFetch(token, `/zones?name=${encodeURIComponent(derived.zone)}`)
    const foundErr = { httpStatus: found.httpStatus, errors: found.json.errors }
    if (found.json.success === false && isCfAuthError(foundErr)) {
      return { ok: false, note: describeCfError(foundErr, 'zone-read'), needsReconnect: true }
    }
    let zone = (Array.isArray(found.json.result) ? found.json.result : [])[0] as
      | { id?: string; status?: string; name_servers?: string[] }
      | undefined
    if (!zone?.id) {
      const conn = await this.getDecryptedConnections()
      if (!conn.cloudflareAccountId) {
        return { ok: false, note: 'No Cloudflare account id stored. Reconnect Cloudflare, then try again.', needsReconnect: true }
      }
      // POST /zones is allowed by Zone Edit OR Zone DNS Edit; the OAuth login carries dns.write.
      const created = await this.cfDomainFetch(token, '/zones', {
        method: 'POST',
        body: JSON.stringify({ name: derived.zone, account: { id: conn.cloudflareAccountId }, type: 'full' }),
      })
      const createdZone = created.json.result as { id?: string; status?: string; name_servers?: string[] } | undefined
      if (created.json.success !== true || !createdZone?.id) {
        const errInput = { httpStatus: created.httpStatus, errors: created.json.errors }
        const auth = isCfAuthError(errInput)
        return { ok: false, note: describeCfError(errInput, 'zone-create'), ...(auth ? { needsReconnect: true } : {}) }
      }
      zone = createdZone
    }
    const state: DomainWizardState = {
      hostname: derived.hostname,
      zone: derived.zone,
      zoneId: zone.id!,
      nameServers: zone.name_servers ?? [],
      status: zone.status ?? 'pending',
      step: zone.status === 'active' ? 'attach' : 'nameservers',
      updatedAt: Date.now(),
    }
    this.putSetting('domainWizard', state)
    return { ok: true, state }
  }

  /** Step 2 polling: current zone status + nameservers. Promotes the stored wizard step when the
   *  registrar change lands and the zone flips to active. */
  async domainStatus(zoneId: string): Promise<{ ok: boolean; status?: string; nameServers?: string[]; note?: string; needsReconnect?: boolean }> {
    if (!zoneId) return { ok: false, note: 'Missing zoneId.' }
    const token = await this.cfControlToken()
    if (!token) return { ok: false, note: UserAgent.RECONNECT_NOTE, needsReconnect: true }
    const r = await this.cfDomainFetch(token, `/zones/${encodeURIComponent(zoneId)}`)
    const zone = r.json.result as { status?: string; name_servers?: string[] } | undefined
    if (r.json.success !== true || !zone) {
      const errInput = { httpStatus: r.httpStatus, errors: r.json.errors }
      const auth = isCfAuthError(errInput)
      return { ok: false, note: describeCfError(errInput, 'zone-read'), ...(auth ? { needsReconnect: true } : {}) }
    }
    const status = zone.status ?? 'pending'
    const nameServers = zone.name_servers ?? []
    const state = this.getSetting<DomainWizardState | null>('domainWizard', null)
    if (state && state.zoneId === zoneId && state.step !== 'done') {
      this.putSetting('domainWizard', {
        ...state,
        status,
        nameServers: nameServers.length ? nameServers : state.nameServers,
        step: status === 'active' ? 'attach' : 'nameservers',
        updatedAt: Date.now(),
      })
    }
    return { ok: true, status, nameServers }
  }

  /** Step 3: the zone is active, wire this worker to the hostname. Reuses the same wiring as the
   *  zone-already-on-Cloudflare path: proxied A records + worker routes for the hostname AND
   *  *.hostname (previews). PUT /accounts/:a/workers/domains is NOT used on purpose: it requires
   *  Workers Scripts Write, which the OAuth login does not carry, and it cannot cover the
   *  wildcard previews anyway. */
  async domainAttach(input?: { hostname?: string; zoneId?: string }): Promise<{ ok: boolean; url?: string; note: string; needsReconnect?: boolean }> {
    const stored = this.getSetting<DomainWizardState | null>('domainWizard', null)
    const hostname = normalizeHostname(input?.hostname ?? stored?.hostname ?? '')
    const zoneId = input?.zoneId ?? stored?.zoneId
    if (!hostname || !zoneId) return { ok: false, note: 'Start the domain setup first.' }
    const token = await this.cfControlToken()
    if (!token) return { ok: false, note: UserAgent.RECONNECT_NOTE, needsReconnect: true }
    // Only attach once the zone answers on Cloudflare's nameservers; routes on a pending zone
    // would sit dark and look broken.
    const check = await this.cfDomainFetch(token, `/zones/${encodeURIComponent(zoneId)}`)
    const zone = check.json.result as { status?: string } | undefined
    if (check.json.success !== true || !zone) {
      const errInput = { httpStatus: check.httpStatus, errors: check.json.errors }
      const auth = isCfAuthError(errInput)
      return { ok: false, note: describeCfError(errInput, 'zone-read'), ...(auth ? { needsReconnect: true } : {}) }
    }
    if (zone.status !== 'active') {
      return { ok: false, note: 'The zone is not active yet. Wait for the nameserver change to be picked up, then try again.' }
    }
    const wired = await this.wireDomain(hostname, token, true)
    if (!wired.ok) return wired
    const url = `https://${hostname}`
    if (stored && stored.zoneId === zoneId) {
      this.putSetting('domainWizard', { ...stored, hostname, status: 'active', step: 'done', url, updatedAt: Date.now() })
    }
    return { ok: true, url, note: `${url} is wired to this app. TLS certificates can take a few minutes to issue.` }
  }

  /** Delete the attached (or 'agents'-named) gateway from the USER'S Cloudflare account and
   *  clear the attachment. Used by hard cleanup, normal Detach never touches their account. */
  @callable()
  async deleteAiGateway(): Promise<{ ok: boolean; deleted?: string; note?: string }> {
    const conn = await this.getDecryptedConnections()
    const api = await this.gatewayApi()
    if (!api) return { ok: false, note: 'No Cloudflare credentials.' }
    const target = conn.cloudflareGatewayId || 'agents'
    const res = (await fetch(`${api.base}/${target}`, { method: 'DELETE', headers: api.headers })
      .then((r) => r.json())
      .catch(() => ({}))) as { success?: boolean; errors?: Array<{ message?: string; code?: number }> }
    if (!res.success) {
      const msg = res.errors?.[0]?.message ?? 'Delete failed.'
      // Not-found means it's already gone, that satisfies "zero leftovers".
      if (!/not.?found|does not exist/i.test(msg)) return { ok: false, note: msg }
    }
    await this.saveSettings({ connections: { cloudflareGatewayId: '' } })
    return { ok: true, deleted: target }
  }

  /** Revoke our OAuth grant at Cloudflare's authorization server (RFC 7009) so deleting the
   *  account really severs the connection, not just our copy of the tokens. */
  private async revokeCfOauth(): Promise<void> {
    try {
      const enc = this.getSetting<string | null>('cfOauth', null)
      if (!enc) return
      const bundle = JSON.parse(await decryptSecret(enc, this.env.ENCRYPTION_KEY)) as { access?: string; refresh?: string | null }
      const envx = this.env as unknown as Record<string, string | undefined>
      for (const tok of [bundle.refresh, bundle.access]) {
        if (!tok) continue
        await fetch('https://dash.cloudflare.com/oauth2/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: tok,
            client_id: envx.CF_OAUTH_CLIENT_ID ?? '',
            client_secret: envx.CF_OAUTH_CLIENT_SECRET ?? '',
          }),
        }).catch(() => null)
      }
    } catch { /* best effort */ }
  }

  /** Connect-time convenience: adopt an existing gateway NAMED 'agents' (unambiguously ours);
   *  otherwise leave unset, the UI offers the pick-or-create flow, it's the user's account. */
  @callable()
  async ensureAiGateway(): Promise<{ ok: boolean; gatewayId?: string; note?: string }> {
    const conn = await this.getDecryptedConnections()
    if (conn.cloudflareGatewayId) return { ok: true, gatewayId: conn.cloudflareGatewayId }
    const listed = await this.listAiGateways()
    if (!listed.ok) return { ok: false, note: listed.note }
    if (listed.gateways.includes('agents')) {
      await this.saveSettings({ connections: { cloudflareGatewayId: 'agents' } })
      return { ok: true, gatewayId: 'agents' }
    }
    return { ok: false, note: 'Pick an existing gateway or create one.' }
  }

  /** Magic-link login: remember a pending single-use nonce (15-minute TTL). */
  async storePendingLogin(nonce: string, exp: number): Promise<{ ok: true }> {
    this.sql`DELETE FROM settings WHERE k LIKE 'login:%' AND CAST(v AS INTEGER) < ${Date.now()}`
    this.putSetting(`login:${nonce}`, exp)
    return { ok: true }
  }

  /** Consume a magic-link nonce exactly once. */
  async consumeLoginNonce(nonce: string): Promise<{ ok: boolean }> {
    const exp = this.getSetting<number | null>(`login:${nonce}`, null)
    this.sql`DELETE FROM settings WHERE k = ${'login:' + nonce}`
    return { ok: exp !== null && exp > Date.now() }
  }

  /** Store the Cloudflare OAuth token bundle (from "Log in with Cloudflare"), encrypted. */
  async storeCfOauth(bundle: { access: string; refresh: string | null; expiresAt: number }): Promise<{ ok: true }> {
    this.putSetting('cfOauth', await encryptSecret(JSON.stringify(bundle), this.env.ENCRYPTION_KEY))
    // Mirror into the regular connection slot so the UI/presence checks light up — but NEVER
    // clobber a real pasted API token. The AI Gateway DATA plane rejects OAuth (cfoat_…) tokens,
    // forwarding them upstream as provider keys, so model calls depend on the pasted token.
    const existing = await this.decryptedConnField('cloudflareApiToken')
    if (!existing || existing.startsWith('cfoat')) {
      await this.saveSettings({ connections: { cloudflareApiToken: bundle.access } })
    }
    return { ok: true }
  }

  /** Decrypt one stored connection field (null when absent/undecryptable). */
  private async decryptedConnField(field: string): Promise<string | null> {
    const enc = this.getSetting<string | null>(`conn:${field}`, null)
    if (!enc) return null
    try {
      return await decryptSecret(enc, this.env.ENCRYPTION_KEY)
    } catch {
      return null
    }
  }

  /** Control-plane CF token: prefer the live OAuth token (it carries the dashboard scopes for
   *  gateway management and DNS/route wiring), fall back to the pasted API token. Model calls
   *  (getDecryptedConnections) do the opposite: the data plane needs the real API token. */
  private async cfControlToken(): Promise<string | null> {
    return (await this.freshCfOauthToken()) ?? (await this.decryptedConnField('cloudflareApiToken'))
  }

  /** Fresh AI Gateway data-plane credentials for the /aig broker: the pasted API token when one
   *  exists, else the live (auto-refreshed) OAuth token. Called server-side per proxied request,
   *  so harness containers never hold a credential that can expire. */
  @callable()
  async dataPlaneAuth(): Promise<{ accountId: string; gatewayId: string; token: string } | null> {
    const conn = await this.getDecryptedConnections()
    if (!conn.cloudflareAccountId || !conn.cloudflareGatewayId || !conn.cloudflareApiToken) return null
    return { accountId: conn.cloudflareAccountId, gatewayId: conn.cloudflareGatewayId, token: conn.cloudflareApiToken }
  }

  /** Return a live CF access token from the OAuth bundle, refreshing it when near expiry. */
  private async freshCfOauthToken(): Promise<string | null> {
    const encBundle = this.getSetting<string | null>('cfOauth', null)
    if (!encBundle) return null
    try {
      const bundle = JSON.parse(await decryptSecret(encBundle, this.env.ENCRYPTION_KEY)) as {
        access: string
        refresh: string | null
        expiresAt: number
      }
      const envx = this.env as unknown as Record<string, string | undefined>
      if (bundle.expiresAt - Date.now() < 5 * 60_000 && bundle.refresh && envx.CF_OAUTH_CLIENT_ID && envx.CF_OAUTH_CLIENT_SECRET) {
        const res = await fetch('https://dash.cloudflare.com/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: bundle.refresh,
            client_id: envx.CF_OAUTH_CLIENT_ID,
            client_secret: envx.CF_OAUTH_CLIENT_SECRET,
          }),
        })
        const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number }
        if (res.ok && j.access_token) {
          bundle.access = j.access_token
          bundle.refresh = j.refresh_token ?? bundle.refresh
          bundle.expiresAt = Date.now() + (j.expires_in ?? 3600) * 1000
          await this.storeCfOauth(bundle)
        }
      }
      return bundle.expiresAt > Date.now() ? bundle.access : null
    } catch {
      return null
    }
  }

  /** Decrypt all stored connections (server-side use only, e.g. handed to a SessionAgent). */
  async getDecryptedConnections(): Promise<Connections> {
    const out: Connections = {}
    const key = this.env.ENCRYPTION_KEY
    for (const f of CONNECTION_FIELDS) {
      const enc = this.getSetting<string | null>(`conn:${f}`, null)
      if (enc) out[f] = await decryptSecret(enc, key)
    }
    // Model calls MUST use the real pasted API token when one exists: the AI Gateway data plane
    // rejects OAuth (cfoat_…) tokens and forwards them upstream as provider keys ("Incorrect API
    // key: cfoat…"). The live OAuth token only substitutes for an absent or self-mirrored value,
    // which keeps OAuth-only accounts working with a fresh (auto-refreshed) token.
    const oauthToken = await this.freshCfOauthToken()
    const storedTok = out.cloudflareApiToken
    if (oauthToken && (!storedTok || storedTok.startsWith('cfoat'))) out.cloudflareApiToken = oauthToken
    return out
  }
}
