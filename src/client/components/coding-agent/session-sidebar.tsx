'use client'

import { GitBranch, Plus, Settings, Terminal } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatCost } from '~shared/format'
import type { SessionSummary } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { StatusDot, statusLabel } from './status-dot'
import { ThemeToggle } from './theme-toggle'

export function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onOpenSettings,
  email,
}: {
  sessions: SessionSummary[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onOpenSettings: () => void
  email: string
}) {
  const initials = email.slice(0, 2).toUpperCase()
  const handle = email.split('@')[0]
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Terminal className="size-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Dreamweav</span>
          <span className="text-[0.7rem] text-muted-foreground">coding agents in your browser</span>
        </div>
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

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {sessions.map((session) => {
          const active = session.id === activeId
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session.id)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'group relative flex w-full flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                active
                  ? 'border-primary/40 bg-sidebar-accent'
                  : 'border-transparent hover:border-border hover:bg-sidebar-accent/50',
              )}
            >
              {active && (
                <span className="absolute top-2 bottom-2 -left-px w-0.5 rounded-full bg-primary" />
              )}
              <div className="flex items-center gap-2">
                <StatusDot status={session.status} />
                <span className="truncate text-sm font-medium text-sidebar-foreground">
                  {session.name}
                </span>
                {session.unread && !active && (
                  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />
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
            </button>
          )
        })}
      </nav>

      <footer className="flex items-center gap-1 border-t border-sidebar-border px-3 py-2.5">
        <div className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
          {initials}
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs font-medium">{handle}</span>
          <span className="truncate text-[0.65rem] text-muted-foreground">{email}</span>
        </div>
        <div className="ml-auto flex items-center">
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Open settings">
            <Settings className="size-4" />
          </Button>
        </div>
      </footer>
    </div>
  )
}
