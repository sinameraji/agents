'use client'

import { useEffect, useRef } from 'react'
import { useState } from 'react'
import { GitBranch, Layers, MoreHorizontal, PanelRight, Server, Square } from 'lucide-react'

import type { SessionApi } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'
import { StatusDot, statusLabel } from './status-dot'
import { TokenMeter } from './token-meter'
import { Composer } from './composer'
import { ModelPicker } from '../model-picker'
import { Transcript } from '../transcript/transcript'
import { TodoList } from '../transcript/parts/todo-list'
import { WorkspaceDock } from '../workspace/workspace-dock'

export function ChatView({ session }: { session: SessionApi }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dockOpen, setDockOpen] = useState(false)
  const meta = session.meta
  const busy = session.status === 'busy' || session.status === 'booting'
  const turnCount = session.turns.length

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turnCount, session.status, meta?.id])

  return (
    <div className="flex h-full min-w-0 flex-1">
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm font-semibold">{meta?.name ?? 'Session'}</h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot status={session.status} className="size-2" />
            <span>{statusLabel(session.status)}</span>
            {meta?.repo && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <GitBranch className="size-3" />
                <span className="truncate font-mono">{meta.repo}</span>
              </>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground lg:flex">
            <Server className="size-3.5" />
            sandbox <span className="font-mono text-foreground/90 uppercase">{meta?.region ?? 'iad1'}</span>
          </span>
          <TokenMeter
            tokensIn={session.usage.tokensIn}
            tokensOut={session.usage.tokensOut}
            costUsd={session.usage.costUsd}
            className="hidden md:flex"
          />
          <div className="hidden items-center rounded-lg border border-border bg-card/60 p-0.5 text-xs md:flex" role="group" aria-label="Mode">
            {(['plan', 'build'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => void session.setMode(m)}
                className={
                  'rounded-md px-2 py-1 capitalize transition-colors ' +
                  (session.mode === m ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground')
                }
                title={m === 'plan' ? 'Plan: read-only, no edits' : 'Build: full access'}
              >
                {m}
              </button>
            ))}
          </div>
          <ModelPicker
            value={meta?.model ?? ''}
            provider={meta?.provider ?? 'openrouter'}
            onChange={(id) => void session.setModel(id)}
          />
          <Button variant="outline" size="sm" className="gap-1.5" disabled aria-label="Sub-agents">
            <Layers className="size-3.5" />
            <span className="hidden sm:inline">Sub-agents</span>
          </Button>
          <Button
            variant={dockOpen ? 'secondary' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => setDockOpen((v) => !v)}
            aria-label="Toggle workspace"
          >
            <PanelRight className="size-3.5" />
            <span className="hidden sm:inline">Workspace</span>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Session options">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </header>

      {/* Transcript */}
      <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
          {session.todos.length > 0 && <TodoList todos={session.todos} />}
          <Transcript
            turns={session.turns}
            permissions={session.permissions}
            status={session.status}
            onPermissionReply={(id, reply, note) => void session.respondPermission(id, reply, note)}
          />
        </div>
      </div>

      <div className="relative">
        {busy && (
          <div className="pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2">
            <Button
              variant="secondary"
              size="sm"
              className="pointer-events-auto gap-1.5 shadow-md"
              onClick={() => void session.stop()}
            >
              <Square className="size-3 fill-current" />
              Stop
            </Button>
          </div>
        )}
        <Composer
          onSend={(text, _pasted, attachments) =>
            void (
              session.send as (
                text: string,
                attachments?: { key: string; name: string; size: number }[],
              ) => Promise<void>
            )(text, attachments)
          }
          sessionName={meta?.name ?? 'session'}
        />
      </div>
    </div>
    {dockOpen && (
      <div className="hidden h-full shrink-0 lg:block">
        <WorkspaceDock session={session} onClose={() => setDockOpen(false)} />
      </div>
    )}
    </div>
  )
}

