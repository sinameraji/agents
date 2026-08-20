import { Agent } from 'agents'
import type { OrgMember, OrgRole } from '~shared/protocol'
import { PASSWORD_OWNER_FALLBACK } from '../auth/session'

/**
 * One instance per deployment (name = "org"; see ORG_NAME in ../auth/membership). Owns the
 * membership roster in DO SQLite: who may use this instance, their role (admin | member),
 * status (active | suspended), and an optional monthly USD cap.
 *
 * Membership ONLY — this DO never stores or exposes another member's usage, cost, or sessions.
 * All methods are server-side RPC (called from the Worker via getAgentByName); nothing here is
 * `@callable()`, so the browser cannot reach the roster except through the admin API in
 * ../index.ts, which verifies the caller's admin role from the session cookie first.
 */

interface MemberRow {
  email: string
  role: string
  status: string
  cap_usd: number | null
  added_by: string
  added_at: string
}

const norm = (email: string) => email.trim().toLowerCase()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const cleanCap = (v: unknown): number | null =>
  typeof v === 'number' && isFinite(v) && v >= 0 ? v : null

export class OrgAgent extends Agent<Env, { ready: boolean }> {
  initialState = { ready: false }

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS members (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      cap_usd REAL,
      added_by TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL
    )`
    if (!this.state.ready) this.setState({ ready: true })
    this.seedBootstrapAdmins()
  }

  // --- bootstrap admins --------------------------------------------------------------------
  /** Emails that are ALWAYS treated as active admins: OWNER_EMAIL (comma/space separated), plus
   *  DEV_USER_EMAIL when no real auth is configured — this mirrors the dev bypass in
   *  resolveIdentity so `npm run dev` works without also hand-editing the roster. It can never be
   *  a production backdoor: once any real auth (password / OAuth / email) is configured,
   *  DEV_USER_EMAIL is neither a bypass identity nor a bootstrap admin. */
  private bootstrapAdmins(): string[] {
    const env = this.env as unknown as {
      OWNER_EMAIL?: string
      DEV_USER_EMAIL?: string
      APP_PASSWORD?: string
      CF_OAUTH_CLIENT_ID?: string
      GITHUB_OAUTH_CLIENT_ID?: string
      EMAIL?: unknown
    }
    const out = new Set<string>()
    for (const e of (env.OWNER_EMAIL ?? '').split(/[\s,]+/).filter(Boolean)) out.add(norm(e))
    const realAuth =
      !!env.APP_PASSWORD || !!env.CF_OAUTH_CLIENT_ID || !!env.GITHUB_OAUTH_CLIENT_ID || !!env.EMAIL
    if (!realAuth && env.DEV_USER_EMAIL) out.add(norm(env.DEV_USER_EMAIL))
    // No OWNER_EMAIL configured but a password gate exists (fresh deploy-button instance):
    // the password path mints PASSWORD_OWNER_FALLBACK (see auth/session.ts), so seed that
    // identity as the bootstrap admin — whoever knows APP_PASSWORD is the instance owner.
    if (out.size === 0 && env.APP_PASSWORD) out.add(PASSWORD_OWNER_FALLBACK)
    return [...out]
  }

  /** Force every bootstrap admin to be an active admin. Idempotent; runs on cold start and before
   *  every read/decision so the owner can never be locked out or demoted for long. */
  private seedBootstrapAdmins() {
    const now = new Date().toISOString()
    for (const email of this.bootstrapAdmins()) {
      this.sql`INSERT INTO members (email, role, status, cap_usd, added_by, added_at)
               VALUES (${email}, 'admin', 'active', NULL, 'bootstrap', ${now})
               ON CONFLICT(email) DO UPDATE SET role = 'admin', status = 'active'`
    }
  }

  private isOwner(email: string): boolean {
    return this.bootstrapAdmins().includes(norm(email))
  }

  private getRow(email: string): MemberRow | null {
    const rows = this.sql<MemberRow>`SELECT * FROM members WHERE email = ${email}`
    return rows.length ? rows[0] : null
  }

  private activeAdminCount(): number {
    return this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM members WHERE role = 'admin' AND status = 'active'`[0].n
  }

  /** Would demoting / suspending / removing this email leave zero active admins? */
  private wouldDropLastAdmin(email: string): boolean {
    const row = this.getRow(email)
    if (!row) return false
    const isActiveAdmin = row.role === 'admin' && row.status === 'active'
    return isActiveAdmin && this.activeAdminCount() <= 1
  }

  private rowToMember(r: MemberRow): OrgMember {
    return {
      email: r.email,
      role: (r.role === 'admin' ? 'admin' : 'member') as OrgRole,
      status: r.status === 'suspended' ? 'suspended' : 'active',
      capUsd: r.cap_usd,
      addedBy: r.added_by,
      addedAt: r.added_at,
    }
  }

  // --- access gate (called by the Worker on every guarded request) -------------------------
  /** Membership decision for the access gate. `active` gates all app access; `role` is null for
   *  non-members and suspended members. */
  async access(email: string): Promise<{ active: boolean; role: OrgRole | null }> {
    this.seedBootstrapAdmins()
    const row = this.getRow(norm(email))
    if (!row || row.status !== 'active') return { active: false, role: null }
    return { active: true, role: row.role === 'admin' ? 'admin' : 'member' }
  }

  // --- admin management (caller's admin role verified in the Worker) ------------------------
  async listMembers(): Promise<OrgMember[]> {
    this.seedBootstrapAdmins()
    const rows = this.sql<MemberRow>`SELECT * FROM members ORDER BY role ASC, email ASC`
    return rows.map((r) => this.rowToMember(r))
  }

  async invite(input: {
    email: string
    role: OrgRole
    capUsd: number | null
    addedBy: string
  }): Promise<{ ok: boolean; error?: string }> {
    this.seedBootstrapAdmins()
    const email = norm(input.email)
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' }
    if (this.getRow(email)) return { ok: false, error: 'already_a_member' }
    const role: OrgRole = input.role === 'admin' ? 'admin' : 'member'
    this.sql`INSERT INTO members (email, role, status, cap_usd, added_by, added_at)
             VALUES (${email}, ${role}, 'active', ${cleanCap(input.capUsd)}, ${norm(input.addedBy)}, ${new Date().toISOString()})`
    return { ok: true }
  }

  async updateRole(input: { email: string; role: OrgRole }): Promise<{ ok: boolean; error?: string }> {
    const email = norm(input.email)
    if (!this.getRow(email)) return { ok: false, error: 'not_found' }
    const role: OrgRole = input.role === 'admin' ? 'admin' : 'member'
    if (role === 'member') {
      if (this.isOwner(email)) return { ok: false, error: 'owner_protected' }
      if (this.wouldDropLastAdmin(email)) return { ok: false, error: 'last_admin' }
    }
    this.sql`UPDATE members SET role = ${role} WHERE email = ${email}`
    return { ok: true }
  }

  async setCap(input: { email: string; capUsd: number | null }): Promise<{ ok: boolean; error?: string }> {
    const email = norm(input.email)
    if (!this.getRow(email)) return { ok: false, error: 'not_found' }
    this.sql`UPDATE members SET cap_usd = ${cleanCap(input.capUsd)} WHERE email = ${email}`
    return { ok: true }
  }

  async suspend(input: { email: string }): Promise<{ ok: boolean; error?: string }> {
    const email = norm(input.email)
    if (!this.getRow(email)) return { ok: false, error: 'not_found' }
    if (this.isOwner(email)) return { ok: false, error: 'owner_protected' }
    if (this.wouldDropLastAdmin(email)) return { ok: false, error: 'last_admin' }
    this.sql`UPDATE members SET status = 'suspended' WHERE email = ${email}`
    return { ok: true }
  }

  async reactivate(input: { email: string }): Promise<{ ok: boolean; error?: string }> {
    const email = norm(input.email)
    if (!this.getRow(email)) return { ok: false, error: 'not_found' }
    this.sql`UPDATE members SET status = 'active' WHERE email = ${email}`
    return { ok: true }
  }

  async remove(input: { email: string }): Promise<{ ok: boolean; error?: string }> {
    const email = norm(input.email)
    if (!this.getRow(email)) return { ok: false, error: 'not_found' }
    if (this.isOwner(email)) return { ok: false, error: 'owner_protected' }
    if (this.wouldDropLastAdmin(email)) return { ok: false, error: 'last_admin' }
    this.sql`DELETE FROM members WHERE email = ${email}`
    return { ok: true }
  }
}
