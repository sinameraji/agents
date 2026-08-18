import { useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormPart } from '~shared/agent'

type ReasoningPartData = Extract<NormPart, { kind: 'reasoning' }>

/** Collapsed-by-default "Thinking" disclosure. Auto-expands (and pulses) while streaming. */
export function ReasoningPart({ part }: { part: ReasoningPartData }) {
  const [open, setOpen] = useState(false)
  const streaming = Boolean(part.streaming)
  const expanded = open || streaming

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground/80"
      >
        <Brain className={cn('size-3.5', streaming && 'animate-pulse text-primary')} />
        <span className={cn(streaming && 'animate-pulse')}>Thinking</span>
        <ChevronRight
          className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
        />
      </button>
      {expanded && part.text && (
        <div
          className={cn(
            'mt-1.5 border-l-2 border-border pl-3 text-sm text-muted-foreground italic whitespace-pre-wrap',
            streaming && 'animate-pulse',
          )}
        >
          {part.text}
        </div>
      )}
    </div>
  )
}
