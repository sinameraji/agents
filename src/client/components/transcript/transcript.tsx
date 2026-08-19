import type {
  NormPermission,
  NormTurn,
  PermissionReply,
  SessionStatus,
} from '~shared/agent'
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
  onPermissionReply,
}: {
  turns: NormTurn[]
  permissions?: NormPermission[]
  status?: SessionStatus
  onPermissionReply?: (id: string, reply: PermissionReply, note?: string) => void
}) {
  const working = status === 'booting' || status === 'busy'
  const last = turns[turns.length - 1]
  // Only show the indicator BEFORE the assistant produces anything, once content streams (or the
  // turn is done), the content itself is the signal. And never surface infra language ("booting"):
  // to the user it's all just the agent thinking.
  const showWorking =
    working && (!last || last.role === 'user' || (last.role === 'assistant' && last.parts.length === 0))
  const workingLabel = 'Thinking…'

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

  return (
    <div className="flex flex-col gap-7">
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
