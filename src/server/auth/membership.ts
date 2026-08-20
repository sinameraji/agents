/**
 * Membership gate. The single per-deployment OrgAgent owns the roster; this is the thin helper
 * the Worker (index.ts) and the login flows (oauth.ts) call to ask "is this email an active
 * member, and what is their role?". It replaces the old ALLOWED_USERS `isAllowedUser` check.
 */
import { getAgentByName } from 'agents'
import type { OrgRole } from '~shared/protocol'

/** Fixed name of the single OrgAgent instance for this deployment. */
export const ORG_NAME = 'org'

interface OrgEnv {
  OrgAgent: Env['OrgAgent']
}

/** Membership decision for `email`. Seeds OWNER_EMAIL bootstrap admins on first access. */
export async function memberAccess(env: OrgEnv, email: string): Promise<{ active: boolean; role: OrgRole | null }> {
  const org = await getAgentByName(env.OrgAgent, ORG_NAME)
  return org.access(email)
}

/** True when `email` is an active member (admin or member) of this instance. */
export async function isActiveMember(env: OrgEnv, email: string): Promise<boolean> {
  return (await memberAccess(env, email)).active
}
