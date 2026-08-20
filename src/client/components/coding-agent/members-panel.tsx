import { useCallback, useEffect, useState } from 'react'
import { Ban, Check, RotateCcw, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { OrgMember, OrgRole } from '~shared/protocol'

/**
 * Admin-only roster management (rendered inside the Settings dialog's Members tab). Membership
 * ONLY: this lists email / role / status / cap and never any member's usage, cost, or sessions.
 * All writes go through /api/org/*, which re-verifies the caller's admin role server-side.
 */

const ERROR_TEXT: Record<string, string> = {
  invalid_email: 'Enter a valid email address.',
  already_a_member: 'That email is already on the roster.',
  last_admin: "You can't remove or demote the last active admin.",
  owner_protected: "The instance owner can't be changed here.",
  not_found: 'That member no longer exists — refreshing.',
  forbidden: 'Admins only.',
}
const errText = (e?: string) => (e && ERROR_TEXT[e]) || 'Something went wrong.'

const inputCls =
  'h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/50'

export function MembersPanel() {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // invite form
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrgRole>('member')
  const [cap, setCap] = useState('')

  // per-row cap editor: { email, value }
  const [capEdit, setCapEdit] = useState<{ email: string; value: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/org/members')
      if (!r.ok) {
        setError(r.status === 403 ? errText('forbidden') : 'Could not load members.')
        return
      }
      const d = (await r.json()) as { members: OrgMember[] }
      setMembers(d.members)
      setError(null)
    } catch {
      setError('Could not load members.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const call = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!r.ok || d.ok === false) {
          setError(errText(d.error))
          return false
        }
        await load()
        return true
      } catch {
        setError('Something went wrong.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const invite = async () => {
    const ok = await call('/api/org/members', {
      email: email.trim(),
      role,
      capUsd: cap.trim() === '' ? null : Number(cap),
    })
    if (ok) {
      setEmail('')
      setRole('member')
      setCap('')
    }
  }

  const saveCap = async (memberEmail: string, value: string) => {
    const ok = await call('/api/org/members/cap', {
      email: memberEmail,
      capUsd: value.trim() === '' ? null : Number(value),
    })
    if (ok) setCapEdit(null)
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Invite */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Invite a member</label>
        <p className="text-xs text-muted-foreground">
          They get access with their own BYO keys. A cap is optional (monthly USD, display-only for now).
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            aria-label="Member email"
            className={cn(inputCls, 'flex-1 font-mono text-xs')}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
            aria-label="Role"
            className={cn(inputCls, 'sm:w-28')}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <input
            type="number"
            min="0"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            placeholder="Cap $/mo"
            aria-label="Monthly cap in USD (optional)"
            className={cn(inputCls, 'sm:w-28')}
          />
          <Button size="sm" disabled={busy || email.trim() === ''} onClick={() => void invite()}>
            <UserPlus className="size-3.5" /> Invite
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Roster */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Members{members.length > 0 && ` (${members.length})`}</label>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {members.map((m) => {
              const editing = capEdit?.email === m.email
              return (
                <li key={m.email} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={m.email}>
                      {m.email}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        m.role === 'admin' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {m.role}
                    </span>
                    {m.status === 'suspended' && (
                      <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        suspended
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {/* Cap */}
                    {editing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          autoFocus
                          value={capEdit.value}
                          onChange={(e) => setCapEdit({ email: m.email, value: e.target.value })}
                          placeholder="no cap"
                          aria-label={`Monthly cap for ${m.email}`}
                          className={cn(inputCls, 'h-7 w-24 text-xs')}
                        />
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => void saveCap(m.email, capEdit.value)}>
                          <Check className="size-3" /> Save
                        </Button>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => setCapEdit(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => setCapEdit({ email: m.email, value: m.capUsd == null ? '' : String(m.capUsd) })}
                        title="Set or clear this member's monthly cap"
                      >
                        {m.capUsd == null ? 'no cap' : `$${m.capUsd}/mo`}
                      </button>
                    )}

                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void call('/api/org/members/role', { email: m.email, role: m.role === 'admin' ? 'member' : 'admin' })}
                        title={m.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                      >
                        <ShieldCheck className="size-3" /> {m.role === 'admin' ? 'Make member' : 'Make admin'}
                      </Button>
                      {m.status === 'active' ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void call('/api/org/members/suspend', { email: m.email })}
                          title="Suspend access"
                        >
                          <Ban className="size-3" /> Suspend
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void call('/api/org/members/reactivate', { email: m.email })}
                          title="Restore access"
                        >
                          <RotateCcw className="size-3" /> Reactivate
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void call('/api/org/members/remove', { email: m.email })}
                        title="Remove from the roster"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Membership only — this list never shows anyone&apos;s usage, spend, or sessions.
        </p>
      </div>
    </section>
  )
}
