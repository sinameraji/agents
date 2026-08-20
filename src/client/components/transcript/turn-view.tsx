import { useState } from 'react'
import { Bot, Check, Copy, Sparkles, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormTurn } from '~shared/agent'
import { Markdown } from './markdown'
import { PartView } from './part'
import { ErrorBlock } from './parts/error-block'
import { UsageStrip } from './parts/usage-strip'

/** Split a turn's parts into runs: consecutive tool parts group together, others stand alone. */
function groupParts(parts: NormTurn['parts']): NormTurn['parts'][number][][] {
  const groups: NormTurn['parts'][number][][] = []
  for (const part of parts) {
    const last = groups[groups.length - 1]
    if (part.kind === 'tool' && last && last[last.length - 1].kind === 'tool') last.push(part)
    else groups.push([part])
  }
  return groups
}

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

function CopyTurnButton({ turn }: { turn: NormTurn }) {
  const [copied, setCopied] = useState(false)
  const text = turn.parts
    .filter((p): p is Extract<NormTurn['parts'][number], { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n\n')
  if (!text) return null
  return (
    <button
      type="button"
      aria-label="Copy message"
      title="Copy message"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/turn:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 max-sm:opacity-60"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** One turn of the transcript: a user message, or an assistant's ordered stream of parts. */
export function TurnView({ turn }: { turn: NormTurn }) {
  const isUser = turn.role === 'user'

  return (
    <div className="group/turn flex gap-3">
      <Avatar isUser={isUser} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{isUser ? 'You' : 'Agent'}</span>
          {/* Only set when a NON-default named agent ran the turn, so its presence is the signal. */}
          {!isUser && turn.agent && (
            <span
              title={`Handled by the ${turn.agent} agent`}
              className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[0.7rem] leading-none text-primary"
            >
              <Bot className="size-3" />
              {turn.agent}
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {timestamp(turn.createdAt)}
          </span>
          <CopyTurnButton turn={turn} />
        </div>

        {isUser ? (
          <UserBody turn={turn} />
        ) : (
          <>
            {groupParts(turn.parts).map((group) =>
              group.length > 1 || group[0].kind === 'tool' ? (
                // Consecutive tool calls render as one tight action log, not spaced cards.
                <div key={group[0].id} className="flex flex-col gap-0.5">
                  {group.map((part) => (
                    <PartView key={part.id} part={part} />
                  ))}
                </div>
              ) : (
                <PartView key={group[0].id} part={group[0]} />
              ),
            )}
            {turn.parts.length === 0 && !turn.error && (
              <p className="text-sm text-muted-foreground italic">
                {turn.status === 'aborted'
                  ? 'Stopped before responding.'
                  : turn.status === 'error'
                    ? 'Failed before producing output.'
                    : turn.status === 'streaming'
                      ? 'Interrupted, no output.'
                      : 'No output produced.'}
              </p>
            )}
            {turn.usage && (turn.parts.length > 0 || (turn.usage.input ?? 0) + (turn.usage.output ?? 0) > 0) && (
              <UsageStrip usage={turn.usage} />
            )}
            {turn.error &&
              !turn.parts.some((p) => p.kind === 'error' && p.message === turn.error?.message) && (
                <ErrorBlock name={turn.error.name} message={turn.error.message} />
              )}
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
