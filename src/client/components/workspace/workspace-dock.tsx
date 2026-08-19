'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Eye, Files, GitBranch, SlidersHorizontal, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SessionApi } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'
import { PreviewPanel } from './preview-panel'
import { FilesPanel } from './files-panel'
import { ConfigPanel } from './config-panel'
import { GitPanel } from './git-panel'

type Tab = 'preview' | 'files' | 'git' | 'config'

export function WorkspaceDock({
  session,
  onClose,
  previewRequest,
}: {
  session: SessionApi
  onClose: () => void
  previewRequest?: { port: number; nonce: number } | null
}) {
  const [tab, setTab] = useState<Tab>('files')
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem('dw:dockWidth'))
    return Number.isFinite(stored) && stored >= 320 ? stored : 420
  })
  const widthRef = useRef(width)
  widthRef.current = width

  useEffect(() => {
    if (previewRequest) setTab('preview')
  }, [previewRequest])

  const clampWidth = (w: number) => Math.min(Math.max(w, 320), Math.max(420, window.innerWidth * 0.7))

  // Pointer capture keeps drag events flowing even when the cursor crosses the preview iframe.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    let last = startW
    const move = (ev: PointerEvent) => {
      last = clampWidth(startW + (startX - ev.clientX))
      setWidth(last)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      // `last`, not state: pointerup lands before React re-renders the ref.
      localStorage.setItem('dw:dockWidth', String(last))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <aside
      style={{ '--dock-w': `${width}px` } as CSSProperties}
      className="relative flex h-full w-full shrink-0 flex-col border-border bg-background lg:w-[var(--dock-w)] lg:border-l"
    >
      <div
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workspace"
        className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize transition-colors hover:bg-primary/25 active:bg-primary/35 lg:block"
      />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-4">
        <h2 className="hidden text-sm font-semibold min-[480px]:block">Workspace</h2>
        <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 sm:ml-1 sm:flex-none">
          <TabButton
            active={tab === 'preview'}
            onClick={() => setTab('preview')}
            icon={<Eye className="size-3.5" />}
            label="Preview"
          />
          <TabButton
            active={tab === 'files'}
            onClick={() => setTab('files')}
            icon={<Files className="size-3.5" />}
            label="Files"
          />
          <TabButton
            active={tab === 'git'}
            onClick={() => setTab('git')}
            icon={<GitBranch className="size-3.5" />}
            label="Git"
          />
          <TabButton
            active={tab === 'config'}
            onClick={() => setTab('config')}
            icon={<SlidersHorizontal className="size-3.5" />}
            label="Config"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          onClick={onClose}
          aria-label="Close workspace"
          title="Close workspace"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {tab === 'preview' && <PreviewPanel session={session} requested={previewRequest} />}
        {tab === 'files' && <FilesPanel session={session} />}
        {tab === 'git' && <GitPanel session={session} />}
        {tab === 'config' && <ConfigPanel session={session} />}
      </div>
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
