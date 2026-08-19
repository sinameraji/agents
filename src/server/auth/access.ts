import { emailFromSessionCookie } from './session'

/**
 * Identity resolution.
 *
 * In production the Worker sits behind Cloudflare Access, which injects a signed JWT in the
 * `Cf-Access-Jwt-Assertion` header (and the `CF_Authorization` cookie). We verify it against the
 * team's JWKS and extract the email. In local dev, `DEV_USER_EMAIL` short-circuits all of this.
 */

export interface Identity {
  /** Stable user id used to name per-user Durable Objects (sha256 of the lower-cased email). */
  id: string
  email: string
}

interface AccessEnv {
  DEV_USER_EMAIL?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  AUTH_SECRET?: string
  // Presence of any of these means "real auth is configured" — the dev bypass is then ignored,
  // so a stray DEV_USER_EMAIL in a deployed env can never become an unauthenticated backdoor.
  APP_PASSWORD?: string
  CF_OAUTH_CLIENT_ID?: string
  GITHUB_OAUTH_CLIENT_ID?: string
  EMAIL?: unknown
}

interface Jwk extends JsonWebKey {
  kid: string
}

let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null
const JWKS_TTL_MS = 10 * 60 * 1000

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
  const body = (await res.json()) as { keys: Jwk[] }
  jwksCache = { fetchedAt: Date.now(), keys: body.keys }
  return body.keys
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function verifyAccessJwt(token: string, env: AccessEnv): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as { kid?: string; alg?: string }
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as {
    aud?: string | string[]
    exp?: number
    email?: string
  }
  if (header.alg !== 'RS256') return null
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!auds.includes(env.ACCESS_AUD)) return null
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null
  const keys = await getJwks(env.ACCESS_TEAM_DOMAIN)
  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) return null
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  return ok && payload.email ? payload.email : null
}

export async function userIdFromEmail(email: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

/** Resolve the caller's identity, or null if unauthenticated. */
export async function resolveIdentity(request: Request, env: AccessEnv): Promise<Identity | null> {
  let email: string | null = null
  const jwt =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    request.headers
      .get('Cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('CF_Authorization='))
      ?.slice('CF_Authorization='.length) ??
    null
  if (jwt) email = await verifyAccessJwt(jwt, env)
  if (!email) email = await emailFromSessionCookie(request, env)
  // Dev bypass: only when NO real auth mechanism is configured, so it can never silently
  // authenticate anonymous requests on a deployed instance that has a password/OAuth/email.
  const realAuthConfigured =
    !!env.APP_PASSWORD || !!env.CF_OAUTH_CLIENT_ID || !!env.GITHUB_OAUTH_CLIENT_ID || !!env.EMAIL
  if (!email && env.DEV_USER_EMAIL && !realAuthConfigured) email = env.DEV_USER_EMAIL
  if (!email) return null
  return { id: await userIdFromEmail(email), email }
}
