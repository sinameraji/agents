'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, GitBranch, Layers, MoreHorizontal, Server } from 'lucide-react'

import { cn } from '@/lib/utils'
import { MODELS } from '@/lib/mock-data'
import type { PastedBlock, Session } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { StatusDot, statusLabel } from './status-dot'
import { TokenMeter } from './token-meter'
import { MessageItem } from './message-item'
import { Composer } from './composer'
import { SubAgentPanel } from './subagent-panel'

export function ChatView({
  session,
  onSend,
  onChangeModel,
}: {
  session: Session
  onSend: (text: string, pasted: PastedBlock[]) => void
  onChangeModel: (modelId: string) => void
}) {
  const [showSubAgents, setShowSubAgents] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const runningSubAgents = session.subAgents.filter((s) => s.status === 'running').length

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [session.messages.length, session.id])

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
            <ModelPicker value={session.model} onChange={onChangeModel} />
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

function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = MODELS.find((m) => m.id === value) ?? MODELS[0]

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="hidden max-w-32 truncate sm:inline">{current.label}</span>
        <span className="sm:hidden">{current.label.split(' ')[0]}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                m.id === value && 'bg-muted',
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.provider}</span>
              </div>
              <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">
                ${m.inputPerM}/${m.outputPerM}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
