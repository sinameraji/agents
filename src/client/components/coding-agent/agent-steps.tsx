import { Check, CircleDashed, Loader2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { AgentStep } from '~shared/protocol'

function StepIcon({ status }: { status: AgentStep['status'] }) {
  switch (status) {
    case 'done':
      return <Check className="size-3.5 text-success" />
    case 'running':
      return <Loader2 className="size-3.5 animate-spin text-primary" />
    case 'error':
      return <X className="size-3.5 text-destructive" />
    default:
      return <CircleDashed className="size-3.5 text-muted-foreground/60" />
  }
}

export function AgentSteps({ steps, className }: { steps: AgentStep[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col gap-1.5', className)}>
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-4 place-items-center">
            <StepIcon status={step.status} />
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span
              className={cn(
                step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground/90',
                step.status === 'running' && 'text-foreground',
              )}
            >
              {step.label}
            </span>
            {step.detail && (
              <span className="font-mono text-xs text-muted-foreground">{step.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
