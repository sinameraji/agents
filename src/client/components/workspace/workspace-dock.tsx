'use client'

import { useState, type ReactNode } from 'react'
import { Eye, Files, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SessionApi } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'
import { PreviewPanel } from './preview-panel'
import { FilesPanel } from './files-panel'

type Tab = 'preview' | 'files'

export function WorkspaceDock({ session, onClose }: { session: SessionApi; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('files')

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <h2 className="text-sm font-semibold">Workspace</h2>
        <div className="ml-1 flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
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
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onClose}
          aria-label="Close workspace"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {tab === 'preview' ? <PreviewPanel session={session} /> : <FilesPanel session={session} />}
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
