import type {
  NormPermission,
  NormTurn,
  PermissionReply,
  SessionStatus,
} from '~shared/agent'
import { TurnView } from './turn-view'
import { PermissionCard } from './parts/permission-card'

function isTurnActive(turn: NormTurn | undefined): boolean {
  if (!turn) return false
  if (turn.status === 'streaming') return true
  return turn.parts.some((part) => {
    if (part.kind === 'text' || part.kind === 'reasoning') return Boolean(part.streaming)
    if (part.kind === 'tool') return part.state.status === 'running'
    return false
  })
}

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
  const showWorking = working && !isTurnActive(turns[turns.length - 1])
  const workingLabel = status === 'booting' ? 'Booting the sandbox…' : 'Working…'

  return (
    <div className="flex flex-col gap-7">
      {turns.map((turn) => (
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
