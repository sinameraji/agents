'use client'

import { useState } from 'react'
import { ArrowLeft, ChevronRight, GitBranch, Loader2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatTokens } from '~shared/format'
import type { SubAgent, SubAgentStatus } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { AgentSteps } from './agent-steps'

const SUBAGENT_STATUS: Record<SubAgentStatus, { label: string; className: string }> = {
  running: { label: 'Running', className: 'text-primary' },
  done: { label: 'Done', className: 'text-success' },
  queued: { label: 'Queued', className: 'text-muted-foreground' },
  error: { label: 'Failed', className: 'text-destructive' },
}

export function SubAgentPanel({
  subAgents,
  onClose,
}: {
  subAgents: SubAgent[]
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = subAgents.find((s) => s.id === selectedId) ?? null

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-sidebar">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {selected ? (
          <Button variant="ghost" size="icon-sm" onClick={() => setSelectedId(null)} aria-label="Back to list">
            <ArrowLeft className="size-4" />
          </Button>
        ) : (
          <GitBranch className="ml-1 size-4 text-primary" />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {selected ? selected.name : 'Sub-agents'}
          </span>
          <span className="text-xs text-muted-foreground">
            {selected ? selected.task : `${subAgents.length} dispatched`}
          </span>
        </div>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onClose} aria-label="Close sub-agents">
          <X className="size-4" />
        </Button>
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
        {selected ? (
          <div className="flex flex-col gap-4">
            <ProgressBar value={selected.progress} status={selected.status} />
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Model" value={selected.model.split('-')[0]} mono />
              <Stat label="Tokens in" value={formatTokens(selected.tokensIn)} mono />
              <Stat label="Tokens out" value={formatTokens(selected.tokensOut)} mono />
            </dl>
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Activity
              </p>
              <AgentSteps steps={selected.steps} />
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {subAgents.map((agent) => {
              const meta = SUBAGENT_STATUS[agent.status]
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(agent.id)}
                    className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-card"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        {agent.status === 'running' && (
                          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                        )}
                        <span className="truncate font-mono text-sm">{agent.name}</span>
                        <span className={cn('ml-auto text-xs', meta.className)}>{meta.label}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{agent.task}</p>
                      <ProgressBar value={agent.progress} status={agent.status} thin />
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

function ProgressBar({
  value,
  status,
  thin,
}: {
  value: number
  status: SubAgentStatus
  thin?: boolean
}) {
  const color =
    status === 'error' ? 'bg-destructive' : status === 'done' ? 'bg-success' : 'bg-primary'
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-muted', thin ? 'h-1' : 'h-1.5')}>
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${status === 'done' ? 100 : value}%` }}
      />
    </div>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card/50 px-2 py-1.5">
      <div className={cn('truncate text-sm', mono && 'font-mono')}>{value}</div>
      <div className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  )
}
