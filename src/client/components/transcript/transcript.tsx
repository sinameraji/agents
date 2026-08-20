import { useEffect, useState } from 'react'
import type {
  NormPermission,
  NormTurn,
  PermissionReply,
  SessionStatus,
} from '~shared/agent'
import { Check, Loader2 } from 'lucide-react'

import { TurnView } from './turn-view'
import { PermissionCard } from './parts/permission-card'

function WorkingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pl-10 text-sm text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/70" />
      </span>
      <span>{label}</span>
    </div>
  )
}

/** The full live transcript: turns, pending permission prompts, and a working indicator. */
export function Transcript({
  turns,
  permissions,
  status,
  phase,
  phaseLog,
  phaseSince,
  onPermissionReply,
}: {
  turns: NormTurn[]
  permissions?: NormPermission[]
  status?: SessionStatus
  /** What the session is doing while it boots. Shown verbatim: a cold start is tens of seconds,
   *  and "Cloning owner/repo" is the difference between waiting and wondering if it broke. */
  phase?: string
  /** Provisioning steps already finished, oldest first. */
  phaseLog?: string[]
  phaseSince?: number
  onPermissionReply?: (id: string, reply: PermissionReply, note?: string) => void
}) {
  const working = status === 'booting' || status === 'busy'
  const last = turns[turns.length - 1]
  // Only show the indicator BEFORE the assistant produces anything, once content streams (or the
  // turn is done), the content itself is the signal. And never surface infra language ("booting"):
  // to the user it's all just the agent thinking.
  const showWorking =
    working && (!last || last.role === 'user' || (last.role === 'assistant' && last.parts.length === 0))
  const workingLabel = phase ? `${phase}…` : 'Thinking…'

  // An assistant turn that hasn't produced anything yet is represented by the Thinking row, not an
  // empty bubble. (Terminal empty turns DO render, TurnView gives them an explicit placeholder.)
  const visibleTurns = turns.filter(
    (t) =>
      !(
        t.role === 'assistant' &&
        t.parts.length === 0 &&
        t.status === 'streaming' &&
        working &&
        t === last
      ),
  )

  // A step with no clock cannot be told apart from a wedged one. Tick only while a phase is
  // live, and only surface it once the wait is long enough to be worth explaining.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!phase) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [phase])
  const elapsed = phaseSince ? Math.max(0, Math.round((now - phaseSince) / 1000)) : 0

  // Provisioning is the one moment where infra detail helps: a cold start pulls an image and
  // clones a repo before anything can happen, and silence reads as breakage.
  const steps = [...(phaseLog ?? []), ...(phase ? [phase] : [])]
  return (
    <div className="flex flex-col gap-7">
      {steps.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
          {steps.map((step, i) => {
            const current = Boolean(phase) && i === steps.length - 1
            return (
              <li key={`${step}-${i}`} className="flex items-center gap-2">
                {current ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <Check className="size-3.5 shrink-0 text-primary" />
                )}
                <span className={current ? 'text-foreground' : 'text-muted-foreground'}>{step}</span>
                {current && elapsed >= 5 && (
                  <span className="text-muted-foreground tabular-nums">{elapsed}s</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {visibleTurns.map((turn) => (
        <TurnView key={turn.id} turn={turn} />
      ))}

      {permissions?.map((permission) => (
        <PermissionCard
          key={permission.id}
          permission={permission}
          onReply={(reply, note) => onPermissionReply?.(permission.id, reply, note)}
        />
      ))}

      {showWorking && <WorkingRow label={workingLabel} />}
    </div>
  )
}
