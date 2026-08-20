'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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
import { DiffView } from '../transcript/diff-view'

type ChangeStatus = 'M' | 'A' | 'D' | 'R' | '?'
interface ChangeInfo {
  /** File path → its git status vs HEAD. */
  files: Map<string, ChangeStatus>
  /** Folder paths that contain at least one change (for parent-folder dots). */
  dirs: Set<string>
}
const ChangesContext = createContext<ChangeInfo>({ files: new Map(), dirs: new Set() })

/** Small M/A/D/? badge with a green/amber/red tint, matching git conventions. */
function ChangeBadge({ status }: { status: ChangeStatus }) {
  const tone =
    status === 'D' ? 'text-destructive' : status === 'M' ? 'text-amber-500' : 'text-success'
  const label = status === '?' ? 'U' : status
  return <span className={cn('shrink-0 font-mono text-[0.7rem] font-semibold', tone)} title={statusLabel(status)}>{label}</span>
}
function statusLabel(s: ChangeStatus): string {
  return s === 'M' ? 'Modified' : s === 'A' ? 'Added' : s === 'D' ? 'Deleted' : s === 'R' ? 'Renamed' : 'Untracked (new)'
}

const ROOT = '/workspace'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

// Cache directory listings so collapsing/re-expanding a folder is instant, and the app's ~1.2s
// status poll (which hands down a new `session` object each render) never re-triggers a sandbox
// `exec`. Keyed by SESSION + path — two sessions share the /workspace path but not their files.
const dirCache = new Map<string, FileEntry[]>()
const cacheKey = (sid: string, path: string) => `${sid}::${path}`

export function FilesPanel({ session }: { session: SessionApi }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const sessionId = session.meta?.id ?? ''
  const status = session.status
  const [changes, setChanges] = useState<ChangeInfo>({ files: new Map(), dirs: new Set() })

  // Load per-file change status. Refetch when the agent finishes a turn (status → idle), on
  // refresh, and when switching sessions — so "what changed" tracks the agent's edits live.
  const gitChanges = session.gitChanges
  useEffect(() => {
    let alive = true
    gitChanges()
      .then((r) => {
        if (!alive) return
        const files = new Map(r.changes.map((c) => [c.path, c.status] as const))
        const dirs = new Set<string>()
        for (const c of r.changes) {
          let p = c.path
          while (p.length > ROOT.length && p.lastIndexOf('/') > 0) {
            p = p.slice(0, p.lastIndexOf('/'))
            if (p.length >= ROOT.length) dirs.add(p)
            else break
          }
        }
        setChanges({ files, dirs })
      })
      .catch(() => alive && setChanges({ files: new Map(), dirs: new Set() }))
    return () => {
      alive = false
    }
  }, [gitChanges, sessionId, refreshKey, status])

  if (openPath) {
    return (
      <ChangesContext.Provider value={changes}>
        <FileViewer session={session} path={openPath} onBack={() => setOpenPath(null)} />
      </ChangesContext.Provider>
    )
  }

  return (
    <ChangesContext.Provider value={changes}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="truncate font-mono text-xs text-muted-foreground">{ROOT}</span>
          <div className="flex items-center gap-2">
            {changes.files.size > 0 && (
              <span className="font-mono text-[0.7rem] text-muted-foreground">{changes.files.size} changed</span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                dirCache.clear()
                setRefreshKey((k) => k + 1)
              }}
              aria-label="Refresh files"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          <DirListing key={`${sessionId}:${refreshKey}`} sid={sessionId} session={session} path={ROOT} depth={0} onOpenFile={setOpenPath} />
        </div>
      </div>
    </ChangesContext.Provider>
  )
}

function DirListing({
  sid,
  session,
  path,
  depth,
  onOpenFile,
}: {
  sid: string
  session: SessionApi
  path: string
  depth: number
  onOpenFile: (p: string) => void
}) {
  // listFiles is a stable useCallback in useSession, so keying the effect on it (not the whole
  // `session` object) means poll-driven re-renders don't refetch. Seed from cache for no flash.
  const listFiles = session.listFiles
  const key = cacheKey(sid, path)
  const [entries, setEntries] = useState<FileEntry[] | null>(() => dirCache.get(key) ?? null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const cached = dirCache.get(key)
    if (cached) {
      setEntries(cached)
      return
    }
    let alive = true
    setEntries(null)
    setError(false)
    listFiles(path)
      .then((files) => {
        if (!alive) return
        const sorted = sortEntries(files)
        dirCache.set(key, sorted)
        setEntries(sorted)
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [listFiles, key, path])

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
            sid={sid}
            session={session}
            entry={entry}
            depth={depth}
            onOpenFile={onOpenFile}
          />
        ) : (
          <FileRow key={entry.path} entry={entry} depth={depth} onOpen={() => onOpenFile(entry.path)} />
        ),
      )}
    </ul>
  )
}

function FileRow({ entry, depth, onOpen }: { entry: FileEntry; depth: number; onOpen: () => void }) {
  const changes = useContext(ChangesContext)
  const status = changes.files.get(entry.path)
  return (
    <li>
      <RowButton depth={depth} onClick={onOpen}>
        <span className="size-3.5 shrink-0" />
        <File className={cn('size-4 shrink-0 text-muted-foreground', status && 'text-foreground/80')} />
        <span className={cn('min-w-0 flex-1 truncate', status && 'font-medium')}>{entry.name}</span>
        {status ? (
          <ChangeBadge status={status} />
        ) : (
          <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground/70">{formatSize(entry.size)}</span>
        )}
      </RowButton>
    </li>
  )
}

function DirNode({
  sid,
  session,
  entry,
  depth,
  onOpenFile,
}: {
  sid: string
  session: SessionApi
  entry: FileEntry
  depth: number
  onOpenFile: (p: string) => void
}) {
  const [open, setOpen] = useState(false)
  const changes = useContext(ChangesContext)
  const hasChanges = changes.dirs.has(entry.path)
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
        {hasChanges && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Contains changes" />}
      </RowButton>
      {open && (
        <DirListing sid={sid} session={session} path={entry.path} depth={depth + 1} onOpenFile={onOpenFile} />
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
  const changes = useContext(ChangesContext)
  const status = changes.files.get(path)
  const isChanged = !!status && status !== 'D'
  // Changed files open on their diff by default (that's what the user came to see); toggle to raw.
  const [mode, setMode] = useState<'diff' | 'file'>(isChanged ? 'diff' : 'file')
  const [content, setContent] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    const load =
      mode === 'diff'
        ? session.gitDiff(path).then((r) => setDiff(r.diff))
        : session.readFile(path).then((text) => {
            if (text === null) setError(true)
            else setContent(text)
          })
    load
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [session, path, mode])

  const name = path.split('/').filter(Boolean).pop() ?? path

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to files">
          <ArrowLeft className="size-3.5" />
        </Button>
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={path}>
          {name}
        </span>
        {status && <ChangeBadge status={status} />}
        {isChanged && (
          <div className="flex shrink-0 items-center rounded-md bg-muted p-0.5 text-[0.7rem]">
            <button
              type="button"
              onClick={() => setMode('diff')}
              className={cn('rounded px-1.5 py-0.5', mode === 'diff' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}
            >
              Diff
            </button>
            <button
              type="button"
              onClick={() => setMode('file')}
              className={cn('rounded px-1.5 py-0.5', mode === 'file' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}
            >
              File
            </button>
          </div>
        )}
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
        ) : mode === 'diff' ? (
          diff && diff.trim() ? (
            <DiffView diff={diff} maxHeight={600} />
          ) : (
            <div className="text-xs text-muted-foreground">No diff vs the last commit.</div>
          )
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
