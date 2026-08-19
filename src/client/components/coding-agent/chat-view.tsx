'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useState } from 'react'
import { Bot, Check, Copy, Download, GitBranch, Layers, MoreHorizontal, PanelRight, Square } from 'lucide-react'

import type { SessionApi } from '@/hooks/use-session'
import { HARNESS_MARKS } from '../brand-marks'
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
import type { PastedBlock } from '~shared/protocol'
import { SubagentsPanel } from './subagents-panel'

/** Collapsed paste-chips carry real content, fold it back into the outgoing prompt. */
function withPasted(text: string, pasted: PastedBlock[]): string {
  if (!pasted.length) return text
  const blocks = pasted.map((p) => '```' + (p.language ?? '') + '\n' + p.content + '\n```').join('\n\n')
  return text ? `${text}\n\n${blocks}` : blocks
}

/** The header "…" menu: stop the turn, copy the session link, download the workspace. */
function SessionOptionsMenu({ session, busy }: { session: SessionApi; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const item =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted'

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Session options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl">
          {busy && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void session.stop()
              }}
              className={item}
            >
              <Square className="size-3.5 text-muted-foreground" />
              Stop turn
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href).then(() => {
                setCopied(true)
                setTimeout(() => {
                  setCopied(false)
                  setOpen(false)
                }, 900)
              })
            }}
            className={item}
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5 text-muted-foreground" />}
            {copied ? 'Copied' : 'Copy session link'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              if (session.meta?.id) window.open(`/api/sessions/${session.meta.id}/export`, '_blank')
            }}
            className={item}
          >
            <Download className="size-3.5 text-muted-foreground" />
            Download workspace (.tgz)
          </button>
        </div>
      )}
    </div>
  )
}

export function ChatView({ session }: { session: SessionApi }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dockOpen, setDockOpen] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [dynamicCommands, setDynamicCommands] = useState<{ name: string; description?: string }[]>([])
  const [subagentsOpen, setSubagentsOpen] = useState(false)
  const [previewReq, setPreviewReq] = useState<{ port: number; nonce: number } | null>(null)

  useEffect(() => {
    const onPreview = (e: Event) => {
      const port = (e as CustomEvent<{ port: number }>).detail?.port
      if (typeof port === 'number') {
        setPreviewReq({ port, nonce: Date.now() })
        setDockOpen(true)
      }
    }
    window.addEventListener('dw:preview', onPreview)
    return () => window.removeEventListener('dw:preview', onPreview)
  }, [])

  // A dev server coming up IS the ask to see it: auto-open the preview when a detection part
  // ARRIVES. Parts already in the transcript on load only seed the set, so reopening an old
  // session never pops the dock.
  const seenPreviews = useRef<Set<string> | null>(null)
  const seenPreviewsSession = useRef<string | null>(null)
  useEffect(() => {
    const sid = session.meta?.id ?? null
    if (seenPreviewsSession.current !== sid) {
      seenPreviewsSession.current = sid
      seenPreviews.current = null
    }
    // Key by turn AND part: part ids are stable per port (preview-3000), so a port re-declared
    // in a LATER turn ("show it to me again") must still fire.
    const parts = session.turns.flatMap((t) =>
      t.parts
        .filter((p): p is Extract<(typeof t.parts)[number], { kind: 'preview' }> => p.kind === 'preview')
        .map((p) => ({ key: `${t.id}:${p.id}`, port: p.port })),
    )
    // Seed on the FIRST non-empty turns update: that's the history hydration for existing
    // sessions (no popping on reload). A brand-new session's first update is the user's own
    // message, so seeding there is harmless and later detections still fire.
    if (session.turns.length === 0) return
    if (seenPreviews.current === null) {
      seenPreviews.current = new Set(parts.map((p) => p.key))
      return
    }
    for (const part of parts) {
      if (seenPreviews.current.has(part.key)) continue
      seenPreviews.current.add(part.key)
      window.dispatchEvent(new CustomEvent('dw:preview', { detail: { port: part.port } }))
    }
  }, [session.turns, session.meta?.id])

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
    if (out.length) filesCache.current = out // never cache an empty listing (cold sandbox)
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
              {(() => {
                const Mark = meta?.harness ? HARNESS_MARKS[meta.harness] : null
                return Mark ? <Mark className="size-3.5" /> : <Bot className="size-3.5 text-primary" />
              })()}
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
            className="relative gap-1.5"
            onClick={() => setDockOpen((v) => !v)}
            aria-label="Toggle workspace"
          >
            <PanelRight className="size-3.5" />
            <span className="hidden sm:inline">Workspace</span>
            {!dockOpen && session.turns.some((t) => t.parts.some((p) => p.kind === 'preview')) && (
              <span
                className="absolute -top-1 -right-1 size-2 rounded-full bg-success"
                title="A dev server is running, preview available"
              />
            )}
          </Button>
          <SessionOptionsMenu session={session} busy={busy} />
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
              {
                id: 'fork',
                label: 'Fork',
                hint: 'duplicate session (workspace + transcript)',
                run: () => void session.fork().then((r) => r.id && navigate(`/s/${r.id}`)),
              },
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
              <Button
                variant={subagentsOpen ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label="Sub-agents"
                onClick={() => setSubagentsOpen((v) => !v)}
              >
                <Layers className="size-4" />
              </Button>
            </>
          }
          onSend={(text, pasted, attachments) =>
            void (
              session.send as (
                text: string,
                attachments?: { key: string; name: string; size: number }[],
              ) => Promise<void>
            )(withPasted(text, pasted), attachments)
          }
          busy={busy}
          onSteer={(text, pasted, attachments) =>
            void session.stop().then(() =>
              (
                session.send as (
                  text: string,
                  attachments?: { key: string; name: string; size: number }[],
                ) => Promise<void>
              )(withPasted(text, pasted), attachments),
            )
          }
          sessionName={meta?.name ?? 'session'}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-full">
          <div className="pointer-events-auto relative mx-auto w-full max-w-3xl px-4">
            <SubagentsPanel turns={session.turns} open={subagentsOpen} onClose={() => setSubagentsOpen(false)} />
          </div>
        </div>
      </div>
    </div>
    {dockOpen && (
      <div className="fixed inset-0 z-40 lg:static lg:z-auto lg:h-full lg:shrink-0">
        <WorkspaceDock session={session} onClose={() => setDockOpen(false)} previewRequest={previewReq} />
      </div>
    )}
    </div>
  )
}

