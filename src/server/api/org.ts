import type { Hono } from 'hono'
import { getAgentByName } from 'agents'
import type { Identity } from '../auth/access'
import { ORG_NAME } from '../auth/membership'
import type { OrgRole } from '~shared/protocol'

/**
 * Admin-only roster management. Mounted AFTER the membership gate in index.ts, so every caller is
 * already an active member; here we additionally require the `admin` role. The role is derived
 * SERVER-SIDE from the signed session cookie (stashed by requireMember) — never read from the
 * request body — so a member cannot escalate by lying to the API.
 *
 * Visibility is MEMBERSHIP ONLY: these endpoints expose email / role / status / cap and nothing
 * about any member's usage, cost, or sessions.
 */

type OrgApp = Hono<{ Bindings: Env; Variables: { identity: Identity; role: OrgRole } }>

const parseCap = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) && n >= 0 ? n : null
}
const parseRole = (v: unknown): OrgRole => (v === 'admin' ? 'admin' : 'member')

/** Map an OrgAgent error code to an HTTP status. */
const statusFor = (error?: string): 400 | 403 | 404 =>
  error === 'not_found' ? 404 : error === 'owner_protected' || error === 'last_admin' ? 403 : 400

export function registerOrgRoutes(app: OrgApp) {
  // Guard: admin only. `role` is set by the membership gate from the server-verified session.
  app.use('/api/org/*', async (c, next) => {
    if (c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403)
    await next()
  })

  const org = (c: { env: Env }) => getAgentByName(c.env.OrgAgent, ORG_NAME)

  app.get('/api/org/members', async (c) => {
    const members = await (await org(c)).listMembers()
    return c.json({ members })
  })

  app.post('/api/org/members', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; role?: string; capUsd?: unknown }
    const res = await (await org(c)).invite({
      email: String(body.email ?? ''),
      role: parseRole(body.role),
      capUsd: parseCap(body.capUsd),
      addedBy: c.get('identity').email,
    })
    return c.json(res, res.ok ? 200 : statusFor(res.error))
  })

  app.post('/api/org/members/role', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; role?: string }
    const res = await (await org(c)).updateRole({ email: String(body.email ?? ''), role: parseRole(body.role) })
    return c.json(res, res.ok ? 200 : statusFor(res.error))
  })

  app.post('/api/org/members/cap', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; capUsd?: unknown }
    const res = await (await org(c)).setCap({ email: String(body.email ?? ''), capUsd: parseCap(body.capUsd) })
    return c.json(res, res.ok ? 200 : statusFor(res.error))
  })

  app.post('/api/org/members/suspend', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string }
    const res = await (await org(c)).suspend({ email: String(body.email ?? '') })
    return c.json(res, res.ok ? 200 : statusFor(res.error))
  })

  app.post('/api/org/members/reactivate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string }
    const res = await (await org(c)).reactivate({ email: String(body.email ?? '') })
    return c.json(res, res.ok ? 200 : statusFor(res.error))
  })

  app.post('/api/org/members/remove', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string }
    const res = await (await org(c)).remove({ email: String(body.email ?? '') })
    return c.json(res, res.ok ? 200 : statusFor(res.error))
  })
}
