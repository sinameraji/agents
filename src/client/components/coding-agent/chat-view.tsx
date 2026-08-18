'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useState } from 'react'
import { Bot, GitBranch, Layers, MoreHorizontal, PanelRight, Square } from 'lucide-react'

import type { SessionApi } from '@/hooks/use-session'
import { HARNESSES } from '~shared/protocol'
import { useRouter } from '@/router'
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
  const [editingName, setEditingName] = useState<string | null>(null)
  const [dynamicCommands, setDynamicCommands] = useState<{ name: string; description?: string }[]>([])
  const dynFetchedFor = useRef<string | null>(null)
  const { navigate } = useRouter()
  const meta = session.meta
  const harnessLabel = HARNESSES.find((h) => h.id === meta?.harness)?.label ?? meta?.harness ?? ''
  const busy = session.status === 'busy' || session.status === 'booting'
  const turnCount = session.turns.length

  const filesCache = useRef<string[] | null>(null)
  const listWorkspaceFiles = useCallback(async () => {
    if (filesCache.current) return filesCache.current
    const out: string[] = []
    const queue = ['/workspace']
    const SKIP = /(^|\/)(node_modules|\.git|dist|\.next|\.cache|uploads)$/
    while (queue.length && out.length < 300) {
      const dir = queue.shift()!
      const entries = await session.listFiles(dir).catch(() => [])
      for (const e of entries) {
        if (e.isDirectory) {
          if (!SKIP.test(e.path)) queue.push(e.path)
        } else {
          out.push(e.path.replace(/^\/workspace\//, ''))
        }
      }
    }
    filesCache.current = out
    return out
  }, [session])

  /** Lazily pull the harness's own command list the first time the '/' menu opens. */
  const fetchHarnessCommands = useCallback(() => {
    if (!meta?.id || dynFetchedFor.current === meta.id) return
    dynFetchedFor.current = meta.id
    void session.harnessCommands().then(setDynamicCommands).catch(() => {})
  }, [session, meta?.id])

  const commitRename = () => {
    const name = (editingName ?? '').trim()
    setEditingName(null)
    if (name && name !== meta?.name) void session.rename(name)
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turnCount, session.status, meta?.id])

  return (
    <div className="flex h-full min-w-0 flex-1">
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex min-w-0 flex-col">
          {editingName === null ? (
            <h1
              className="cursor-text truncate text-sm font-semibold hover:text-foreground/80"
              title="Click to rename"
              onClick={() => setEditingName(meta?.name ?? '')}
            >
              {meta?.name ?? 'Session'}
            </h1>
          ) : (
            <input
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditingName(null)
              }}
              aria-label="Session name"
              className="w-56 rounded-md border border-border bg-card px-1.5 py-0.5 text-sm font-semibold outline-none focus:border-primary/60"
            />
          )}
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
          {harnessLabel && (
            <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground sm:flex">
              <Bot className="size-3.5 text-primary" />
              <span className="font-medium text-foreground/90">{harnessLabel}</span>
            </span>
          )}
          <TokenMeter
            tokensIn={session.usage.tokensIn}
            tokensOut={session.usage.tokensOut}
            costUsd={session.usage.costUsd}
            className="hidden md:flex"
          />
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
          listFiles={listWorkspaceFiles}
          onCommandMenuOpen={fetchHarnessCommands}
          commands={(() => {
            const base = [
              { id: 'plan', label: 'Plan', hint: 'read-only mode', run: () => void session.setMode('plan') },
              { id: 'build', label: 'Build', hint: 'edits allowed', run: () => void session.setMode('build') },
              { id: 'auto', label: 'Auto', hint: 'approve everything', run: () => void session.setMode('auto') },
              { id: 'stop', label: 'Stop', hint: 'interrupt the agent', run: () => void session.stop() },
              { id: 'workspace', label: 'Workspace', hint: 'toggle the side panel', run: () => setDockOpen((v) => !v) },
              { id: 'new', label: 'New session', hint: 'start another session', run: () => navigate('/new') },
              { id: 'clear', label: 'Clear', hint: 'wipe this conversation', run: () => void session.runCommand('clearTranscript') },
              ...(meta?.harness === 'opencode'
                ? [
                    { id: 'compact', label: 'Compact', hint: 'summarize older turns', run: () => void session.runCommand('compact') },
                    { id: 'undo', label: 'Undo', hint: 'revert last change', run: () => void session.runCommand('undo') },
                    { id: 'redo', label: 'Redo', hint: 'restore reverted change', run: () => void session.runCommand('redo') },
                    { id: 'init', label: 'Init', hint: 'scan repo → AGENTS.md', run: () => void session.runCommand('initProject') },
                    { id: 'diff', label: 'Diff', hint: 'show session changes', run: () => void session.runCommand('showDiff') },
                    { id: 'share', label: 'Share', hint: 'get a share link', run: () => void session.runCommand('share') },
                    { id: 'unshare', label: 'Unshare', hint: 'revoke the share link', run: () => void session.runCommand('unshare') },
                  ]
                : []),
              ...(meta?.harness === 'pi'
                ? [
                    { id: 'compact', label: 'Compact', hint: 'summarize context', run: () => void session.runCommand('compact') },
                    { id: 'stats', label: 'Stats', hint: 'session statistics', run: () => void session.bridgeCommand('stats') },
                    { id: 'export', label: 'Export', hint: 'session → HTML in the workspace', run: () => void session.bridgeCommand('export') },
                  ]
                : []),
              ...(meta?.harness === 'aisdk' || meta?.harness === 'cfagent'
                ? [{ id: 'compact', label: 'Compact', hint: 'summarize context', run: () => void session.runCommand('compact') }]
                : []),
            ]
            const taken = new Set(base.map((c) => c.id))
            return [
              ...base,
              ...dynamicCommands
                .filter((c) => !taken.has(c.name))
                .map((c) => ({
                  id: c.name,
                  label: c.name,
                  hint: c.description ?? 'harness command',
                  run: () => void session.runCustomCommand(c.name),
                })),
            ]
          })()}
          extras={
            <>
              <div className="flex items-center rounded-lg border border-border bg-card/60 p-0.5 text-xs" role="group" aria-label="Mode">
                {(['plan', 'build', 'auto'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void session.setMode(m)}
                    className={
                      'rounded-md px-2 py-0.5 capitalize transition-colors ' +
                      (session.mode === m
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:text-foreground')
                    }
                    title={
                      m === 'plan'
                        ? 'Plan: read-only, no edits'
                        : m === 'build'
                          ? 'Build: edits allowed, approvals may apply'
                          : 'Auto: approve everything'
                    }
                  >
                    {m}
                  </button>
                ))}
              </div>
              <ModelPicker
                value={meta?.model ?? ''}
                provider={meta?.provider ?? 'openrouter'}
                direction="up"
                onChange={(id) => void session.setModel(id)}
              />
              <Button variant="ghost" size="icon-sm" disabled aria-label="Sub-agents">
                <Layers className="size-4" />
              </Button>
            </>
          }
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

