import { FileDiff, Sparkles, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Message } from '~shared/protocol'
import { AgentSteps } from './agent-steps'
import { PastedBlock } from './pasted-block'

export function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border',
          isUser
            ? 'border-border bg-secondary text-secondary-foreground'
            : 'border-primary/30 bg-primary/15 text-primary',
        )}
        aria-hidden
      >
        {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{isUser ? 'You' : 'Agent'}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {message.text && (
          <p className="text-[0.95rem] leading-relaxed text-pretty text-foreground/90">
            {message.text}
          </p>
        )}

        {message.pasted && message.pasted.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.pasted.map((block) => (
              <PastedBlock key={block.id} block={block} />
            ))}
          </div>
        )}

        {message.steps && message.steps.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <AgentSteps steps={message.steps} />
          </div>
        )}

        {message.diff && message.diff.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/60 p-2">
            {message.diff.map((d) => (
              <div key={d.file} className="flex items-center gap-2 px-1 py-0.5 text-sm">
                <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs text-foreground/90">{d.file}</span>
                <span className="ml-auto font-mono text-xs text-success">+{d.added}</span>
                <span className="font-mono text-xs text-destructive">-{d.removed}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
