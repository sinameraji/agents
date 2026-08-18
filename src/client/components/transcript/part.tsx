import { GitBranch } from 'lucide-react'

import type { NormPart } from '~shared/agent'
import { TextPart } from './parts/text-part'
import { ReasoningPart } from './parts/reasoning-part'
import { ToolCard } from './parts/tool-card'
import { TodoList } from './parts/todo-list'
import { DiffBlock } from './parts/diff-block'
import { TerminalBlock } from './parts/terminal-block'
import { UsageStrip } from './parts/usage-strip'
import { ErrorBlock } from './parts/error-block'

/** Renders a single normalized part. Permissions are handled separately, not here. */
export function PartView({ part }: { part: NormPart }) {
  switch (part.kind) {
    case 'text':
      return <TextPart part={part} />
    case 'reasoning':
      return <ReasoningPart part={part} />
    case 'tool':
      return <ToolCard part={part} />
    case 'todos':
      return <TodoList todos={part.todos} />
    case 'diff':
      return <DiffBlock files={part.files} />
    case 'terminal':
      return (
        <TerminalBlock command={part.command} output={part.output} exitCode={part.exitCode} />
      )
    case 'step':
      return part.usage ? <UsageStrip usage={part.usage} /> : null
    case 'subtask':
      return (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-sm">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{part.agent}</span>
          {part.description && (
            <span className="min-w-0 truncate text-muted-foreground">{part.description}</span>
          )}
        </div>
      )
    case 'error':
      return <ErrorBlock name={part.name} message={part.message} />
    default:
      return null
  }
}
