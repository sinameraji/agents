/**
 * Domain onboarding helpers (pure, unit-tested in test/domain.test.ts). Used by the admin-only
 * /api/domain wizard routes (src/server/api/domain.ts + UserAgent) and the Settings → Domain
 * client wizard, so both sides derive the same zone from the same hostname.
 *
 * PSL-lite on purpose: the registrable zone is the last two labels, plus a small list of common
 * two-part public suffixes (co.uk style) and an explicit zone override for everything else.
 * Shipping the full Public Suffix List in the Worker is not worth it for an onboarding wizard.
 */

/** Common two-part public suffixes where "last two labels" would name the suffix, not a zone. */
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'id.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'ne.kr',
  'com.br', 'net.br', 'org.br',
  'com.mx', 'org.mx', 'net.mx',
  'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.ec', 'com.bo', 'com.py',
  'co.za', 'org.za', 'net.za', 'web.za',
  'com.cn', 'net.cn', 'org.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my', 'com.ph', 'com.vn',
  'co.th', 'co.id', 'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in',
  'com.tr', 'net.tr', 'org.tr', 'com.sa', 'com.eg', 'co.il', 'org.il', 'com.pk', 'com.ng', 'co.ke',
  'com.pl', 'net.pl', 'org.pl',
])

/** Lower-case + strip scheme/path/port/trailing dot, then validate as a DNS hostname (>= 2
 *  labels, RFC 1123 label shape, not an IPv4 literal). Returns null when it is not usable. */
export function normalizeHostname(input: string): string | null {
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
  if (!clean || clean.length > 253) return null
  const labels = clean.split('.')
  if (labels.length < 2) return null
  if (labels.some((l) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null
  if (labels.every((l) => /^\d+$/.test(l))) return null // IPv4 literal, not a domain
  return clean
}

export type ZoneDerivation =
  | { ok: true; hostname: string; zone: string }
  | { ok: false; error: string }

/**
 * Derive the registrable zone for a hostname. `zoneOverride` wins when given (it must be the
 * hostname itself or a parent of it, aligned on a label boundary); otherwise PSL-lite applies.
 */
export function deriveZone(hostnameInput: string, zoneOverride?: string): ZoneDerivation {
  const hostname = normalizeHostname(hostnameInput)
  if (!hostname) return { ok: false, error: 'Enter a hostname like agents.yourcompany.com.' }
  if (zoneOverride?.trim()) {
    const zone = normalizeHostname(zoneOverride)
    if (!zone) return { ok: false, error: 'The zone override is not a valid domain name.' }
    if (hostname !== zone && !hostname.endsWith(`.${zone}`)) {
      return { ok: false, error: `${zone} is not the same domain as ${hostname} or a parent of it.` }
    }
    if (zone.split('.').length < 2 || TWO_PART_SUFFIXES.has(zone)) {
      return { ok: false, error: `${zone} is a public suffix, not a registrable domain.` }
    }
    return { ok: true, hostname, zone }
  }
  const labels = hostname.split('.')
  const lastTwo = labels.slice(-2).join('.')
  if (TWO_PART_SUFFIXES.has(lastTwo)) {
    if (labels.length < 3) {
      return { ok: false, error: `${hostname} is a public suffix, not a registrable domain.` }
    }
    return { ok: true, hostname, zone: labels.slice(-3).join('.') }
  }
  return { ok: true, hostname, zone: lastTwo }
}

// --- Cloudflare API error mapping -------------------------------------------------------------

export interface CfApiError {
  code?: number
  message?: string
}

export interface CfErrorInput {
  httpStatus?: number
  errors?: CfApiError[]
}

export type CfErrorContext = 'zone-create' | 'zone-read' | 'attach'

/** Cloudflare error codes that mean "this token/login cannot do that" (same family the existing
 *  wireDomain treats as auth failures), as opposed to a problem with the request itself. */
const AUTH_CODES = new Set([9109, 9106, 10000, 9038, 1001])

const PERMISSION_NEEDED: Record<CfErrorContext, string> = {
  'zone-create': 'Zone Edit or Zone DNS Edit',
  'zone-read': 'Zone Read',
  attach: 'Zone DNS Edit and Workers Routes Edit',
}

/** True when the response indicates a missing scope/permission rather than a bad request. */
export function isCfAuthError(input: CfErrorInput): boolean {
  if (input.httpStatus === 401 || input.httpStatus === 403) return true
  for (const e of input.errors ?? []) {
    if (e.code !== undefined && AUTH_CODES.has(e.code)) return true
    if (/unauthor|authenticat|not allowed|permission/i.test(e.message ?? '')) return true
  }
  return false
}

/** Map a Cloudflare API failure to one readable sentence for the wizard UI. */
export function describeCfError(input: CfErrorInput, ctx: CfErrorContext): string {
  const errors = input.errors ?? []
  if (isCfAuthError(input)) {
    return `Your Cloudflare login is missing the ${PERMISSION_NEEDED[ctx]} permission. Reconnect Cloudflare to grant it, then try again.`
  }
  for (const e of errors) {
    const msg = e.message ?? ''
    // 1061: zone already exists. The wizard only creates after a find on THIS account missed,
    // so hitting it means the domain lives on a different Cloudflare account (or is on hold).
    if (e.code === 1061 || /already exists/i.test(msg)) {
      return 'That domain is already on Cloudflare under a different account. Remove it there first, or sign in here with the Cloudflare account that owns it.'
    }
    // 1049: not a registered domain.
    if (e.code === 1049 || /not a registered domain/i.test(msg)) {
      return 'Cloudflare could not find that domain in the public registry. Check the spelling and make sure the domain is registered.'
    }
    // 1097: banned/abuse-flagged domain.
    if (e.code === 1097 || /banned|blocked/i.test(msg)) {
      return 'Cloudflare refused this domain (it is flagged). Contact Cloudflare support if you own it.'
    }
    if (/rate.?limit|too many/i.test(msg)) {
      return 'Cloudflare rate limit hit. Wait a minute and try again.'
    }
  }
  const first = errors.find((e) => e.message)?.message
  if (first) return first
  return input.httpStatus && input.httpStatus >= 500
    ? 'Cloudflare had a temporary problem. Try again in a moment.'
    : 'Cloudflare rejected the request. Try again.'
}

// --- wizard state (wire type) -------------------------------------------------------------------

/** Server-persisted onboarding state (settings KV on the UserAgent) so a reload resumes mid-wait. */
export interface DomainWizardState {
  /** Full hostname being wired, e.g. agents.yourcompany.com. */
  hostname: string
  /** Registrable zone the hostname lives in, e.g. yourcompany.com. */
  zone: string
  zoneId: string
  /** The two Cloudflare-assigned nameservers the registrar must be switched to. */
  nameServers: string[]
  /** Cloudflare zone status: initializing | pending | active | moved. */
  status: string
  step: 'nameservers' | 'attach' | 'done'
  /** Final URL, set once the attach step succeeds. */
  url?: string
  updatedAt: number
}

// --- zone status --------------------------------------------------------------------------------

/** Zone lifecycle per the Cloudflare API: initializing | pending | active | moved. */
export function zoneStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Active'
    case 'moved':
      return 'Zone moved away from Cloudflare'
    case 'initializing':
    case 'pending':
    default:
      return 'Waiting for nameservers'
  }
}
