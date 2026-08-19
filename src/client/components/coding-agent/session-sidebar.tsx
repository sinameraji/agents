'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, GitBranch, Info, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatCost } from '~shared/format'
import type { SessionSummary } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { CloudflareMark } from '../login-screen'
import { StatusDot, statusLabel } from './status-dot'
import { ThemeToggle } from './theme-toggle'

export function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onOpenSettings,
  onDelete,
  onRename,
  email,
  guest,
  deploy,
  onSignIn,
  collapsed,
  onToggleCollapse,
}: {
  sessions: SessionSummary[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onOpenSettings: () => void
  guest?: boolean
  deploy?: boolean
  onSignIn?: () => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  email: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const initials = email.slice(0, 2).toUpperCase()
  const handle = email.split('@')[0]
  const [aboutOpen, setAboutOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q
    ? sessions.filter((s) =>
        [s.name, s.repo, s.branch, s.model].some((v) => v?.toLowerCase().includes(q)),
      )
    : sessions

  if (collapsed) {
    return (
      <div className="flex h-full w-full flex-col items-center gap-1 bg-sidebar py-3 text-sidebar-foreground">
        <img src="/icon-192.png" alt="" aria-hidden className="size-8 shrink-0" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="mt-1"
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftOpen className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New session" title="New session">
          <Plus className="size-4" />
        </Button>
        <div className="mt-auto">
          <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Open settings" title="Settings">
            <Settings className="size-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <img src="/icon-192.png" alt="" aria-hidden className="size-8 shrink-0" />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Dreamweav</span>
          <span className="text-[0.7rem] text-muted-foreground">coding agents in your browser</span>
        </div>
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto shrink-0 max-md:hidden"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </header>

      <div className="px-3 pb-2">
        <Button className="w-full justify-start gap-2" size="default" onClick={onNew}>
          <Plus className="size-4" />
          New session
        </Button>
      </div>

      <div className="px-3 pt-1 pb-1.5">
        <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          Sessions
        </span>
      </div>

      {sessions.length > 0 && (
        <div className="px-3 pb-1.5">
          <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 focus-within:border-ring">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              aria-label="Search sessions"
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </label>
        </div>
      )}

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {filtered.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            active={session.id === activeId}
            onSelect={() => onSelect(session.id)}
            onDelete={() => onDelete(session.id)}
            onRename={(name) => onRename(session.id, name)}
          />
        ))}
        {q && filtered.length === 0 && (
          <p className="px-2 pt-2 text-xs text-muted-foreground">No sessions match.</p>
        )}
      </nav>

      <footer className="flex items-center gap-1 border-t border-sidebar-border px-3 py-2.5">
        {guest ? (
          deploy ? (
            <button
              type="button"
              onClick={onSignIn}
              className="flex h-9 min-w-0 items-center justify-center gap-2 rounded-lg bg-[#F6821F] px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#e2760f]"
            >
              <CloudflareMark fill="#fff" className="size-4 shrink-0" />
              <span className="truncate">Deploy to Cloudflare</span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <Button size="sm" onClick={onSignIn}>
                Sign in
              </Button>
              <a
                href="https://github.com/sinameraji/dreamweav#deploy-your-own"
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                title="Dreamweav is self-hosted: run it on your own Cloudflare account"
              >
                Deploy your own
              </a>
            </div>
          )
        ) : (
          <>
            <div className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
              {initials}
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs font-medium">{handle}</span>
            </div>
          </>
        )}
        <div className="ml-auto flex items-center">
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Open settings" title="Settings, keys & connections">
            <Settings className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="About Dreamweav"
            title="About Dreamweav"
            onClick={() => setAboutOpen(true)}
          >
            <Info className="size-4" />
          </Button>
          {!guest && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => {
                void fetch('/api/logout', { method: 'POST' }).finally(() => window.location.assign('/'))
              }}
            >
              <LogOut className="size-4" />
            </Button>
          )}
        </div>
      </footer>

      {aboutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="About Dreamweav">
          <button type="button" aria-label="Close" onClick={() => setAboutOpen(false)} className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm" />
          <div className="relative flex w-full max-w-sm flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-center gap-2.5">
              <img src="/icon-192.png" alt="" aria-hidden className="size-9" />
              <div>
                <h2 className="text-sm font-semibold">Dreamweav</h2>
                <p className="text-xs text-muted-foreground">Coding agents in your browser.</p>
              </div>
            </div>
            <p className="text-sm text-foreground/90">
              Built by{' '}
              <a href="https://github.com/sinameraji" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Sina Meraji
              </a>
              . Open source:
            </p>
            <a
              href="https://github.com/sinameraji/dreamweav"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground/90 transition-colors hover:bg-muted"
            >
              github.com/sinameraji/dreamweav <ExternalLink className="size-3" />
            </a>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Runs entirely on Cloudflare (Workers, Durable Objects, Sandboxes, R2). Harnesses by their
              authors: OpenCode (Anomaly), pi (Mario Zechner), KimiFlare (Sina Meraji), AI SDK (Vercel),
              Agents SDK (Cloudflare). Your keys stay encrypted in your account.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  session: SessionSummary
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (name: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameDone = useRef(false)

  // Close the menu (and reset delete confirmation) on any outside mousedown —
  // same pattern as ModelPicker.
  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menuOpen])

  const startRename = () => {
    renameDone.current = false
    setMenuOpen(false)
    setConfirmDelete(false)
    setRenaming(true)
  }

  const finishRename = (commit: boolean, raw: string) => {
    if (renameDone.current) return
    renameDone.current = true
    setRenaming(false)
    if (!commit) return
    const name = raw.trim()
    if (name && name !== session.name) onRename(name)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (!renaming) onSelect()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group relative flex w-full flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
        active
          ? 'border-primary/40 bg-sidebar-accent'
          : 'border-transparent hover:border-border hover:bg-sidebar-accent/50',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 -left-px w-0.5 rounded-full bg-primary" />}
      <div className="flex items-center gap-2">
        <StatusDot status={session.status} />
        {renaming ? (
          <input
            autoFocus
            defaultValue={session.name}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') finishRename(true, e.currentTarget.value)
              else if (e.key === 'Escape') finishRename(false, '')
            }}
            onBlur={(e) => finishRename(true, e.currentTarget.value)}
            aria-label="Session name"
            className="h-5 w-full min-w-0 flex-1 rounded border border-border bg-background px-1 text-sm font-medium text-foreground outline-none focus:border-ring"
          />
        ) : (
          <span className="truncate text-sm font-medium text-sidebar-foreground">
            {session.name}
          </span>
        )}
        {session.unread && !active && !renaming && (
          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary transition-opacity group-hover:opacity-0" />
        )}
      </div>
      <div className="flex items-center gap-1.5 pl-4.5 text-xs text-muted-foreground">
        <GitBranch className="size-3 shrink-0" />
        <span className="truncate font-mono">{session.branch}</span>
      </div>
      <div className="flex items-center gap-2 pl-4.5 text-[0.7rem] text-muted-foreground">
        <span>{statusLabel(session.status)}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{session.lastActivity}</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="font-mono">{formatCost(session.costUsd)}</span>
        <span className="ml-auto rounded bg-muted px-1 py-0.5 font-mono text-[0.65rem] tracking-wide text-muted-foreground uppercase">
          {session.region}
        </span>
      </div>

      {!renaming && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 z-10"
        >
          <button
            type="button"
            aria-label={`Actions for ${session.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((v) => !v)
              setConfirmDelete(false)
            }}
            className={cn(
              'grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100',
              menuOpen && 'bg-muted text-foreground opacity-100',
            )}
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-36 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={startRename}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Pencil className="size-3.5 text-muted-foreground" />
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true)
                    return
                  }
                  setMenuOpen(false)
                  setConfirmDelete(false)
                  onDelete()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive',
                  confirmDelete ? 'bg-destructive/10 hover:bg-destructive/20' : 'hover:bg-muted',
                )}
              >
                <Trash2 className="size-3.5" />
                {confirmDelete ? 'Confirm delete?' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
