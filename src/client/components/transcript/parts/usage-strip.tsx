import { ArrowDown, ArrowUp, Coins } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormUsage } from '~shared/agent'
import { formatCost, formatTokens } from '~shared/format'

/** A subtle one-line token/cost footer for a turn or step. */
export function UsageStrip({ usage, className }: { usage: NormUsage; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 font-mono text-xs text-muted-foreground',
        className,
      )}
    >
      <span className="flex items-center gap-1" title="Input tokens">
        <ArrowUp className="size-3" />
        {formatTokens(usage.input)}
      </span>
      <span className="flex items-center gap-1" title="Output tokens">
        <ArrowDown className="size-3" />
        {formatTokens(usage.output)}
      </span>
      {typeof usage.cost === 'number' && usage.cost > 0 && (
        <span className="flex items-center gap-1 text-foreground/70" title="Estimated cost">
          <Coins className="size-3" />
          {formatCost(usage.cost)}
        </span>
      )}
    </div>
  )
}
