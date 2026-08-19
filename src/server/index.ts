import { Hono } from 'hono'
import { routeAgentRequest } from 'agents'
import { collectFile, getSandbox as sdkGetSandbox, proxyToSandbox } from '@cloudflare/sandbox'

/** Same RPC transport as session-agent.ts - the SDK requires one consistent transport per sandbox. */
const getSandbox: typeof sdkGetSandbox = (ns, id, opts) =>
  sdkGetSandbox(ns, id, { ...opts, transport: 'rpc' })
import { resolveIdentity, type Identity } from './auth/access'
import { checkPassword, clearSessionCookie, mintSessionCookie } from './auth/session'
import { finishCfLogin, finishEmailLogin, finishGithubLogin, startCfLogin, startEmailLogin, startGithubLogin } from './auth/oauth'
import { fetchOpenRouterModels } from './api/models'
import { handleUpload } from './api/uploads'
import { getAgentByName } from 'agents'

export { UserAgent } from './agents/user-agent'
export { SessionAgent } from './agents/session-agent'
export { Sandbox } from '@cloudflare/sandbox'

type Variables = { identity: Identity }
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

// --- api ------------------------------------------------------------------------------------
app.get('/api/me', (c) => {
  const { id, email } = c.get('identity')
  return c.json({ id, email })
})

app.get('/api/models', async (c) => {
  const provider = c.req.query('provider') ?? 'openrouter'
  if (provider === 'openrouter') {
    try {
      return c.json({ models: await fetchOpenRouterModels() })
    } catch (err) {
      return c.json({ models: [], error: (err as Error).message }, 502)
    }
  }
  if (provider === 'cloudflare') {
    // Workers AI models from the user's own account (billed by Cloudflare), plus popular
    // upstreams reachable through the gateway's unified billing.
    // Verified against the unified-billing catalog (accounts/{id}/ai/v1): these exact ids work.
    const unified = [
      { id: 'openai/gpt-5.1', label: 'gpt-5.1 (unified billing)', provider: 'cloudflare', inputPerM: 1.25, outputPerM: 10 },
      { id: 'openai/gpt-4.1-mini', label: 'gpt-4.1-mini (unified billing)', provider: 'cloudflare', inputPerM: 0.4, outputPerM: 1.6 },
      { id: 'anthropic/claude-sonnet-4.5', label: 'claude-sonnet-4.5 (unified billing)', provider: 'cloudflare', inputPerM: 3, outputPerM: 15 },
      { id: 'anthropic/claude-haiku-4.5', label: 'claude-haiku-4.5 (unified billing)', provider: 'cloudflare', inputPerM: 1, outputPerM: 5 },
    ]
    try {
      const identity = c.get('identity')
      const user = await getAgentByName(c.env.UserAgent, identity.id)
      const conn = (await user.getDecryptedConnections()) as { cloudflareAccountId?: string; cloudflareApiToken?: string }
      if (conn.cloudflareAccountId && conn.cloudflareApiToken) {
        const res = (await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${conn.cloudflareAccountId}/ai/models/search?task=Text%20Generation&per_page=100`,
          { headers: { authorization: `Bearer ${conn.cloudflareApiToken}` } },
        ).then((r) => r.json())) as { success?: boolean; result?: Array<{ name?: string }> }
        const wai = (res.result ?? [])
          .map((m) => String(m.name ?? ''))
          .filter(Boolean)
          .map((name) => ({ id: `workers-ai/${name}`, label: name.replace('@cf/', ''), provider: 'cloudflare', inputPerM: 0, outputPerM: 0 }))
        return c.json({ models: [...wai, ...unified] })
      }
    } catch { /* fall through to the static list */ }
    return c.json({
      models: [
        { id: 'workers-ai/@cf/openai/gpt-oss-120b', label: 'gpt-oss-120b (Workers AI)', provider: 'cloudflare', inputPerM: 0, outputPerM: 0 },
        { id: 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'llama-3.3-70b (Workers AI)', provider: 'cloudflare', inputPerM: 0, outputPerM: 0 },
        ...unified,
      ],
    })
  }
  return c.json({ models: [] })
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

// Hard cleanup: delete the Dreamweav-attached AI Gateway from the user's own Cloudflare account.
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
      'content-disposition': `attachment; filename="dreamweav-${id.slice(0, 8)}.tgz"`,
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
    // Preview URLs for services running in a sandbox (e.g. a dev server) arrive on *.dreamweav.com
    // and must be routed to the container before anything else.
    const proxied = await proxyToSandbox(request, env)
    if (proxied) return proxied
    return app.fetch(request, env, ctx)
  },
}
