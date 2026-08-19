/**
 * OAuth logins.
 *
 * - "Log in with Cloudflare": Cloudflare's self-managed OAuth clients (GA 2026-06). Authorization
 *   Code + PKCE against dash.cloudflare.com/oauth2, client_secret_post. The consent screen shows
 *   our scopes and lets the user pick an account; afterwards we auto-provision their Dreamweav
 *   connections (account id + a scoped token) so KimiFlare / AI Gateway routing work immediately.
 * - "Log in with GitHub": classic OAuth app flow; the token (repo scope) auto-provisions private
 *   clones and the Git tab.
 *
 * State + PKCE verifier travel in a short-lived HMAC-signed cookie (AUTH_SECRET).
 */
import { getAgentByName } from 'agents'
import { userIdFromEmail } from './access'
import { mintSessionCookieFor } from './session'

const CF_AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth'
const CF_TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token'
/** Scope ids (from GET /client/v4/oauth/scopes) matching the registered client. */
const CF_SCOPES = ['user-details.read', 'account-settings.read', 'ai.read', 'aig.read', 'aig.write', 'aig.run']

const GH_AUTH_URL = 'https://github.com/login/oauth/authorize'
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GH_SCOPES = 'repo read:user user:email'

export interface OauthEnv {
  AUTH_SECRET?: string
  CF_OAUTH_CLIENT_ID?: string
  CF_OAUTH_CLIENT_SECRET?: string
  GITHUB_OAUTH_CLIENT_ID?: string
  GITHUB_OAUTH_CLIENT_SECRET?: string
  UserAgent: Env['UserAgent']
}

const OAUTH_COOKIE = 'dw_oauth'
const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}
function rand(bytes = 32): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return b64url(b)
}

interface FlowState {
  p: 'cloudflare' | 'github'
  s: string // state
  v?: string // PKCE verifier
  /** When set, this is a "connect" flow: provision onto this existing user id, keep their session. */
  link?: string
  exp: number
}

async function signFlow(state: FlowState, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(state)))
  return `${payload}.${b64url(await hmac(secret, payload))}`
}
async function readFlow(request: Request, secret: string): Promise<FlowState | null> {
  const raw = request.headers
    .get('Cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OAUTH_COOKIE}=`))
    ?.slice(OAUTH_COOKIE.length + 1)
  if (!raw) return null
  const [payload, sig] = raw.split('.')
  if (!payload || !sig) return null
  const expected = b64url(await hmac(secret, payload))
  if (sig !== expected) return null
  try {
    const st = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as FlowState
    if (!st.exp || st.exp < Date.now()) return null
    return st
  } catch {
    return null
  }
}

function flowCookie(value: string): string {
  return `${OAUTH_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
}
function clearFlowCookie(): string {
  return `${OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

function failPage(message: string): Response {
  const safe = message.replace(/</g, '&lt;').slice(0, 300)
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Login failed</title>
     <body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
     <div style="text-align:center"><h2>Login failed</h2><p>${safe}</p><p><a href="/">Back to Dreamweav</a></p></div>`,
    { status: 400, headers: { 'content-type': 'text/html', 'set-cookie': clearFlowCookie() } },
  )
}

/** Provision the user's account + mint their session; shared tail of both callbacks. */
async function completeLogin(
  env: OauthEnv,
  email: string,
  provision: (user: unknown) => Promise<void>,
): Promise<Response> {
  const id = await userIdFromEmail(email)
  const user = await getAgentByName(env.UserAgent, id)
  await provision(user)
  const session = await mintSessionCookieFor(email, { AUTH_SECRET: env.AUTH_SECRET })
  const headers = new Headers({ location: '/' })
  headers.append('set-cookie', session)
  headers.append('set-cookie', clearFlowCookie())
  return new Response(null, { status: 302, headers })
}

// --- Cloudflare ------------------------------------------------------------------------------
export async function startCfLogin(request: Request, env: OauthEnv, linkUserId?: string): Promise<Response> {
  if (!env.CF_OAUTH_CLIENT_ID || !env.AUTH_SECRET) return failPage('Cloudflare login is not configured yet.')
  const origin = new URL(request.url).origin
  const state = rand(16)
  const verifier = rand(48)
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))))
  const url = new URL(CF_AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', env.CF_OAUTH_CLIENT_ID)
  url.searchParams.set('redirect_uri', `${origin}/auth/cloudflare/callback`)
  url.searchParams.set('scope', CF_SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  const cookie = flowCookie(await signFlow({ p: 'cloudflare', s: state, v: verifier, link: linkUserId, exp: Date.now() + 600_000 }, env.AUTH_SECRET))
  return new Response(null, { status: 302, headers: { location: url.toString(), 'set-cookie': cookie } })
}

export async function finishCfLogin(request: Request, env: OauthEnv): Promise<Response> {
  if (!env.CF_OAUTH_CLIENT_ID || !env.CF_OAUTH_CLIENT_SECRET || !env.AUTH_SECRET)
    return failPage('Cloudflare login is not configured yet.')
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const flow = await readFlow(request, env.AUTH_SECRET)
  if (!code || !state || !flow || flow.p !== 'cloudflare' || flow.s !== state) {
    return failPage('The login attempt expired or did not match — try again.')
  }

  const tokenRes = await fetch(CF_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${url.origin}/auth/cloudflare/callback`,
      client_id: env.CF_OAUTH_CLIENT_ID,
      client_secret: env.CF_OAUTH_CLIENT_SECRET,
      code_verifier: flow.v ?? '',
    }),
  })
  const token = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!tokenRes.ok || !token.access_token) {
    return failPage(`Token exchange failed: ${token.error_description ?? token.error ?? `HTTP ${tokenRes.status}`}`)
  }

  const cfApi = (path: string) =>
    fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    }).then((r) => r.json().catch(() => ({}))) as Promise<{ success?: boolean; result?: unknown }>

  const me = await cfApi('/user')
  const email = String((me.result as { email?: string } | undefined)?.email ?? '')
  if (!email) return failPage('Cloudflare did not return your email (is User Details:Read granted?).')

  const accounts = await cfApi('/accounts?per_page=5')
  const granted = (Array.isArray(accounts.result) ? accounts.result : []) as Array<{ id?: string; name?: string }>
  const accountId = granted[0]?.id

  const provision = async (user: unknown) => {
    const u = user as {
      saveSettings: (i: { connections?: Record<string, string> }) => Promise<unknown>
      storeCfOauth: (b: { access: string; refresh: string | null; expiresAt: number }) => Promise<unknown>
    }
    if (accountId) await u.saveSettings({ connections: { cloudflareAccountId: accountId } })
    await u.storeCfOauth({
      access: token.access_token!,
      refresh: token.refresh_token ?? null,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    })
  }

  if (flow.link) {
    // Connect flow: provision onto the EXISTING logged-in account; identity/session unchanged.
    const user = await getAgentByName(env.UserAgent, flow.link)
    await provision(user)
    return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearFlowCookie() } })
  }
  return completeLogin(env, email, provision)
}

// --- Email magic link ------------------------------------------------------------------------
interface EmailBinding {
  send(msg: { to: string; from: string; subject: string; html?: string; text?: string }): Promise<unknown>
}

interface LoginToken {
  e: string // email
  n: string // single-use nonce (consumed in the UserAgent)
  exp: number
}

/** POST /api/login/email — send a 15-minute single-use magic link via Cloudflare Email Service. */
export async function startEmailLogin(request: Request, env: OauthEnv, email0: string, emailBinding: EmailBinding | undefined): Promise<Response> {
  if (!emailBinding || !env.AUTH_SECRET) return Response.json({ error: 'Email login is not configured yet.' }, { status: 503 })
  const email = email0.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'Enter a valid email address.' }, { status: 400 })
  const origin = new URL(request.url).origin
  const nonce = rand(18)
  const payload = b64url(enc.encode(JSON.stringify({ e: email, n: nonce, exp: Date.now() + 15 * 60_000 } satisfies LoginToken)))
  const token = `${payload}.${b64url(await hmac(env.AUTH_SECRET, payload))}`
  const id = await userIdFromEmail(email)
  const user = (await getAgentByName(env.UserAgent, id)) as unknown as { storePendingLogin: (n: string, exp: number) => Promise<unknown> }
  await user.storePendingLogin(nonce, Date.now() + 15 * 60_000)
  const link = `${origin}/auth/email/callback?token=${encodeURIComponent(token)}`
  try {
    await emailBinding.send({
    to: email,
    from: 'login@dreamweav.com',
    subject: 'Your Dreamweav login link',
    text: `Click to log in to Dreamweav (valid 15 minutes):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    html: `<div style="font-family:system-ui;max-width:420px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">Log in to Dreamweav</h2>
      <p style="color:#555">This link is valid for 15 minutes and works once.</p>
      <p><a href="${link}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Log in</a></p>
      <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p></div>`,
    })
  } catch (e) {
    console.error('[dreamweav] magic-link send failed', e)
    return Response.json(
      { error: 'Sending failed — the dreamweav.com sending domain may not be onboarded in Email Service yet.' },
      { status: 502 },
    )
  }
  return Response.json({ ok: true })
}

/** GET /auth/email/callback?token= — verify signature + expiry, consume the nonce, mint the session. */
export async function finishEmailLogin(request: Request, env: OauthEnv): Promise<Response> {
  if (!env.AUTH_SECRET) return failPage('Email login is not configured yet.')
  const token = new URL(request.url).searchParams.get('token') ?? ''
  const [payload, sig] = token.split('.')
  if (!payload || !sig || sig !== b64url(await hmac(env.AUTH_SECRET, payload))) {
    return failPage('This login link is invalid.')
  }
  let parsed: LoginToken
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as LoginToken
  } catch {
    return failPage('This login link is invalid.')
  }
  if (!parsed.exp || parsed.exp < Date.now()) return failPage('This login link expired — request a fresh one.')
  const id = await userIdFromEmail(parsed.e)
  const user = (await getAgentByName(env.UserAgent, id)) as unknown as { consumeLoginNonce: (n: string) => Promise<{ ok: boolean }> }
  const consumed = await user.consumeLoginNonce(parsed.n)
  if (!consumed.ok) return failPage('This login link was already used — request a fresh one.')
  return completeLogin(env, parsed.e, async () => {})
}

// --- GitHub ----------------------------------------------------------------------------------
export async function startGithubLogin(request: Request, env: OauthEnv): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.AUTH_SECRET) return failPage('GitHub login is not configured yet.')
  const origin = new URL(request.url).origin
  const state = rand(16)
  const url = new URL(GH_AUTH_URL)
  url.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID)
  url.searchParams.set('redirect_uri', `${origin}/auth/github/callback`)
  url.searchParams.set('scope', GH_SCOPES)
  url.searchParams.set('state', state)
  const cookie = flowCookie(await signFlow({ p: 'github', s: state, exp: Date.now() + 600_000 }, env.AUTH_SECRET))
  return new Response(null, { status: 302, headers: { location: url.toString(), 'set-cookie': cookie } })
}

export async function finishGithubLogin(request: Request, env: OauthEnv): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.AUTH_SECRET)
    return failPage('GitHub login is not configured yet.')
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const flow = await readFlow(request, env.AUTH_SECRET)
  if (!code || !state || !flow || flow.p !== 'github' || flow.s !== state) {
    return failPage('The login attempt expired or did not match — try again.')
  }

  const tokenRes = await fetch(GH_TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code }),
  })
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error_description?: string }
  if (!token.access_token) return failPage(`Token exchange failed: ${token.error_description ?? 'no token returned'}`)

  const gh = (path: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'dreamweav',
      },
    }).then((r) => r.json().catch(() => ({})))

  const me = (await gh('/user')) as { email?: string | null; login?: string }
  let email = me.email ?? ''
  if (!email) {
    const emails = (await gh('/user/emails')) as Array<{ email: string; primary: boolean; verified: boolean }>
    email = (Array.isArray(emails) && (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified))?.email) || ''
  }
  if (!email) return failPage('GitHub did not return a verified email for your account.')

  return completeLogin(env, email, async (user) => {
    const u = user as unknown as { saveSettings: (i: { connections?: Record<string, string> }) => Promise<unknown> }
    await u.saveSettings({ connections: { githubPat: token.access_token! } })
  })
}
