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

// KimiFlare's supported models, from its registry (src/models/registry.ts in sinameraji/kimiflare):
// the @cf/ ones are Workers AI (run on the account directly, gateway optional); kimi-k3 is a
// Cloudflare-catalog model that ONLY works via unified billing (AI Gateway credits).
const KIMIFLARE_MODELS = [
  { id: 'workers-ai/@cf/moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code · Workers AI', provider: 'cloudflare', inputPerM: 0.95, outputPerM: 4 },
  { id: 'workers-ai/@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6 · Workers AI', provider: 'cloudflare', inputPerM: 0.95, outputPerM: 4 },
  { id: 'workers-ai/@cf/moonshotai/kimi-k2.5', label: 'Kimi K2.5 · Workers AI', provider: 'cloudflare', inputPerM: 0.55, outputPerM: 2.19 },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3 · unified billing', provider: 'cloudflare', inputPerM: 3, outputPerM: 15 },
  { id: 'workers-ai/@cf/zai-org/glm-5.2', label: 'GLM 5.2 · Workers AI', provider: 'cloudflare', inputPerM: 1.4, outputPerM: 4.4 },
]

// Fallback unified-billing catalog if the live fetch fails. Kept current by hand as a safety net.
const UNIFIED_FALLBACK = [
  { id: 'openai/gpt-5.6-sol', label: 'gpt-5.6-sol · unified billing', provider: 'cloudflare', inputPerM: 1.25, outputPerM: 7.5 },
  { id: 'openai/gpt-5.6-luna', label: 'gpt-5.6-luna · unified billing', provider: 'cloudflare', inputPerM: 0.1, outputPerM: 0.6 },
  { id: 'openai/gpt-5.1', label: 'gpt-5.1 · unified billing', provider: 'cloudflare', inputPerM: 1.25, outputPerM: 10 },
  { id: 'openai/gpt-4.1-mini', label: 'gpt-4.1-mini · unified billing', provider: 'cloudflare', inputPerM: 0.4, outputPerM: 1.6 },
  { id: 'anthropic/claude-sonnet-4.5', label: 'claude-sonnet-4.5 · unified billing', provider: 'cloudflare', inputPerM: 3, outputPerM: 15 },
  { id: 'anthropic/claude-haiku-4.5', label: 'claude-haiku-4.5 · unified billing', provider: 'cloudflare', inputPerM: 1, outputPerM: 5 },
]

/** Live unified-billing catalog from the gateway's OpenAI-compatible /models list, filtered to
 *  chat models from providers Cloudflare bills on the user's behalf. Empty array on any failure. */
async function fetchUnifiedCatalog(acct: string, token: string, gatewayId: string): Promise<Array<{ id: string; label: string; provider: string; inputPerM: number; outputPerM: number }>> {
  if (!gatewayId) return []
  try {
    const res = (await fetch(`https://gateway.ai.cloudflare.com/v1/${acct}/${gatewayId}/compat/models`, {
      headers: { 'cf-aig-authorization': `Bearer ${token}` },
    }).then((r) => r.json())) as { data?: Array<{ id?: string; owned_by?: string; cost_in?: number; cost_out?: number }> }
    if (!Array.isArray(res.data)) return []
    const UNIFIED_OWNERS = new Set(['openai', 'anthropic', 'google-ai-studio', 'xai', 'groq'])
    // Non-chat / specialized / duplicate variants that shouldn't clutter a coding-model picker.
    const EXCLUDE = /(:batch|embed|whisper|tts|dall|image|imagen|realtime|moderation|audio|transcribe|rerank|robotics|live|translate|omni|-vision|guard|banana|-search|lyria|veo|deep-research|computer-use|clip|learnlm|aqa|-\d{8}$)/i
    return res.data
      .filter((m) => {
        if (!m.id || !UNIFIED_OWNERS.has(String(m.owned_by))) return false
        // Skip malformed doubled-owner ids like "anthropic/anthropic/..." or "xai/xai/...".
        const parts = m.id.split('/')
        if (parts.length > 2 && parts[0] === parts[1]) return false
        return !EXCLUDE.test(m.id)
      })
      .map((m) => ({
        id: m.id!,
        label: `${m.id!.split('/').pop()} · unified billing`,
        provider: 'cloudflare',
        inputPerM: (m.cost_in ?? 0) * 1_000_000,
        outputPerM: (m.cost_out ?? 0) * 1_000_000,
      }))
  } catch {
    return []
  }
}

app.get('/api/models', async (c) => {
  const provider = c.req.query('provider') ?? 'openrouter'
  const harness = c.req.query('harness')
  // KimiFlare only runs Kimi/GLM models on the user's Cloudflare — show exactly those.
  if (harness === 'kimiflare') return c.json({ models: KIMIFLARE_MODELS })

  if (provider === 'openrouter') {
    try {
      return c.json({ models: await fetchOpenRouterModels() })
    } catch (err) {
      return c.json({ models: [], error: (err as Error).message }, 502)
    }
  }
  if (provider === 'cloudflare') {
    try {
      const identity = c.get('identity')
      const user = await getAgentByName(c.env.UserAgent, identity.id)
      const conn = (await user.getDecryptedConnections()) as { cloudflareAccountId?: string; cloudflareApiToken?: string; cloudflareGatewayId?: string }
      if (conn.cloudflareAccountId && conn.cloudflareApiToken) {
        // Workers AI models from the user's own account (billed by Cloudflare Workers AI).
        const res = (await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${conn.cloudflareAccountId}/ai/models/search?task=Text%20Generation&per_page=100`,
          { headers: { authorization: `Bearer ${conn.cloudflareApiToken}` } },
        ).then((r) => r.json())) as { success?: boolean; result?: Array<{ name?: string }> }
        const wai = (res.result ?? [])
          .map((m) => String(m.name ?? ''))
          .filter(Boolean)
          .map((name) => ({ id: `workers-ai/${name}`, label: `${name.replace('@cf/', '')} · Workers AI`, provider: 'cloudflare', inputPerM: 0, outputPerM: 0 }))
        // Unified-billing vendor models, LIVE from the gateway catalog so new models (e.g. a
        // freshly-added gpt-5.6-sol) appear automatically. Fall back to the curated set.
        const live = await fetchUnifiedCatalog(conn.cloudflareAccountId, conn.cloudflareApiToken, conn.cloudflareGatewayId ?? '')
        const unified = live.length ? live : UNIFIED_FALLBACK
        return c.json({ models: [...wai, ...unified] })
      }
    } catch { /* fall through to the static list */ }
    return c.json({
      models: [
        { id: 'workers-ai/@cf/openai/gpt-oss-120b', label: 'gpt-oss-120b · Workers AI', provider: 'cloudflare', inputPerM: 0, outputPerM: 0 },
        { id: 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'llama-3.3-70b · Workers AI', provider: 'cloudflare', inputPerM: 0, outputPerM: 0 },
        ...UNIFIED_FALLBACK,
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
