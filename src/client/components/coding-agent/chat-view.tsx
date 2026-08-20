'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useState } from 'react'
import { Bot, Check, Copy, Download, FileText, GitBranch, Layers, MoreHorizontal, PanelRight, Square } from 'lucide-react'

import type { SessionApi } from '@/hooks/use-session'
import { transcriptToMarkdown } from '~shared/transcript-markdown'
import { HARNESS_MARKS, PROVIDER_MARKS, PROVIDER_LABELS } from '../brand-marks'
import { HARNESSES } from '~shared/protocol'
import { harnessCaps } from '~shared/harness-caps'
import { mergeDynamicCommands, parseBangCommand, parseSlashInvocation } from '~shared/composer-input'
import { modelAcceptsImages } from '~shared/vision'
import { pricingOf } from '~shared/pricing'
import type { UploadedAttachment } from '@/lib/upload'
import { useRouter } from '@/router'
import { Button } from '@/components/ui/button'
import { StatusDot, statusLabel } from './status-dot'
import { TokenMeter } from './token-meter'
import { Composer } from './composer'
import { ModelPicker, useModelInfo } from '../model-picker'
import { Transcript } from '../transcript/transcript'
import { TodoList } from '../transcript/parts/todo-list'
import { WorkspaceDock } from '../workspace/workspace-dock'
import type { PastedBlock } from '~shared/protocol'
import { SubagentsPanel } from './subagents-panel'

/** Mode slash commands + switcher metadata. The switcher always renders all three and DISABLES
 *  the ones caps.modes lacks (a grayed Plan with a tooltip is information; a missing one is a
 *  mystery). Slash commands still only exist for real modes. */
const MODE_COMMANDS = [
  { id: 'plan', label: 'Plan', hint: 'read-only mode', title: 'Plan: read-only, no edits' },
  { id: 'build', label: 'Build', hint: 'ask before edits/shell', title: 'Build: asks before file edits and shell commands' },
  { id: 'auto', label: 'Auto', hint: 'run everything unasked', title: 'Auto: run everything without asking' },
] as const

/** Registry for manifest-declared harness commands: slash id, label, hint, and how to run it. */
const HARNESS_COMMAND_DEFS: Record<string, { label: string; hint: string; run: (session: SessionApi) => void }> = {
  compact: { label: 'Compact', hint: 'summarize older turns', run: (s) => void s.runCommand('compact') },
  undo: { label: 'Undo', hint: 'revert last change', run: (s) => void s.runCommand('undo') },
  redo: { label: 'Redo', hint: 'restore reverted change', run: (s) => void s.runCommand('redo') },
  init: { label: 'Init', hint: 'scan repo → AGENTS.md', run: (s) => void s.runCommand('initProject') },
  diff: { label: 'Diff', hint: 'show session changes', run: (s) => void s.runCommand('showDiff') },
  share: { label: 'Share', hint: 'get a share link', run: (s) => void s.runCommand('share') },
  unshare: { label: 'Unshare', hint: 'revoke the share link', run: (s) => void s.runCommand('unshare') },
  stats: { label: 'Stats', hint: 'session statistics', run: (s) => void s.bridgeCommand('stats') },
  export: { label: 'Export', hint: 'session → HTML in the workspace', run: (s) => void s.bridgeCommand('export') },
}

/** The '!' affordance, listed in the slash menu so it is discoverable rather than folklore. */
const BANG_HELP = {
  id: 'shell',
  label: 'Shell',
  hint: 'or type ! before a command',
} as const

/** Strip client-only fields (thumbnail object URLs) before attachments cross the RPC. */
function attachmentsToWire(attachments: UploadedAttachment[]) {
  return attachments.map(({ key, name, size, mime }) => ({ key, name, size, mime }))
}

/** Collapsed paste-chips carry real content, fold it back into the outgoing prompt. */
function withPasted(text: string, pasted: PastedBlock[]): string {
  if (!pasted.length) return text
  const blocks = pasted.map((p) => '```' + (p.language ?? '') + '\n' + p.content + '\n```').join('\n\n')
  return text ? `${text}\n\n${blocks}` : blocks
}

/** Build the transcript markdown from the already-loaded turns and hand it over as a download.
 *  Entirely client-side: no server round trip. */
function downloadTranscript(session: SessionApi) {
  const md = transcriptToMarkdown({
    title: session.meta?.name ?? 'Session',
    harness: session.meta?.harness,
    model: session.meta?.model,
    turns: session.turns,
  })
  const slug =
    (session.meta?.name ?? 'session')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'session'
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug}-transcript.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The header "…" menu: stop the turn, copy the session link, export the transcript, download the workspace. */
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
              downloadTranscript(session)
            }}
            className={item}
          >
            <FileText className="size-3.5 text-muted-foreground" />
            Export transcript (.md)
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
  const [dynamicCommands, setDynamicCommands] = useState<
    { name: string; description?: string; takesArgs?: boolean }[]
  >([])
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
  const caps = harnessCaps(meta?.harness)
  // Both image axes, mirrored from the server's delivery decision: the harness pipe (caps) AND
  // the current model (live OpenRouter metadata when the picker cached it, heuristic otherwise).
  // Only drives the composer's "model won't see this" hint; the DO decides delivery itself.
  // One live catalog lookup for the current model, shared by the image hint and the cost chip.
  const modelInfo = useModelInfo(meta?.provider ?? 'openrouter', meta?.harness, meta?.model ?? '')
  const imagesReachModel =
    caps.promptCapabilities.image && !!meta && modelAcceptsImages(meta.provider, meta.model, modelInfo?.vision)
  // Pre-send cost estimate: only when the catalog actually prices this model (Workers AI and the
  // direct anthropic/openai lanes publish no price here, and a chip is worse than no chip if the
  // number is invented). The measured half comes from the session's own assistant turns.
  const costHint = useMemo(() => {
    const pricing = pricingOf(modelInfo)
    if (!pricing) return undefined
    const measured = session.turns.filter((t) => t.role === 'assistant' && t.usage)
    return {
      pricing,
      lastInputTokens: measured[measured.length - 1]?.usage?.input,
      recentOutputTokens: measured.slice(-3).map((t) => t.usage?.output ?? 0),
    }
  }, [modelInfo, session.turns])
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

  // Slash text typed WITH arguments only routes for commands the harness itself named (plus
  // '/shell'): intercepting the built-in ids too would swallow ordinary prose like "/new idea".
  const routableCommands = [
    ...dynamicCommands.map((c) => c.name),
    ...(caps.bangShell ? [BANG_HELP.id] : []),
  ]

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
          {meta?.provider && (
            <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground lg:flex">
              {(() => {
                const Mark = PROVIDER_MARKS[meta.provider]
                return Mark ? <Mark className="size-3.5" /> : null
              })()}
              <span className="font-medium text-foreground/90">{PROVIDER_LABELS[meta.provider] ?? meta.provider}</span>
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
          allowAttachments={caps.promptCapabilities.fileAttach}
          imagesReachModel={imagesReachModel}
          costHint={costHint}
          liveSteer={caps.steering === 'live'}
          commands={(() => {
            // Mode commands only exist where the harness has more than one real mode.
            const modeCommands =
              caps.modes.length > 1
                ? MODE_COMMANDS.filter((m) => caps.modes.includes(m.id)).map((m) => ({
                    id: m.id,
                    label: m.label,
                    hint: m.hint,
                    run: () => void session.setMode(m.id),
                  }))
                : []
            const base = [
              ...modeCommands,
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
              // Harness-specific commands come from the capability manifest, not inline harness checks.
              ...caps.commands.flatMap((id) => {
                const def = HARNESS_COMMAND_DEFS[id]
                return def ? [{ id, label: def.label, hint: def.hint, run: () => def.run(session) }] : []
              }),
              // Same gate: '/shell' is only real where the harness can run a command directly.
              ...(caps.bangShell
                ? [
                    {
                      ...BANG_HELP,
                      takesArgs: true,
                      run: (args?: string) => {
                        if (args?.trim()) void session.runShell(args.trim())
                      },
                    },
                  ]
                : []),
            ]
            // Dynamic section: whatever the harness itself reports, minus anything the static
            // menu already owns.
            return [
              ...base,
              ...mergeDynamicCommands(base, dynamicCommands).map((c) => ({
                id: c.name,
                label: c.name,
                hint: c.description ?? 'harness command',
                // Commands whose template reads $ARGUMENTS wait in the composer for them.
                takesArgs: c.takesArgs,
                run: (args?: string) => void session.runCustomCommand(c.name, args ?? ''),
              })),
            ]
          })()}
          extras={
            <>
              <div className="flex items-center rounded-lg border border-border bg-card/60 p-0.5 text-xs" role="group" aria-label="Mode">
                {MODE_COMMANDS.map((m) => {
                  const supported = caps.modes.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!supported}
                      onClick={() => void session.setMode(m.id)}
                      className={
                        'rounded-md px-2 py-0.5 capitalize transition-colors ' +
                        (!supported
                          ? 'cursor-not-allowed text-muted-foreground/40'
                          : session.mode === m.id
                            ? 'bg-secondary text-secondary-foreground'
                            : 'text-muted-foreground hover:text-foreground')
                      }
                      title={supported ? m.title : `${harnessLabel || 'This harness'} doesn't support ${m.label} mode`}
                    >
                      {m.id}
                    </button>
                  )
                })}
              </div>
              <ModelPicker
                value={meta?.model ?? ''}
                provider={meta?.provider ?? 'openrouter'}
                harness={meta?.harness}
                direction="up"
                onChange={(id) => void session.setModel(id)}
              />
              {caps.subagents && (
                <Button
                  variant={subagentsOpen ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  aria-label="Sub-agents"
                  onClick={() => setSubagentsOpen((v) => !v)}
                >
                  <Layers className="size-4" />
                </Button>
              )}
            </>
          }
          agents={caps.subagents ? session.agents : []}
          bangShell={caps.bangShell}
          onSend={(text, pasted, attachments, agent) => {
            // '!ls -la' runs straight through the harness shell endpoint: no model turn, no cost.
            const bang = parseBangCommand(text, caps.bangShell)
            if (bang) return void session.runShell(bang.command)
            // '/mycommand foo bar' keeps its arguments: the harness expands $ARGUMENTS itself.
            const slash = parseSlashInvocation(withPasted(text, pasted), routableCommands)
            if (slash) {
              if (slash.name === BANG_HELP.id) {
                if (slash.args) void session.runShell(slash.args)
                return
              }
              return void session.runCustomCommand(slash.name, slash.args)
            }
            void (
              session.send as (
                text: string,
                attachments?: { key: string; name: string; size: number; mime?: string }[],
                agent?: string,
              ) => Promise<void>
            )(withPasted(text, pasted), attachmentsToWire(attachments), agent)
          }}
          busy={busy}
          onSteer={(text, pasted, attachments) =>
            // Native mid-turn steering where the harness supports it (pi); the server falls
            // back to stop + re-prompt everywhere else.
            void (
              session.steer as (
                text: string,
                attachments?: { key: string; name: string; size: number; mime?: string }[],
              ) => Promise<void>
            )(withPasted(text, pasted), attachmentsToWire(attachments))
          }
          sessionName={meta?.name ?? 'session'}
        />
        {caps.subagents && (
          <div className="pointer-events-none absolute inset-x-0 bottom-full">
            <div className="pointer-events-auto relative mx-auto w-full max-w-3xl px-4">
              <SubagentsPanel turns={session.turns} open={subagentsOpen} onClose={() => setSubagentsOpen(false)} />
            </div>
          </div>
        )}
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

