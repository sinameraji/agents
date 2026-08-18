import { Sparkles, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormTurn } from '~shared/agent'
import { Markdown } from './markdown'
import { PartView } from './part'
import { ErrorBlock } from './parts/error-block'
import { UsageStrip } from './parts/usage-strip'

function timestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Avatar({ isUser }: { isUser: boolean }) {
  return (
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
  )
}

/** One turn of the transcript: a user message, or an assistant's ordered stream of parts. */
export function TurnView({ turn }: { turn: NormTurn }) {
  const isUser = turn.role === 'user'

  return (
    <div className="flex gap-3">
      <Avatar isUser={isUser} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{isUser ? 'You' : 'Agent'}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {timestamp(turn.createdAt)}
          </span>
        </div>

        {isUser ? (
          <UserBody turn={turn} />
        ) : (
          <>
            {turn.parts.map((part) => (
              <PartView key={part.id} part={part} />
            ))}
            {turn.usage && <UsageStrip usage={turn.usage} />}
            {turn.error && <ErrorBlock name={turn.error.name} message={turn.error.message} />}
          </>
        )}
      </div>
    </div>
  )
}

function UserBody({ turn }: { turn: NormTurn }) {
  const text = turn.parts
    .filter((p): p is Extract<NormTurn['parts'][number], { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n\n')

  if (!text) return null
  return <Markdown text={text} />
}
