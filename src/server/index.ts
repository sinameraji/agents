import { Hono } from 'hono'
import { routeAgentRequest } from 'agents'
import { proxyToSandbox } from '@cloudflare/sandbox'
import { resolveIdentity, type Identity } from './auth/access'
import { checkPassword, clearSessionCookie, mintSessionCookie } from './auth/session'
import { fetchOpenRouterModels } from './api/models'

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
  c.header('Set-Cookie', await mintSessionCookie(c.env))
  return c.json({ ok: true })
})

app.post('/api/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie())
  return c.json({ ok: true })
})

// --- auth: everything below requires an identity -------------------------------------------
app.use('*', async (c, next) => {
  const identity = await resolveIdentity(c.req.raw, c.env)
  if (!identity) return c.json({ error: 'unauthenticated' }, 401)
  c.set('identity', identity)
  await next()
})

// --- api ------------------------------------------------------------------------------------
app.get('/api/me', (c) => {
  const { id, email } = c.get('identity')
  return c.json({ id, email })
})

app.get('/api/models', async (c) => {
  const provider = c.req.query('provider') ?? 'openrouter'
  if (provider !== 'openrouter') return c.json({ models: [] })
  try {
    const models = await fetchOpenRouterModels()
    return c.json({ models })
  } catch (err) {
    return c.json({ models: [], error: (err as Error).message }, 502)
  }
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
