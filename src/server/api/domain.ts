import type { Hono } from 'hono'
import { getAgentByName } from 'agents'
import type { Identity } from '../auth/access'
import type { OrgRole } from '~shared/protocol'

/**
 * Settings → Domain onboarding wizard, for self-hosters whose domain is NOT yet on Cloudflare.
 * Workers can only serve custom domains whose zone is on Cloudflare, so the flow is:
 *
 *   start  → find-or-create the zone (full/free) on the admin's own account, return nameservers
 *   status → poll until the registrar's nameserver swap makes the zone `active`
 *   attach → wire this worker (env WORKER_NAME) to the hostname: proxied DNS + worker routes
 *
 * Mounted AFTER the membership gate in index.ts, so every caller is already an active member;
 * here we additionally require the `admin` role (same pattern as /api/org/*). The role comes
 * from the server-verified session, never the request. All Cloudflare calls run inside the
 * calling admin's UserAgent with their stored OAuth credentials; no token ever reaches the
 * client or this route layer.
 */

type DomainApp = Hono<{ Bindings: Env; Variables: { identity: Identity; role: OrgRole } }>

export function registerDomainRoutes(app: DomainApp) {
  // Guard: admin only. `role` is set by the membership gate from the server-verified session.
  app.use('/api/domain/*', async (c, next) => {
    if (c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403)
    await next()
  })

  const ua = (c: { env: Env; get: (k: 'identity') => Identity }) =>
    getAgentByName(c.env.UserAgent, c.get('identity').id)

  // Resume support: the persisted wizard state (null when no setup is in flight).
  app.get('/api/domain/state', async (c) => {
    const state = await (await ua(c)).domainWizardState()
    return c.json({ state })
  })

  // Step 1: validate hostname, derive (or accept) the zone, find-or-create it on Cloudflare.
  app.post('/api/domain/start', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { hostname?: string; zone?: string } | null
    if (!body || typeof body.hostname !== 'string' || !body.hostname.trim()) {
      return c.json({ ok: false, note: 'Enter a hostname like agents.yourcompany.com.' }, 400)
    }
    const res = await (await ua(c)).domainStart({ hostname: body.hostname, zone: body.zone })
    return c.json(res)
  })

  // Step 2 polling: zone status + nameservers.
  app.get('/api/domain/status', async (c) => {
    const zoneId = c.req.query('zoneId') ?? ''
    if (!zoneId) return c.json({ ok: false, note: 'Missing zoneId.' }, 400)
    const res = await (await ua(c)).domainStatus(zoneId)
    return c.json(res)
  })

  // Step 3: zone is active, attach this worker to the hostname and return the final URL.
  app.post('/api/domain/attach', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { hostname?: string; zoneId?: string }
    const res = await (await ua(c)).domainAttach(body)
    return c.json(res)
  })

  // Start over: forget the persisted wizard state (does not touch Cloudflare).
  app.post('/api/domain/reset', async (c) => {
    const res = await (await ua(c)).domainWizardReset()
    return c.json(res)
  })
}
