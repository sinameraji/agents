'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  File,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SessionApi } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '../transcript/code-block'

const ROOT = '/workspace'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

export function FilesPanel({ session }: { session: SessionApi }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [openPath, setOpenPath] = useState<string | null>(null)

  if (openPath) {
    return <FileViewer session={session} path={openPath} onBack={() => setOpenPath(null)} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{ROOT}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setRefreshKey((k) => k + 1)}
          aria-label="Refresh files"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        <DirListing key={refreshKey} session={session} path={ROOT} depth={0} onOpenFile={setOpenPath} />
      </div>
    </div>
  )
}

function DirListing({
  session,
  path,
  depth,
  onOpenFile,
}: {
  session: SessionApi
  path: string
  depth: number
  onOpenFile: (p: string) => void
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setEntries(null)
    setError(false)
    session
      .listFiles(path)
      .then((files) => {
        if (alive) setEntries(sortEntries(files))
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [session, path])

  if (error) {
    return (
      <InfoRow depth={depth} tone="error">
        <AlertCircle className="size-3.5" /> Could not read this folder.
      </InfoRow>
    )
  }
  if (entries === null) {
    return (
      <InfoRow depth={depth}>
        <LoaderCircle className="size-3.5 animate-spin" /> Loading…
      </InfoRow>
    )
  }
  if (entries.length === 0) {
    return <InfoRow depth={depth}>Empty folder</InfoRow>
  }

  return (
    <ul>
      {entries.map((entry) =>
        entry.isDirectory ? (
          <DirNode
            key={entry.path}
            session={session}
            entry={entry}
            depth={depth}
            onOpenFile={onOpenFile}
          />
        ) : (
          <li key={entry.path}>
            <RowButton depth={depth} onClick={() => onOpenFile(entry.path)}>
              <span className="size-3.5 shrink-0" />
              <File className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground/70">
                {formatSize(entry.size)}
              </span>
            </RowButton>
          </li>
        ),
      )}
    </ul>
  )
}

function DirNode({
  session,
  entry,
  depth,
  onOpenFile,
}: {
  session: SessionApi
  entry: FileEntry
  depth: number
  onOpenFile: (p: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <RowButton depth={depth} onClick={() => setOpen((o) => !o)}>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        {open ? (
          <FolderOpen className="size-4 shrink-0 text-primary" />
        ) : (
          <Folder className="size-4 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </RowButton>
      {open && (
        <DirListing session={session} path={entry.path} depth={depth + 1} onOpenFile={onOpenFile} />
      )}
    </li>
  )
}

function RowButton({
  depth,
  onClick,
  children,
}: {
  depth: number
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm text-foreground/90 transition-colors hover:bg-muted"
      style={{ paddingLeft: depth * 14 + 6 }}
    >
      {children}
    </button>
  )
}

function InfoRow({
  depth,
  tone,
  children,
}: {
  depth: number
  tone?: 'error' | 'muted'
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 py-1 text-xs',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
      style={{ paddingLeft: depth * 14 + 26 }}
    >
      {children}
    </div>
  )
}

function FileViewer({
  session,
  path,
  onBack,
}: {
  session: SessionApi
  path: string
  onBack: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    setContent(null)
    session
      .readFile(path)
      .then((text) => {
        if (!alive) return
        if (text === null) setError(true)
        else setContent(text)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setError(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [session, path])

  const name = path.split('/').filter(Boolean).pop() ?? path

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to files">
          <ArrowLeft className="size-3.5" />
        </Button>
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-foreground" title={path}>
          {name}
        </span>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="size-3.5" /> This file could not be read.
          </div>
        ) : content === '' ? (
          <div className="text-xs text-muted-foreground">This file is empty.</div>
        ) : (
          <CodeBlock code={content ?? ''} lang={langFromExt(path)} maxHeight={600} />
        )}
      </div>
    </div>
  )
}

function sortEntries(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function langFromExt(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    py: 'python',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    go: 'go',
    rs: 'rust',
    sh: 'bash',
  }
  return map[ext] ?? 'text'
}
