import { useEffect } from 'react'
import { Bot, Check, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormTurn } from '~shared/agent'

export interface CollectedSubtask {
  id: string
  agent: string
  description?: string
  turnId: string
  turnStatus: NormTurn['status']
  createdAt: number
}

/** Walk turns in order and pull every 'subtask' part, carrying the parent turn's status. */
export function collectSubtasks(turns: NormTurn[]): CollectedSubtask[] {
  const out: CollectedSubtask[] = []
  for (const turn of turns) {
    for (const part of turn.parts) {
      if (part.kind !== 'subtask') continue
      out.push({
        id: part.id,
        agent: part.agent,
        description: part.description,
        turnId: turn.id,
        turnStatus: turn.status,
        createdAt: turn.createdAt,
      })
    }
  }
  return out
}

function StatusChip({ status }: { status: NormTurn['status'] }) {
  switch (status) {
    case 'streaming':
      return (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-primary">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
          running
        </span>
      )
    case 'complete':
      return (
        <span className="flex shrink-0 items-center gap-1 text-xs text-success">
          <Check className="size-3.5" />
          done
        </span>
      )
    case 'error':
      return (
        <span className="flex shrink-0 items-center gap-1 text-xs text-destructive">
          <X className="size-3.5" />
          failed
        </span>
      )
    case 'aborted':
      return <span className="shrink-0 text-xs text-muted-foreground">stopped</span>
    default:
      return null
  }
}

/**
 * Floating panel listing every sub-agent the harness has spawned this session
 * (OpenCode subtasks, pi/Claude-style task tools), newest first.
 */
export function SubagentsPanel({
  turns,
  open,
  onClose,
  className,
}: {
  turns: NormTurn[]
  open: boolean
  onClose: () => void
  className?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const subtasks = collectSubtasks(turns).reverse()

  return (
    <div
      role="dialog"
      aria-label="Sub-agents"
      className={cn(
        'absolute right-0 bottom-full z-30 mb-2 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-xl',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Sub-agents</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {subtasks.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sub-agents panel"
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {subtasks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          No sub-agent activity in this session yet. Harnesses spawn sub-agents for parallel work
          (OpenCode subtasks, pi/Claude-style task tools).
        </p>
      ) : (
        <ul className="scrollbar-thin max-h-80 overflow-y-auto p-1">
          {subtasks.map((task) => (
            <li key={task.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
              <Bot className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{task.agent}</span>
                {task.description && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {task.description}
                  </span>
                )}
              </span>
              <span className="mt-0.5">
                <StatusChip status={task.turnStatus} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
