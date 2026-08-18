import { useState } from 'react'
import { CheckCircle2, Circle, ListTodo, Loader2, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormTodo } from '~shared/agent'

const VISIBLE = 8

function TodoIcon({ status }: { status: NormTodo['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-3.5 shrink-0 text-success" />
    case 'in_progress':
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
    case 'cancelled':
      return <XCircle className="size-3.5 shrink-0 text-muted-foreground/60" />
    default:
      return <Circle className="size-3.5 shrink-0 text-muted-foreground/60" />
  }
}

/** A plan / checklist card driven by the harness's todo list. */
export function TodoList({ todos }: { todos: NormTodo[] }) {
  const [expanded, setExpanded] = useState(false)

  if (todos.length === 0) return null

  const done = todos.filter((t) => t.status === 'completed').length
  const shown = expanded ? todos : todos.slice(0, VISIBLE)
  const hidden = todos.length - shown.length

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <ListTodo className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Plan</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {shown.map((todo, i) => {
          const struck = todo.status === 'completed' || todo.status === 'cancelled'
          return (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5">
                <TodoIcon status={todo.status} />
              </span>
              <span
                className={cn(
                  'min-w-0 text-pretty',
                  struck && 'text-muted-foreground line-through',
                  todo.status === 'in_progress' && 'text-foreground',
                )}
              >
                {todo.content}
              </span>
            </li>
          )
        })}
      </ul>
      {(hidden > 0 || expanded) && todos.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? 'Show less' : `+${hidden} more`}
        </button>
      )}
    </div>
  )
}
