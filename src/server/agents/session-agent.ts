import { Agent, callable, getAgentByName } from 'agents'
import { getSandbox } from '@cloudflare/sandbox'
import { createOpencode } from '@cloudflare/sandbox/opencode'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { buildOpencodeConfig, hasProviderKey } from '../opencode-config'
import { mapPart, usageFromInfo, isAssistantComplete } from '../harness/opencode-map'
import { runCfAgentLoop, summarizeMessages } from '../harness/cfagent'
import type { ModelMessage } from 'ai'
// The bridge (pi/KimiFlare/AI-SDK host) ships INSIDE the worker and is written into the container
// at runtime, so its version always matches this deploy, no image rebuilds, no warm-pool staleness.
import bridgeSource from '../../../bridge/dist/bridge.mjs?raw'
import { applyEvent, emptyTranscript } from '~shared/agent-reduce'
import type { AgentEvent, NormTurn, PermissionReply, SessionStatus, TranscriptState } from '~shared/agent'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type Connections,
  type Harness,
  type Provider,
  type SessionMode,
  type SessionSource,
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

interface QueuedMessage {
  messageId?: string
  text: string
  runText?: string
  attachments?: { key: string; name: string; size: number }[]
}

/**
 * One instance per session (name = session id). Thin supervisor: owns the Sandbox + the OpenCode
 * server, PERSISTS the transcript as turns/parts, owns the authoritative status (driven by real
 * harness events, never the client), and relays a normalized AgentEvent stream to the browser.
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
  /** Bumped by stop() and every new turn; in-flight poll loops exit when their captured value goes stale. */
  private turnGen = 0
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
    this.setState({ ...this.state, meta, status: 'idle' })
    // Sync the sessions index too, createSession inserts 'provisioning' and nothing else would
    // clear it until the first turn, leaving never-prompted sessions stuck on that label.
    void getAgentByName(this.env.UserAgent, config.owner).then((u) =>
      u.upsertSessionSummary({ id: this.name, status: 'idle' }),
    )
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
    // An agent-declared preview (the preview tool) counts as reported: the post-turn port scan
    // must not chip the same port again.
    if (ev.t === 'part.upsert' && ev.part.kind === 'preview') {
      const reported = this.getKv<number[]>('reportedPorts', [])
      if (!reported.includes(ev.part.port)) this.putKv('reportedPorts', [...reported, ev.part.port])
    }
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
    this.drainQueue() // stranded queue from a DO eviction drains when a client reconnects
    // Self-heal: a deploy can kill an isolate mid-turn, leaving status stuck on busy/booting.
    // If nothing has progressed in 5 minutes, the run is dead, report idle (or error if the
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
  /** Let the HARNESS itself push: seed git identity + a credential-store entry for github.com
   *  from the user's stored token. The credential lives only on the ephemeral container disk
   *  (outside /workspace, never in backups/exports). Note: any agent running in the sandbox can
   *  read it, that is inherent to giving agents push capability. */
  private async ensureGitCredentials(sandbox: ReturnType<typeof getSandbox>): Promise<void> {
    try {
      const conn = await this.connections()
      if (!conn.githubPat) return
      // Unconditional: the container disk is ephemeral, so a "done" marker would outlive the
      // credentials it refers to. One fast exec per turn is the price of correctness.
      const login = 'x-access-token'
      await sandbox.exec(
        `sh -lc 'git config --global credential.helper store; git config --global user.name dreamweav; git config --global user.email agent@dreamweav.com; printf "https://${login}:%s@github.com\n" "${conn.githubPat}" > ~/.git-credentials; chmod 600 ~/.git-credentials'`,
        { timeout: 20_000 },
      )
    } catch (e) {
      console.error('[dreamweav] git credential setup failed', e)
    }
  }

  /** Tell the harness where it lives: an idempotent AGENTS.md block every harness reads. */
  private async ensureAgentContext(sandbox: ReturnType<typeof getSandbox>): Promise<void> {
    try {
      await sandbox.exec(
        `sh -lc 'grep -qs "dreamweav:start" /workspace/AGENTS.md 2>/dev/null || printf "%s\n" "" "<!-- dreamweav:start -->" "## Environment" "You are running inside Dreamweav, a browser workspace (dreamweav.com). The user interacts through a web chat and can preview web servers you start." "- When you start a dev server, bind 0.0.0.0 and use port 8080 (NEVER 3000, it is reserved by the sandbox). Dreamweav detects the server and opens a live preview for the user automatically, so never link to localhost." "- Do not try to open a browser or take screenshots yourself." "<!-- dreamweav:end -->" >> /workspace/AGENTS.md'`,
        { timeout: 15_000 },
      )
    } catch { /* best-effort */ }
  }

  private async ensureWorkspace(sandbox: ReturnType<typeof getSandbox>): Promise<void> {
    await this.ensureGitCredentials(sandbox)
    await this.ensureAgentContext(sandbox)
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
      // Clone with the token in the URL, then IMMEDIATELY reset the remote to the clean URL so the
      // PAT never persists in .git/config (it would leak via gitStatus, exports, and R2 backups).
      await sandbox
        .exec(`sh -lc 'cd /workspace && git clone --depth 50 ${branch} ${auth}.git . >/tmp/dw-clone.log 2>&1; git remote set-url origin ${url}.git 2>/dev/null; tail -2 /tmp/dw-clone.log'`)
        .catch((e) => {
          console.error('[dreamweav] clone failed', String((e as Error).message ?? e).replaceAll(conn.githubPat ?? '\u0000', '***'))
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
        excludes: ['node_modules', '*.log', '.cache', 'dist', '.next'],
        localBucket: true,
        ttl: 30 * 24 * 60 * 60, // walk-away-for-weeks usage: workspace snapshots live 30 days
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
  /** Unified billing requires an *authenticated* gateway; flip it on in the user's account.
   *  Returns true only when it actually changed something, so callers retry at most once. */
  private async enableGatewayAuthentication(conn: Connections): Promise<boolean> {
    const { cloudflareAccountId: acct, cloudflareGatewayId: gw, cloudflareApiToken: token } = conn
    if (!acct || !gw || !token) return false
    const base = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai-gateway/gateways/${gw}`
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    try {
      const cur = (await (await fetch(base, { headers })).json()) as {
        success?: boolean
        result?: Record<string, unknown> & { authentication?: boolean }
      }
      if (!cur.success || !cur.result || cur.result.authentication === true) return false
      const g = cur.result
      const put = (await (
        await fetch(base, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            cache_invalidate_on_update: g.cache_invalidate_on_update ?? false,
            cache_ttl: g.cache_ttl ?? 0,
            collect_logs: g.collect_logs ?? true,
            rate_limiting_interval: g.rate_limiting_interval ?? 0,
            rate_limiting_limit: g.rate_limiting_limit ?? 0,
            rate_limiting_technique: g.rate_limiting_technique ?? 'fixed',
            authentication: true,
          }),
        })
      ).json()) as { success?: boolean }
      console.log(`[cfagent] enabled authenticated mode on gateway ${gw}: ${String(put.success)}`)
      return put.success === true
    } catch {
      return false
    }
  }

  private async runCfAgentTurn(text: string): Promise<void> {
    const gen = this.turnGen
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

    const runOnce = (model: string) =>
      runCfAgentLoop({
        sandbox,
        provider: cfg.provider,
        model,
        creds: conn,
        mode: this.state.mode,
        messages: history,
        signal: this.cfAbort!.signal,
        emit: {
          part: (part) => this.emit({ t: 'part.upsert', turnId, part }),
          usage: (usage) => this.emit({ t: 'usage', usage }),
        },
      })

    try {
      let result: Awaited<ReturnType<typeof runCfAgentLoop>>
      try {
        result = await runOnce(cfg.model)
      } catch (err) {
        let e = err
        let msg = (e as Error).message
        console.error(`[cfagent] model call failed (model=${cfg.model}):`, msg.slice(0, 1000))
        // Vendor models (openai/…) reach the upstream with NO key when the gateway is not an
        // *authenticated* gateway: unified billing only applies once cf-aig-authorization is
        // verified. Self-heal: flip authentication on in their account and retry the same model.
        const keyless = /gateway authentication is required|didn'?t provide an api key|you must provide an api key/i.test(msg)
        let healed: Awaited<ReturnType<typeof runCfAgentLoop>> | null = null
        if (cfg.provider === 'cloudflare' && keyless && !cfg.model.startsWith('workers-ai/')) {
          if (await this.enableGatewayAuthentication(conn)) {
            try {
              // The setting takes a few seconds to reach the gateway data plane; retrying
              // instantly hits the same 2021 (observed live). One wait, then one retry.
              await new Promise((r) => setTimeout(r, 6000))
              healed = await runOnce(cfg.model)
            } catch (e2) {
              e = e2
              msg = (e2 as Error).message
              console.error('[cfagent] retry after enabling gateway auth failed:', msg.slice(0, 1000))
            }
          }
        }
        if (healed) {
          result = healed
        } else {
          // Still failing: unified billing is unavailable (no credits, or the token was rejected).
          // Fall back to Workers AI so the turn WORKS, and keep the session there.
          const upstreamAuth = /incorrect api key|invalid.*api key|unauthorized|401|provide an api key|gateway authentication is required/i.test(msg)
          const fallback = DEFAULT_MODEL_BY_PROVIDER.cloudflare
          if (cfg.provider === 'cloudflare' && upstreamAuth && !cfg.model.startsWith('workers-ai/') && cfg.model !== fallback) {
            this.emit({
              t: 'part.upsert',
              turnId,
              part: {
                kind: 'text',
                id: `${turnId}:fallback`,
                text: `_${cfg.model} routes upstream through your AI Gateway, which needs unified billing credits (Cloudflare dash → AI Gateway → Billing). Switched this session to ${fallback}, which runs on Workers AI with no extra setup._`,
              },
            })
            this.setModel(fallback)
            result = await runOnce(fallback)
          } else {
            throw e
          }
        }
      }
      const { text: finalText, usage } = result
      history.push({ role: 'assistant', content: finalText })
      this.putKv('cfagent:messages', history.slice(-40))
      this.emit({ t: 'turn.update', id: turnId, patch: { status: 'complete', usage, completedAt: Date.now() } })
      if (this.turnGen === gen) {
        this.setStatus('idle')
        await this.checkpoint()
      }
    } catch (e) {
      const message = (e as Error).message
      const aborted = this.cfAbort?.signal.aborted ?? false
      this.emit({ t: 'part.upsert', turnId, part: { kind: 'error', id: `${turnId}:err`, name: aborted ? 'aborted' : 'error', message: aborted ? 'Stopped.' : message } })
      this.emit({ t: 'turn.update', id: turnId, patch: { status: aborted ? 'aborted' : 'error', completedAt: Date.now(), error: aborted ? undefined : { name: 'error', message } } })
      if (this.turnGen === gen) this.setStatus(aborted ? 'idle' : 'error')
    } finally {
      this.cfAbort = null
    }
  }

  private async runBridgeTurn(text: string): Promise<void> {
    const gen = this.turnGen
    const cfg = this.config()
    const conn = await this.connections()
    if (cfg.harness === 'kimiflare') {
      if (!conn.cloudflareAccountId || !conn.cloudflareApiToken) {
        throw new Error('KimiFlare runs on YOUR Cloudflare account: add your Cloudflare Account ID and API token (and optionally an AI Gateway id) in Settings → Cloudflare AI Gateway.')
      }
      // Capability probe instead of /user/tokens/verify: that endpoint only understands API
      // tokens, but "Log in with Cloudflare" users carry OAuth access tokens. Listing Workers AI
      // models validates what KimiFlare actually needs, for BOTH token kinds.
      const probe = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${conn.cloudflareAccountId}/ai/models/search?per_page=1`,
        { headers: { Authorization: `Bearer ${conn.cloudflareApiToken}` } },
      ).then((r) => ({ ok: r.ok, status: r.status })).catch(() => ({ ok: false, status: 0 }))
      if (!probe.ok) {
        throw new Error(
          `Your Cloudflare credentials were rejected for Workers AI (HTTP ${probe.status}). ` +
            'Log in with Cloudflare again, or add a token with Workers AI + AI Gateway permissions in Settings.',
        )
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

    const deadline = Date.now() + 30 * 60 * 1000 // long agent turns are legit; this only guards runaway polls
    let stable = 0
    let lastSnapshot = ''
    try {
      while (Date.now() < deadline && this.turnGen === gen) {
        await new Promise((r) => setTimeout(r, 600))
        if (this.turnGen !== gen) break
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
      if (this.turnGen === gen) {
        for (const turn of this.transcript.turns) {
          if (turn.role === 'assistant' && turn.status === 'streaming') this.emit({ t: 'turn.update', id: turn.id, patch: { status: 'complete', completedAt: Date.now() } })
        }
      } else {
        this.emit({ t: 'turn.update', id: turnId, patch: { status: 'aborted', completedAt: Date.now() } })
      }
    }
    if (this.turnGen !== gen) return
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
      // The container may have been recycled since this id was minted, verify it still exists
      // on the live OpenCode server before reusing it (a stale id makes turns hang forever).
      const alive = await this.opencode!.session
        .get({ sessionID: known } as never)
        .then((r) => !!(r as { data?: { id?: string } }).data?.id)
        .catch(() => false)
      if (alive) {
        this.opencodeSessionId = known
        return known
      }
      console.warn('[dreamweav] opencode session', known, 'no longer exists (container recycled), creating a new one')
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
    // While a turn runs, new messages QUEUE (the user turn is already in the transcript) and
    // drain in order after the current turn finishes. Stop clears the queue.
    const pending = this.getKv<QueuedMessage[]>('queue', [])
    if (this.state.status === 'busy' || this.state.status === 'booting' || pending.length > 0) {
      this.putKv('queue', [...pending, { messageId: id, text: input.text, runText: input.runText, attachments: input.attachments }])
      if (this.state.status !== 'busy' && this.state.status !== 'booting') this.drainQueue()
      return { ok: true }
    }
    this.startTurn({ messageId: id, text: input.text, runText: input.runText, attachments: input.attachments })
    return { ok: true }
  }

  /** Ports our own infra listens on inside the sandbox, never previewable. */
  // 3000 is the Sandbox SDK's own control plane: exposePort(3000) is categorically rejected.
  private static readonly INFRA_PORTS = new Set([3000, 7700, 4096])
  /** Databases/caches: listening, but not something an iframe can show. */
  private static readonly NON_WEB_PORTS = new Set([5432, 3306, 6379, 27017, 9200, 11211])

  /** After a turn: if the agent started a web server, surface a one-click preview chip. */
  private async detectDevServers(): Promise<void> {
    try {
      const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
      // The container has neither ss nor netstat (both exit 127); /proc/net/tcp is always there.
      // Listening sockets have state 0A; local_address is hexIP:hexPORT.
      const r = (await sandbox
        .exec(`sh -lc 'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null'`, { timeout: 15_000 })
        .catch(() => null)) as { stdout?: string } | null
      if (!r?.stdout) return
      const listening = r.stdout
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((f) => f[3] === '0A' && f[1]?.includes(':'))
        .map((f) => parseInt(f[1].split(':').pop() ?? '', 16))
        .filter((n) => Number.isFinite(n))
      const reported = new Set(this.getKv<number[]>('reportedPorts', []))
      const fresh = [...new Set(listening)]
        .filter(
          (p) =>
            p >= 1024 &&
            p <= 9999 &&
            !SessionAgent.INFRA_PORTS.has(p) &&
            !SessionAgent.NON_WEB_PORTS.has(p) &&
            !reported.has(p),
        )
      if (!fresh.length) return
      // Verify each candidate actually answers HTTP: a crashed server's lingering socket must
      // not earn a chip. Dead ports stay unreported so a healthy server there later still counts.
      const checks = await Promise.all(
        fresh.map(async (port) => {
          const c = (await sandbox
            .exec(
              `sh -lc 'curl -s -o /dev/null -m 3 -w "%{http_code}:%{content_type}" http://127.0.0.1:${port}/ || echo 000:'`,
              { timeout: 10_000 },
            )
            .catch(() => null)) as { stdout?: string } | null
          const [code, ctype = ''] = (c?.stdout ?? '000:').trim().split(':')
          return { port, alive: code !== '000', html: ctype.includes('html') }
        }),
      )
      const alive = checks.filter((c) => c.alive)
      if (!alive.length) return
      this.putKv('reportedPorts', [...reported, ...alive.map((c) => c.port)])
      const lastAssistant = [...this.transcript.turns].reverse().find((t) => t.role === 'assistant')
      // Emit HTML-serving ports last: the client auto-opens the most recent chip, and between a
      // JSON API and a page, the page is the preview.
      alive.sort((a, b) => Number(a.html) - Number(b.html))
      for (const { port } of alive) {
        if (lastAssistant) {
          this.emit({ t: 'part.upsert', turnId: lastAssistant.id, part: { kind: 'preview', id: `preview-${port}`, port } })
        }
      }
    } catch { /* detection is best-effort */ }
  }

  /** Kick off the harness turn for an (already transcript-visible) user message. */
  private startTurn(input: QueuedMessage): void {
    this.turnGen += 1
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
    void run
      .catch((err) => {
        const message = (err as Error).message
        console.error('[dreamweav] turn failed:', (err as Error).stack ?? err)
        const errId = `err-${Date.now()}`
        this.emit({
          t: 'turn.start',
          turn: { id: errId, role: 'assistant', createdAt: Date.now(), status: 'error', error: { name: 'error', message }, parts: [{ kind: 'error', id: `${errId}:e`, name: 'error', message }] },
        })
        this.setStatus('error')
      })
      .finally(() => {
        void this.detectDevServers().finally(() => {
          this.drainQueue()
        })
      })
  }

  /** Run the next queued message, if any, once the session is no longer busy. */
  private drainQueue(): void {
    if (this.state.status === 'busy' || this.state.status === 'booting') return
    const q = this.getKv<QueuedMessage[]>('queue', [])
    if (!q.length) return
    const [next, ...rest] = q
    this.putKv('queue', rest)
    this.startTurn(next)
  }

  private async runOpencodeTurn(text: string): Promise<void> {
    const gen = this.turnGen
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
    await client.session.promptAsync(
      {
        sessionID: ocSession,
        parts: [{ type: 'text', text }],
        ...(mode === 'plan' ? { agent: 'plan' } : {}),
      } as never,
      { throwOnError: true } as never,
    )

    // The SDK's event.subscribe() SSE does not stream over the Sandbox transport, so we POLL
    // session.messages (+ todos) and diff against what we've already emitted. All of OpenCode's
    // assistant messages for this prompt are grouped into ONE Dreamweav turn.
    const turnId = `a-${crypto.randomUUID()}`
    this.emit({ t: 'turn.start', turn: { id: turnId, role: 'assistant', createdAt: Date.now(), status: 'streaming', parts: [] } })

    const deadline = Date.now() + 30 * 60 * 1000 // long agent turns are legit; this only guards runaway polls
    let stable = 0
    let lastSnapshot = ''
    let sawComplete = false
    let loggedPollError = false
    try {
      while (Date.now() < deadline && this.turnGen === gen) {
        await new Promise((r) => setTimeout(r, 600))
        if (this.turnGen !== gen) break
        const res = await client.session
          .messages({ sessionID: ocSession } as never)
          .catch((e: unknown) => {
            if (!loggedPollError) {
              loggedPollError = true
              console.error('[dreamweav] oc messages poll failed', e)
            }
            return { data: [] as unknown[] }
          })
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
      if (this.turnGen === gen) {
        for (const turn of this.transcript.turns) {
          if (turn.role === 'assistant' && turn.status === 'streaming') {
            this.emit({ t: 'turn.update', id: turn.id, patch: { status: 'complete', completedAt: Date.now() } })
          }
        }
      } else {
        this.emit({ t: 'turn.update', id: turnId, patch: { status: 'aborted', completedAt: Date.now() } })
      }
    }
    if (this.turnGen !== gen) return
    this.setStatus('idle')
    await this.checkpoint()
  }

  @callable()
  async stop(): Promise<{ ok: true }> {
    const dropped = this.getKv<QueuedMessage[]>('queue', [])
    this.putKv('queue', []) // stop means stop: drop queued follow-ups too
    for (const q of dropped) {
      if (q.messageId)
        this.emit({ t: 'part.upsert', turnId: q.messageId, part: { kind: 'text', id: `${q.messageId}:cancelled`, text: '_(cancelled, this queued message was not delivered)_' } })
    }
    this.turnGen += 1 // in-flight poll loops see the stale generation and exit
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

  private noted<T extends { ok: boolean; note: string }>(res: T): T {
    this.noteTurn(res.note)
    return res
  }

  @callable()
  async compact(): Promise<{ ok: boolean; note: string }> {
    if (this.state.status === 'busy' || this.state.status === 'booting')
      return this.noted({ ok: false, note: 'The agent is mid-turn, wait for it to finish before compacting.' })
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
      return this.noted({ ok: true, note: 'Context compacted, older turns condensed into a summary.' })
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
      return this.noted({ ok: false, note: 'The harness is not running yet, send a message first.' })
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

  // --- git export ---------------------------------------------------------------------------
  private async sandboxSh(sandbox: ReturnType<typeof getSandbox>, script: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const r = (await sandbox.exec(`sh -lc ${JSON.stringify(script)}`, { timeout: 120_000 })) as {
      exitCode?: number; stdout?: string; stderr?: string
    }
    return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }

  @callable()
  async gitStatus(): Promise<{ repo: boolean; branch: string; dirty: number; remote: string | null; lastCommit: string | null }> {
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    await this.ensureWorkspace(sandbox).catch(() => null)
    // NOTE: single line, the exec wrapper JSON-stringifies the script, so newlines don't survive.
    const { stdout } = await this.sandboxSh(
      sandbox,
      `cd /workspace 2>/dev/null; git config --global --add safe.directory /workspace >/dev/null 2>&1; ` +
        `if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "REPO 1"; else echo "REPO 0"; fi; ` +
        `echo "BRANCH $(git branch --show-current 2>/dev/null)"; ` +
        `echo "DIRTY $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"; ` +
        `echo "REMOTE $(git remote get-url origin 2>/dev/null)"; ` +
        `echo "LAST $(git log -1 --format=%s 2>/dev/null)"`,
    )
    const grab = (k: string) => stdout.split('\n').find((l) => l.startsWith(`${k} `))?.slice(k.length + 1).trim() ?? ''
    return {
      repo: grab('REPO') === '1',
      branch: grab('BRANCH'),
      dirty: Number(grab('DIRTY')) || 0,
      // Strip any userinfo (tokens) that may live in the remote URL, never send credentials to the client.
      remote: (grab('REMOTE') || null)?.replace(/\/\/[^@/]+@/, '//') ?? null,
      lastCommit: grab('LAST') || null,
    }
  }

  /** Commit everything, push a branch to the user's GitHub (creating a private repo for blank
   *  sessions), optionally open a PR. BYO GitHub PAT from Settings. */
  @callable()
  async gitExport(input: { message?: string; branch?: string; openPr?: boolean }): Promise<{ ok: boolean; note: string; branchUrl?: string; prUrl?: string }> {
    const cfg = this.config()
    const conn = await this.connections()
    const pat = conn.githubPat
    if (!pat) return this.noted({ ok: false, note: 'Add a GitHub token in Settings → Connections first.' })

    const gh = async (path: string, init?: RequestInit) => {
      const res = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${pat}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'dreamweav',
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
        },
      })
      return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
    }

    const me = await gh('/user')
    const login = String(me.json.login ?? '')
    if (!login) return this.noted({ ok: false, note: 'The GitHub token was rejected, check it in Settings.' })

    // Where to push: the session's source repo, or a new private repo for blank sessions.
    let owner: string, repo: string, base: string | null = null
    if (cfg.source.kind === 'github') {
      const m = cfg.source.url.replace(/\.git$/, '').match(/github\.com\/([^/]+)\/([^/]+)/)
      if (!m) return this.noted({ ok: false, note: 'Could not parse the session repo URL.' })
      owner = m[1]
      repo = m[2]
      const info = await gh(`/repos/${owner}/${repo}`)
      base = String(info.json.default_branch ?? 'main')
    } else {
      owner = login
      repo = `dreamweav-${this.name.slice(0, 8)}`
      const created = await gh('/user/repos', { method: 'POST', body: JSON.stringify({ name: repo, private: true, description: `Dreamweav session: ${this.state.meta?.name ?? this.name}` }) })
      if (created.status !== 201 && created.status !== 422) {
        return this.noted({ ok: false, note: `Could not create repo ${repo} (HTTP ${created.status}).` })
      }
    }

    const branch = (input.branch ?? cfg.branch).replace(/[^\w/.-]/g, '-').replace(/^[-.]+/, '') || `dreamweav/${this.name.slice(0, 8)}`
    // The message is interpolated into a double-quoted sh word, keep it single-line and quote-free.
    const message = (input.message?.trim() || `Dreamweav: ${this.state.meta?.name ?? 'session export'}`)
      .replace(/[\r\n]+/g, ' ')
      .replace(/["\\$`]/g, "'")
      .slice(0, 200)
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    await this.ensureWorkspace(sandbox).catch(() => null)
    const pushUrl = `https://x-access-token:${pat}@github.com/${owner}/${repo}.git`
    // Single-line script (exec wrapper JSON-stringifies it); push result via explicit markers
    // because the trailing `tail` would otherwise mask git's exit code.
    let r: { exitCode: number; stdout: string; stderr: string }
    try {
      r = await this.sandboxSh(
        sandbox,
        `cd /workspace && git config --global --add safe.directory /workspace >/dev/null 2>&1; ` +
          `git rev-parse --is-inside-work-tree >/dev/null 2>&1 || git init -b ${branch} >/dev/null 2>&1; ` +
          `git config user.name "${login}"; git config user.email "${login}@users.noreply.github.com"; ` +
          `git checkout -B ${branch} >/dev/null 2>&1; git add -A; ` +
          `if git status --porcelain | grep -q .; then git commit -m "${message}" >/tmp/dw-commit.log 2>&1 && echo COMMIT_OK || echo COMMIT_FAIL; else echo NOTHING_TO_COMMIT; fi; ` +
          `git push -f ${pushUrl} ${branch} >/tmp/dw-push.log 2>&1 && echo PUSH_OK || echo PUSH_FAIL; ` +
          `tail -3 /tmp/dw-push.log 2>/dev/null; tail -3 /tmp/dw-commit.log 2>/dev/null`,
      )
    } catch (e) {
      // Never let a transport/timeout error escape with the PAT-bearing command inside it.
      const msg = String((e as Error).message ?? e).replaceAll(pat, '***').slice(0, 300)
      return this.noted({ ok: false, note: `Git push failed: ${msg}` })
    }
    if (r.stdout.includes('COMMIT_FAIL')) {
      const scrubbed = (r.stdout + r.stderr).replaceAll(pat, '***').slice(-400)
      return this.noted({ ok: false, note: `Git commit failed: ${scrubbed}` })
    }
    if (!r.stdout.includes('PUSH_OK')) {
      const scrubbed = (r.stdout + r.stderr).replaceAll(pat, '***').slice(-400)
      return this.noted({ ok: false, note: `Git push failed: ${scrubbed}` })
    }
    const nothingNew = r.stdout.includes('NOTHING_TO_COMMIT') && /up.to.date/i.test(r.stdout)
    const branchUrl = `https://github.com/${owner}/${repo}/tree/${branch}`

    let prUrl: string | undefined
    let prProblem: string | undefined
    if (input.openPr && base && branch !== base) {
      const pr = await gh(`/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        body: JSON.stringify({ title: message, head: branch, base, body: 'Opened from Dreamweav.' }),
      })
      if (pr.status === 201) prUrl = String(pr.json.html_url ?? '')
      else if (pr.status === 422) {
        // A PR for this branch may already exist, find it.
        const list = await gh(`/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`)
        prUrl = String((list.json as unknown as Array<{ html_url?: string }>)[0]?.html_url ?? '') || undefined
        if (!prUrl) prProblem = `PR could not be opened (${String(pr.json.message ?? 'no new commits vs base?')})`
      } else prProblem = `PR could not be opened (HTTP ${pr.status})`
    } else if (input.openPr && !base) {
      prProblem = 'PR skipped, this repo was just created, there is no base branch to target.'
    }
    const note = nothingNew
      ? `Nothing new to commit, branch is up to date: ${branchUrl}`
      : `Pushed ${branch} → ${owner}/${repo}${prUrl ? ` · PR: ${prUrl}` : ''}${prProblem ? ` · ${prProblem}` : ''}\n${branchUrl}`
    return this.noted({ ok: true, note, branchUrl, prUrl })
  }

  // --- fork ---------------------------------------------------------------------------------
  /** Duplicate this session: workspace snapshot + transcript copy into a NEW session. The new
   *  harness starts with fresh context (its internal state is not portable across sessions). */
  @callable()
  async fork(): Promise<{ ok: boolean; note: string; id?: string }> {
    this.hydrate()
    const cfg = this.config()
    await this.checkpoint()
    const backup = this.getKv<unknown>('backup', null)
    const name = `${this.state.meta?.name ?? 'Session'} (fork)`
    const user = await getAgentByName(this.env.UserAgent, cfg.owner)
    const { id } = await user.createSession({
      source: cfg.source, name, harness: cfg.harness, provider: cfg.provider, model: cfg.model,
    })
    const child = await getAgentByName(this.env.SessionAgent, id)
    // createSession fires init at the child asynchronously, init here explicitly so the child is
    // never adopted while unconfigured (it would sit in 'provisioning' forever).
    await child.init({
      owner: cfg.owner, source: cfg.source, harness: cfg.harness, provider: cfg.provider,
      model: cfg.model, name, repo: cfg.repo, branch: `dreamweav/${id.slice(0, 8)}`,
    })
    await child.adoptFork({ backup, turns: this.transcript.turns, todos: this.transcript.todos })
    const snapshotNote = backup ? 'Workspace snapshot and transcript copied' : 'Transcript copied (workspace snapshot unavailable, the fork starts from the repo/blank state)'
    return this.noted({ ok: true, note: `Forked → “${name}”. ${snapshotNote}; the harness starts fresh context there.`, id })
  }

  /** Erase this session completely: transcript, kv (config/creds refs/queue), synced state, and
   *  its sandbox. Server-to-server only (no @callable), used by UserAgent.resetAccount(). */
  async wipe(): Promise<{ ok: true }> {
    this.turnGen += 1 // kill any in-flight poll loops
    this.sql`DELETE FROM turns`
    this.sql`DELETE FROM kv`
    this.transcript = emptyTranscript()
    this.hydrated = true
    this.emittedParts.clear()
    this.opencode = undefined
    this.opencodeSessionId = undefined
    this.setState({ meta: null, status: 'idle', mode: 'build', usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } })
    try {
      await getSandbox(this.env.Sandbox, `sess-${this.name}`).destroy()
    } catch { /* already gone */ }
    return { ok: true }
  }

  /** Seed a freshly-created session from a fork: workspace backup pointer + transcript.
   *  Server-to-server only (no @callable): fork() calls it right after creating the child. */
  async adoptFork(input: { backup: unknown; turns: NormTurn[]; todos: TranscriptState['todos'] }): Promise<{ ok: boolean }> {
    const existing = this.sql<{ n: number }>`SELECT COUNT(*) as n FROM turns`
    if ((existing[0]?.n ?? 0) > 0) return { ok: false } // never wipe a session that already has history
    if (input.backup) this.putKv('backup', input.backup)
    this.sql`DELETE FROM turns`
    // A fork can happen mid-turn: freeze any still-streaming turns as aborted in the copy.
    const turns = input.turns.map((t) =>
      t.status === 'streaming' ? { ...t, status: 'aborted' as const, completedAt: Date.now() } : t,
    )
    this.transcript = { turns, todos: input.todos ?? [], permissions: [] }
    this.hydrated = true
    let seq = 0
    for (const t of turns) this.persistTurn(t.id, ++seq)
    this.putKv('todos', this.transcript.todos)
    this.putKv('permissions', [])
    return { ok: true }
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

  // --- workspace (files, preview), used by the workspace dock ------------------------------
  @callable()
  async listFiles(path = '/workspace'): Promise<{ files: { name: string; path: string; isDirectory: boolean; size: number }[] }> {
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    try {
      let res = (await sandbox.listFiles(path)) as {
        files?: { name: string; absolutePath: string; type: string; size: number }[]
      }
      if (path === '/workspace' && !(res.files ?? []).length) {
        // Container disk does not survive sleep, restore the workspace (backup / clone) and retry.
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

  /** Which of these ports answer HTTP right now. The preview panel shows only live servers:
   *  a chip for a dead one is an invitation to an error message. */
  @callable()
  async checkPorts(ports: number[]): Promise<{ alive: number[] }> {
    const candidates = [...new Set(ports)].filter((p) => Number.isInteger(p) && p > 0 && p <= 65535 && p !== 3000).slice(0, 12)
    if (!candidates.length) return { alive: [] }
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    const script = candidates
      .map((p) => `printf "%s:" ${p}; curl -s -o /dev/null -m 2 -w "%{http_code}" http://127.0.0.1:${p}/ || printf 000; echo`)
      .join('; ')
    const r = (await sandbox.exec(`sh -lc '${script}'`, { timeout: 20_000 }).catch(() => null)) as { stdout?: string } | null
    const alive = (r?.stdout ?? '')
      .split('\n')
      .map((line) => line.trim().split(':'))
      .filter((f) => f.length === 2 && f[1] !== '000' && f[1] !== '')
      .map((f) => Number(f[0]))
      .filter((n) => Number.isFinite(n))
    return { alive }
  }

  @callable()
  async exposePort(
    port: number,
    hostname = 'dreamweav.com',
  ): Promise<{ url: string | null; reason?: 'nothing-listening' | 'expose-failed' | 'reserved-port' }> {
    if (port === 3000) return { url: null, reason: 'reserved-port' }
    const sandbox = getSandbox(this.env.Sandbox, `sess-${this.name}`)
    // Probe first so a dead server gets an honest "nothing is answering" instead of an
    // infrastructure-sounding failure.
    const probe = (await sandbox
      .exec(`sh -lc 'curl -s -o /dev/null -m 3 -w "%{http_code}" http://127.0.0.1:${port}/ || echo 000'`, {
        timeout: 10_000,
      })
      .catch(() => null)) as { stdout?: string } | null
    if ((probe?.stdout ?? '000').trim() === '000') return { url: null, reason: 'nothing-listening' }
    // On workers.dev there is no wildcard DNS: exposePort "succeeds" with a URL that can never
    // resolve. Quick tunnels (trycloudflare) are the real path there; elsewhere they are the
    // fallback so self-hosters without a custom domain still get previews.
    const isWorkersDev = /(^|\.)workers\.dev$/.test(hostname.split(':')[0])
    if (!isWorkersDev) {
      try {
        const res = (await sandbox.exposePort(port, { hostname })) as { url?: string }
        if (res.url) return { url: res.url }
      } catch (e) {
        console.error(`[preview] exposePort(${port}) failed:`, (e as Error).message)
      }
      // exposePort throws on an already-exposed port; reuse the existing mapping instead.
      try {
        const existing = (await sandbox.getExposedPorts(hostname)) as Array<{ url: string; port: number }>
        const match = existing.find((e) => e.port === port)
        if (match) return { url: match.url }
      } catch (e) {
        console.error(`[preview] getExposedPorts failed:`, (e as Error).message)
      }
    }
    try {
      const tunnels = (sandbox as unknown as { tunnels: { get(p: number): Promise<{ url?: string }> } }).tunnels
      const t = await tunnels.get(port)
      if (t?.url) return { url: t.url }
    } catch (e) {
      console.error(`[preview] quick tunnel for ${port} failed:`, (e as Error).message)
    }
    return { url: null, reason: 'expose-failed' }
  }
}
