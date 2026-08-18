'use client'

import { useEffect, useRef, useState } from 'react'
import { GitBranch, Layers, MoreHorizontal, Server } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { PastedBlock, Provider, Session } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { StatusDot, statusLabel } from './status-dot'
import { TokenMeter } from './token-meter'
import { MessageItem } from './message-item'
import { Composer } from './composer'
import { SubAgentPanel } from './subagent-panel'
import { ModelPicker } from '../model-picker'
import { WorkingIndicator } from '../working-indicator'

export function ChatView({
  session,
  provider,
  working,
  workingLabel,
  onSend,
  onChangeModel,
}: {
  session: Session
  provider: Provider
  working?: boolean
  workingLabel?: string
  onSend: (text: string, pasted: PastedBlock[]) => void
  onChangeModel: (modelId: string) => void
}) {
  const [showSubAgents, setShowSubAgents] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const runningSubAgents = session.subAgents.filter((s) => s.status === 'running').length

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [session.messages.length, session.id, working])

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold">{session.name}</h1>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot status={session.status} className="size-2" />
              <span>{statusLabel(session.status)}</span>
              <span className="text-muted-foreground/40">·</span>
              <GitBranch className="size-3" />
              <span className="truncate font-mono">{session.repo}</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground lg:flex">
              <Server className="size-3.5" />
              sandbox <span className="font-mono text-foreground/90 uppercase">{session.region}</span>
            </span>
            <TokenMeter
              tokensIn={session.tokensIn}
              tokensOut={session.tokensOut}
              costUsd={session.costUsd}
              className="hidden md:flex"
            />
            <ModelPicker value={session.model} provider={provider} onChange={onChangeModel} />
            <Button
              variant={showSubAgents ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowSubAgents((v) => !v)}
              className="gap-1.5"
              disabled={session.subAgents.length === 0}
            >
              <Layers className="size-3.5" />
              <span className="hidden sm:inline">Sub-agents</span>
              {session.subAgents.length > 0 && (
                <span
                  className={cn(
                    'grid min-w-4.5 place-items-center rounded px-1 text-[0.65rem] font-medium',
                    runningSubAgents > 0
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {session.subAgents.length}
                </span>
              )}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Session options">
              <MoreHorizontal className="size-4" />
            </Button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-6">
            {session.messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
            {working && <WorkingIndicator label={workingLabel ?? 'Working…'} />}
          </div>
        </div>

        <Composer onSend={onSend} sessionName={session.name} />
      </div>

      {showSubAgents && session.subAgents.length > 0 && (
        <div className="hidden h-full w-80 shrink-0 md:block">
          <SubAgentPanel subAgents={session.subAgents} onClose={() => setShowSubAgents(false)} />
        </div>
      )}
    </div>
  )
}
