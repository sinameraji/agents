import { Hono } from 'hono'
import { routeAgentRequest } from 'agents'
import { collectFile, getSandbox as sdkGetSandbox, proxyToSandbox } from '@cloudflare/sandbox'

/** Same RPC transport as session-agent.ts - the SDK requires one consistent transport per sandbox. */
const getSandbox: typeof sdkGetSandbox = (ns, id, opts) =>
  sdkGetSandbox(ns, id, { ...opts, transport: 'rpc' })
import { resolveIdentity, type Identity } from './auth/access'
import { checkPassword, clearSessionCookie, mintSessionCookie } from './auth/session'
import { finishCfLogin, finishEmailLogin, finishGithubLogin, startCfLogin, startEmailLogin, startGithubLogin } from './auth/oauth'
import { memberAccess, ORG_NAME } from './auth/membership'
import { registerOrgRoutes } from './api/org'
import { registerDomainRoutes } from './api/domain'
import { modelCatalog } from './api/models'
import { handleUpload } from './api/uploads'
import { getAgentByName } from 'agents'
import type { Connections, OrgRole, Provider } from '~shared/protocol'

export { UserAgent } from './agents/user-agent'
export { SessionAgent } from './agents/session-agent'
export { OrgAgent } from './agents/org-agent'
export { Sandbox } from '@cloudflare/sandbox'

type Variables = { identity: Identity; role: OrgRole }
const app = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Header we set (never trust from the client) so agents can authorize per-user access. */
export const USER_HEADER = 'x-dreamweav-user'

// --- login (unauthenticated) ---------------------------------------------------------------
app.post('/api/login', async (c) => {
  const { password } = (await c.req.json().catch(() => ({}))) as { password?: string }
  if (!password || !(await checkPassword(password, c.env))) {
    return c.json({ error: 'invalid password' }, 401)
  }
  const cookie = await mintSessionCookie(c.env)
  if (!cookie) return c.json({ error: 'owner is not in the allowlist' }, 403)
  c.header('Set-Cookie', cookie)
  return c.json({ ok: true })
})

app.post('/api/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie())
  return c.json({ ok: true })
})

// Which login providers are configured (drives the login screen buttons).
/** Host role for this request: the public landing host, the owner host, or a plain app host. */
function hostRole(c: { req: { url: string }; env: unknown }): 'landing' | 'owner' | 'app' {
  const host = new URL(c.req.url).hostname.toLowerCase()
  const env = c.env as Record<string, string | undefined>
  const landing = (env.LANDING_HOSTS ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (landing.includes(host)) return 'landing'
  if ((env.OWNER_HOST ?? '').toLowerCase() === host) return 'owner'
  return 'app'
}

// What this host IS (drives landing page vs app shell client-side).
// The old dreamweav.com hosts carry nothing anymore, and the bare/www company domain funnels
// into the landing host — everything 308s to agents.insertcompanywebsite.com. /aig is exempt
// so sandboxes booted before a cutover keep their broker URL working on any host.
app.use('*', async (c, next) => {
  const u = new URL(c.req.url)
  const host = u.hostname.toLowerCase()
  const legacy = host.endsWith('dreamweav.com')
  const bare = host === 'insertcompanywebsite.com' || host === 'www.insertcompanywebsite.com'
  if ((legacy || bare) && !u.pathname.startsWith('/aig/')) {
    return c.redirect(`https://agents.insertcompanywebsite.com${u.pathname}${u.search}`, 308)
  }
  return next()
})

app.get('/api/config', (c) => c.json({ mode: hostRole(c) === 'landing' ? 'landing' : 'app' }))

app.get('/api/auth/providers', (c) => {
  const env = c.env as unknown as Record<string, string | undefined>
  // The owner host is Cloudflare-only by design: one door, no password/GitHub/email fallbacks.
  if (hostRole(c) === 'owner') {
    return c.json({
      cloudflare: !!env.CF_OAUTH_CLIENT_ID && !!env.CF_OAUTH_CLIENT_SECRET,
      github: false,
      email: false,
      password: false,
    })
  }
  return c.json({
    cloudflare: !!env.CF_OAUTH_CLIENT_ID && !!env.CF_OAUTH_CLIENT_SECRET,
    github: !!env.GITHUB_OAUTH_CLIENT_ID && !!env.GITHUB_OAUTH_CLIENT_SECRET,
    email: !!(c.env as unknown as { EMAIL?: unknown }).EMAIL,
    password: !!env.APP_PASSWORD,
  })
})

// Magic-link login (unauthenticated by design)
app.post('/api/login/email', async (c) => {
  const { email } = (await c.req.json().catch(() => ({}))) as { email?: string }
  return startEmailLogin(c.req.raw, c.env as never, email ?? '', (c.env as unknown as { EMAIL?: never }).EMAIL)
})
app.get('/auth/email/callback', (c) => finishEmailLogin(c.req.raw, c.env as never))

// OAuth logins (unauthenticated by design). A logged-in user hitting /auth/cloudflare is a
// CONNECT flow: Cloudflare creds provision onto their existing account, no identity switch.
app.get('/auth/cloudflare', async (c) => {
  const identity = await resolveIdentity(c.req.raw, c.env)
  return startCfLogin(c.req.raw, c.env as never, identity?.id)
})
app.get('/auth/cloudflare/callback', (c) => finishCfLogin(c.req.raw, c.env as never))
app.get('/auth/github', (c) => startGithubLogin(c.req.raw, c.env as never))
app.get('/auth/github/callback', (c) => finishGithubLogin(c.req.raw, c.env as never))

// --- auth: guard only the API and agent routes, never the static app --------------------------
// (The SPA must always load so it can render the login screen and call /api/login.)
const requireAuth = async (c: any, next: any) => {
  const identity = await resolveIdentity(c.req.raw, c.env)
  if (!identity) return c.json({ error: 'unauthenticated' }, 401)
  c.set('identity', identity)
  await next()
}
app.use('/api/*', requireAuth)
app.use('/agents/*', requireAuth)

// AI Gateway broker: harnesses in the sandbox call the WORKER, never Cloudflare directly, so the
// gateway credential is stamped fresh server-side on every request — nothing that can expire ever
// lives in the container, and every harness shares one keyless unified-billing path. Auth is a
// per-session bearer minted at boot (constant-time checked in the SessionAgent).
app.all('/aig/:sid/*', async (c) => {
  const sid = c.req.param('sid')
  const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (bearer.length < 32) return c.json({ error: 'unauthorized' }, 401)
  const sa = await getAgentByName(c.env.SessionAgent, sid)
  const v = await sa.proxyAuth(bearer).catch(() => ({ ok: false, owner: null }))
  if (!v.ok || !v.owner) return c.json({ error: 'unauthorized' }, 401)
  const user = await getAgentByName(c.env.UserAgent, v.owner)
  const auth = await user.dataPlaneAuth()
  if (!auth) return c.json({ error: 'cloudflare_not_connected' }, 502)
  const u = new URL(c.req.url)
  const rest = u.pathname.slice(`/aig/${sid}/`.length) + u.search
  const headers: Record<string, string> = { 'cf-aig-authorization': `Bearer ${auth.token}` }
  const ct = c.req.header('content-type')
  if (ct) headers['content-type'] = ct
  const accept = c.req.header('accept')
  if (accept) headers.accept = accept
  // Buffered (not streamed) so a geo-blocked request can be replayed on the fallback path below.
  const reqBody = c.req.method === 'POST' ? await c.req.raw.arrayBuffer() : undefined
  const upstream = await fetch(`https://gateway.ai.cloudflare.com/v1/${auth.accountId}/${auth.gatewayId}/${rest}`, {
    method: c.req.method,
    headers,
    body: reqBody,
  })
  // Unified billing egresses from whichever Cloudflare colo serves the request, and some vendors
  // geo-block their own supported-country list (OpenAI 403s from HKG, for example). The raw
  // "Country, region, or territory not supported" reads like a broken key, so name the real cause
  // and the edge it came from; other models on the same gateway keep working.
  if (upstream.status === 403) {
    const text = await upstream.text()
    if (/country,?\s*region,?\s*or territory/i.test(text)) {
      // The refusal follows the Cloudflare colo this request happened to egress from, not the
      // user: the same session on the same model succeeds via NRT and fails via HKG minutes apart.
      // Cloudflare's REST inference endpoint is not served from the edge colo (its gateway logs
      // carry no colo at all), so replaying there routes around a blocked edge instead of handing
      // the user a dead turn. Same account, same credits, same unified billing.
      if (reqBody && rest.startsWith('compat/')) {
        const alt = await fetch(`https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/ai/v1/${rest.slice('compat/'.length)}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth.token}`, 'cf-aig-gateway-id': auth.gatewayId, 'content-type': 'application/json' },
          body: reqBody,
        })
        if (alt.ok) {
          console.log('[aig] geo-blocked at the edge, served via the REST endpoint instead')
          return alt
        }
      }
      const colo = (upstream.headers.get('cf-ray') ?? '').split('-')[1] || 'this'
      const message = `This model's provider refused the request from Cloudflare's ${colo} edge because it does not serve that region. Your credits and key are fine, and the model itself works. This session's sandbox sits behind that edge, so the reliable fix is to start a new session (new sandboxes are placed in a region the vendors serve). Workers AI and Anthropic models keep working in this one.`
      return c.json({ error: { message, type: 'region_not_supported', code: 'unsupported_country_region_territory', upstream: text.slice(0, 300) } }, 403)
    }
    return c.newResponse(text, 403, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
  }
  // Unified billing enforces its own throughput ceiling; the raw "Wholesale rate limit exceeded"
  // says nothing about what to do next.
  if (upstream.status === 402 || upstream.status === 429) {
    const text = await upstream.text()
    if (/wholesale/i.test(text)) {
      const message = 'Cloudflare unified billing is rate limiting this account right now (wholesale limit). Wait a moment and retry, or switch to a Workers AI model, which is billed directly and not subject to this limit.'
      return c.json({ error: { message, type: 'wholesale_rate_limited', upstream: text.slice(0, 200) } }, 429)
    }
    return c.newResponse(text, upstream.status as 402 | 429, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
  }
  return upstream
})

// --- api ------------------------------------------------------------------------------------
// Identity + membership. Authenticated but NOT a member returns role:null so the SPA can render
// the "ask your admin for access" screen. This route is deliberately reachable by non-members,
// so it is registered BEFORE the membership gate below.
app.get('/api/me', async (c) => {
  const { id, email } = c.get('identity')
  const { active, role } = await memberAccess(c.env, email)
  // When an admin set a monthly budget cap for this member, include cap + current-month spend
  // so the UI can render a usage meter. Best-effort: a failed lookup only omits the fields.
  let budget: { capUsd: number; spentUsd: number } | undefined
  if (active) {
    try {
      const org = await getAgentByName(c.env.OrgAgent, ORG_NAME)
      const capUsd = await org.capFor(email)
      if (capUsd !== null) {
        const user = await getAgentByName(c.env.UserAgent, id)
        const { spentUsd } = await user.monthlySpend()
        budget = { capUsd, spentUsd }
      }
    } catch (e) {
      console.warn('[agents] /api/me budget lookup failed:', e)
    }
  }
  return c.json({ id, email, role: active ? role : null, ...(budget ?? {}) })
})

// --- membership gate: every guarded API + agent route past here requires an active member ------
// (Registered AFTER /api/me so a non-member can still learn they need access.) A non-member gets
// a clear JSON 403 the SPA renders as the ask-your-admin screen. `role` is stashed for admin routes.
const requireMember = async (c: any, next: any) => {
  const identity = c.get('identity') as Identity
  const { active, role } = await memberAccess(c.env, identity.email)
  if (!active || !role) return c.json({ error: 'not_a_member' }, 403)
  c.set('role', role)
  await next()
}
app.use('/api/*', requireMember)
app.use('/agents/*', requireMember)

// Admin-only roster management (each route re-verifies the caller's admin role server-side).
registerOrgRoutes(app)



// Admin-only custom-domain onboarding wizard (zone create → nameservers → attach).
registerDomainRoutes(app)

app.get('/api/models', async (c) => {
  const provider = (c.req.query('provider') ?? 'openrouter') as Provider
  const harness = c.req.query('harness') ?? undefined
  // The catalog itself (and the pricing in it) lives in api/models.ts, so the SessionAgent prices
  // turns against exactly what the picker shows.
  let conn: Connections | undefined
  if (provider === 'cloudflare' && harness !== 'kimiflare') {
    try {
      const identity = c.get('identity')
      const user = await getAgentByName(c.env.UserAgent, identity.id)
      conn = (await user.getDecryptedConnections()) as Connections
    } catch { /* no connections: modelCatalog falls back to its static list */ }
  }
  try {
    return c.json({ models: await modelCatalog({ provider, harness, conn }) })
  } catch (err) {
    return c.json({ models: [], error: (err as Error).message }, 502)
  }
})

app.post('/api/uploads', handleUpload)

// Programmatic settings/connections update (same shape as UserAgent.saveSettings input).
app.post('/api/connections', async (c) => {
  const identity = c.get('identity')
  const body = (await c.req.json().catch(() => null)) as {
    settings?: Record<string, unknown>
    connections?: Record<string, string>
  } | null
  if (!body) return c.json({ error: 'bad json' }, 400)
  const user = await getAgentByName(c.env.UserAgent, identity.id)
  const res = await user.saveSettings(body as never)
  return c.json(res)
})

// Hard cleanup: delete the Agents-attached AI Gateway from the user's own Cloudflare account.
app.post('/api/gateway/delete', async (c) => {
  const identity = c.get('identity')
  const user = await getAgentByName(c.env.UserAgent, identity.id)
  return c.json(await user.deleteAiGateway())
})

// Factory reset: wipe every session, sandbox, setting, and stored credential for this user.
app.post('/api/reset', async (c) => {
  const identity = c.get('identity')
  const user = await getAgentByName(c.env.UserAgent, identity.id)
  const res = await user.resetAccount()
  return c.json(res)
})


// Download the session workspace as a gzipped tarball, streamed straight from the sandbox.
app.get('/api/sessions/:id/export', async (c) => {
  const identity = c.get('identity')
  const id = c.req.param('id')
  const user = await getAgentByName(c.env.UserAgent, identity.id)
  const sessions = await user.listSessions()
  if (!sessions.some((s) => s.id === id)) return c.json({ error: 'not found' }, 404)
  // listFiles restores /workspace from backup if the container was recycled while asleep.
  await getAgentByName(c.env.SessionAgent, id).then((sa) => sa.listFiles()).catch(() => null)
  const sandbox = getSandbox(c.env.Sandbox, `sess-${id}`)
  // .git is excluded entirely: backups strip its objects (repo would be corrupt) and its config
  // can carry an authenticated clone URL, the export is a source snapshot, not a repository.
  const tar = (await sandbox
    .exec(
      `sh -lc ${JSON.stringify(
        'cd /workspace && tar --exclude=node_modules --exclude=.git --exclude=.cache --exclude=dist --exclude=.next -czf /tmp/dw-export.tgz .',
      )}`,
      { timeout: 120_000 },
    )
    .catch(() => ({ exitCode: 2 }))) as { exitCode?: number }
  // GNU tar exit 1 = "file changed while reading" — the archive is still valid.
  if ((tar.exitCode ?? 0) > 1) return c.json({ error: 'could not archive the workspace' }, 500)
  // readFileStream emits SSE-framed FileStreamEvents, not raw bytes, collectFile decodes them.
  const stream = await sandbox.readFileStream('/tmp/dw-export.tgz')
  const { content } = await collectFile(stream)
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  return new Response(bytes, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="agents-${id.slice(0, 8)}.tgz"`,
    },
  })
})

// --- agents (WebSocket + HTTP) ---------------------------------------------------------------
app.all('/agents/*', async (c) => {
  const identity = c.get('identity')
  const url = new URL(c.req.url)
  // /agents/<agent>/<name>[/...]
  const [, , agent, name] = url.pathname.split('/')
  // Per-user agents must be addressed by the caller's own id.
  if (agent === 'user-agent' && name !== identity.id) return c.json({ error: 'forbidden' }, 403)
  const headers = new Headers(c.req.raw.headers)
  headers.set(USER_HEADER, identity.id)
  const req = new Request(c.req.raw, { headers })
  const res = await routeAgentRequest(req, c.env)
  return res ?? c.json({ error: 'agent not found' }, 404)
})

// --- SPA / static assets ---------------------------------------------------------------------
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Preview URLs for services running in a sandbox (e.g. a dev server) arrive on *.insertcompanywebsite.com
    // and must be routed to the container before anything else.
    const proxied = await proxyToSandbox(request, env)
    if (proxied) return proxied
    return app.fetch(request, env, ctx)
  },
}
