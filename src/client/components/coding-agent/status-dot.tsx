import { cn } from '@/lib/utils'
import type { SessionStatus } from '~shared/protocol'

const STATUS_META: Record<
  SessionStatus,
  { label: string; dot: string; ring: string; pulse: boolean }
> = {
  provisioning: { label: 'Provisioning', dot: 'bg-primary', ring: 'bg-primary/30', pulse: true },
  running: { label: 'Running', dot: 'bg-primary', ring: 'bg-primary/30', pulse: true },
  review: { label: 'Needs review', dot: 'bg-warning', ring: 'bg-warning/30', pulse: false },
  idle: { label: 'Idle', dot: 'bg-muted-foreground', ring: 'bg-muted-foreground/20', pulse: false },
  error: { label: 'Failed', dot: 'bg-destructive', ring: 'bg-destructive/30', pulse: false },
}

export function StatusDot({
  status,
  className,
}: {
  status: SessionStatus
  className?: string
}) {
  const meta = STATUS_META[status]
  return (
    <span className={cn('relative flex size-2.5 shrink-0 items-center justify-center', className)}>
      {meta.pulse && (
        <span className={cn('absolute inline-flex size-full animate-ping rounded-full', meta.ring)} />
      )}
      <span className={cn('relative inline-flex size-2 rounded-full', meta.dot)} />
    </span>
  )
}

export function statusLabel(status: SessionStatus): string {
  return STATUS_META[status].label
}
