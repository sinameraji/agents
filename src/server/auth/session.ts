/**
 * Minimal password-gated session for the interim (until Cloudflare Access fronts the app).
 * A correct password mints a signed, HttpOnly cookie: `v1.<b64url(payload)>.<b64url(hmac)>`,
 * where payload = { email, exp }. The cookie is verified on every request via HMAC-SHA256 with
 * AUTH_SECRET. No password or secret is ever stored client-side.
 */

const COOKIE = 'dw_session'
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface SessionEnv {
  AUTH_SECRET?: string
  APP_PASSWORD?: string
  OWNER_EMAIL?: string
  ALLOWED_USERS?: string
}

/** Is this email allowed to log in? Unset allowlist = open instance (self-hoster's choice).
 *  Enforced at EVERY session-minting point (password, OAuth, email) so no path bypasses it. */
export function isAllowedUser(allowed: string | undefined, email: string): boolean {
  if (!allowed?.trim()) return true
  return allowed.toLowerCase().split(/[\s,]+/).filter(Boolean).includes(email.trim().toLowerCase())
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const enc = new TextEncoder()

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

/** Constant-time compare of two byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function checkPassword(password: string, env: SessionEnv): Promise<boolean> {
  if (!env.APP_PASSWORD) return false
  const [a, b] = await Promise.all([
    hmac(env.AUTH_SECRET ?? '', password),
    hmac(env.AUTH_SECRET ?? '', env.APP_PASSWORD),
  ])
  return timingSafeEqual(a, b)
}

export async function mintSessionCookieFor(email: string, env: Pick<SessionEnv, 'AUTH_SECRET'>): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify({ email, exp: Date.now() + TTL_MS })))
  const sig = b64urlEncode(await hmac(env.AUTH_SECRET ?? '', `v1.${payload}`))
  const token = `v1.${payload}.${sig}`
  const maxAge = Math.floor(TTL_MS / 1000)
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`
}

/** Mint the owner session for the password gate. Returns null if the allowlist excludes the
 *  owner identity — the password path must not bypass ALLOWED_USERS. */
export async function mintSessionCookie(env: SessionEnv): Promise<string | null> {
  const owner = env.OWNER_EMAIL ?? 'owner@agents.local'
  if (!isAllowedUser(env.ALLOWED_USERS, owner)) return null
  return mintSessionCookieFor(owner, env)
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

/** Verify the session cookie on a request; returns the email or null. */
export async function emailFromSessionCookie(request: Request, env: SessionEnv): Promise<string | null> {
  if (!env.AUTH_SECRET) return null
  const token = request.headers
    .get('Cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const expected = await hmac(env.AUTH_SECRET, `v1.${parts[1]}`)
  if (!timingSafeEqual(b64urlDecode(parts[2]), expected)) return null
  try {
    const { email, exp } = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as {
      email: string
      exp: number
    }
    if (!exp || exp < Date.now()) return null
    return email
  } catch {
    return null
  }
}
