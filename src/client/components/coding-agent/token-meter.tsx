'use client'

import { ArrowDownLeft, ArrowUpRight, Coins } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatCost, formatTokens } from '~shared/format'

export function TokenMeter({
  tokensIn,
  tokensOut,
  costUsd,
  className,
}: {
  tokensIn: number
  tokensOut: number
  costUsd: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs',
        className,
      )}
      title="Input / output tokens and estimated cost for this session"
    >
      <span className="flex items-center gap-1 text-muted-foreground">
        <ArrowUpRight className="size-3.5 text-chart-4" />
        <span className="font-mono text-foreground/90">{formatTokens(tokensIn)}</span>
        <span className="hidden sm:inline">in</span>
      </span>
      <span className="h-3.5 w-px bg-border" />
      <span className="flex items-center gap-1 text-muted-foreground">
        <ArrowDownLeft className="size-3.5 text-chart-2" />
        <span className="font-mono text-foreground/90">{formatTokens(tokensOut)}</span>
        <span className="hidden sm:inline">out</span>
      </span>
      <span className="h-3.5 w-px bg-border" />
      <span className="flex items-center gap-1 font-medium text-primary">
        <Coins className="size-3.5" />
        <span className="font-mono">{formatCost(costUsd)}</span>
      </span>
    </div>
  )
}
