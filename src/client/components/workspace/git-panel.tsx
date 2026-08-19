'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, GitBranch, GitPullRequest, Loader2, RefreshCw, Upload } from 'lucide-react'

import type { SessionApi } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'

interface GitInfo {
  repo: boolean
  branch: string
  dirty: number
  remote: string | null
  lastCommit: string | null
}

/** Git export: commit + push the workspace to the user's GitHub, open a PR, or download a tarball. */
export function GitPanel({ session }: { session: SessionApi }) {
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [openPr, setOpenPr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; note: string; branchUrl?: string; prUrl?: string } | null>(null)

  // useSession returns a fresh object every render — key the fetch on the session ID, and read the
  // latest API through a ref, or this panel refetches (sandbox exec!) on every parent render.
  const sessionRef = useRef(session)
  sessionRef.current = session
  const refresh = useCallback(() => {
    setLoading(true)
    void sessionRef.current
      .gitStatus()
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false))
  }, [])

  const sessionId = session.meta?.id
  useEffect(() => {
    if (sessionId) refresh()
  }, [sessionId, refresh])

  const doExport = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await session.gitExport({ message: message.trim() || undefined, openPr })
      setResult(r)
      if (r.ok) refresh()
    } catch (e) {
      setResult({ ok: false, note: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scrollbar-thin flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Git export</h3>
        <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label="Refresh git status">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-3 text-xs">
        {info === null ? (
          <p className="text-muted-foreground">{loading ? 'Reading workspace…' : 'Could not read the workspace.'}</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">Repository</dt>
            <dd>{info.repo ? 'initialized' : 'not initialized — the first push sets it up'}</dd>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="flex items-center gap-1 font-mono">
              <GitBranch className="size-3" />
              {info.branch || session.meta?.branch || '—'}
            </dd>
            <dt className="text-muted-foreground">Uncommitted</dt>
            <dd>{info.dirty} file(s)</dd>
            {info.remote && (
              <>
                <dt className="text-muted-foreground">Remote</dt>
                <dd className="truncate font-mono" title={info.remote}>
                  {info.remote.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
                </dd>
              </>
            )}
            {info.lastCommit && (
              <>
                <dt className="text-muted-foreground">Last commit</dt>
                <dd className="truncate" title={info.lastCommit}>
                  {info.lastCommit}
                </dd>
              </>
            )}
          </dl>
        )}
      </div>

      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        Commit message
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Dreamweav: ${session.meta?.name ?? 'session export'}`}
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} className="accent-primary" />
        Open a pull request (sessions cloned from GitHub)
      </label>

      <div className="flex items-center gap-2">
        <Button size="sm" className="gap-1.5" onClick={() => void doExport()} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          Commit &amp; push
        </Button>
        {sessionId && (
          <a
            href={`/api/sessions/${sessionId}/export`}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Download className="size-3.5" />
            Download .tgz
          </a>
        )}
      </div>

      {result && (
        <div
          className={
            'rounded-lg border p-3 text-xs ' +
            (result.ok ? 'border-border bg-card/60 text-foreground/90' : 'border-destructive/40 bg-destructive/5 text-destructive')
          }
        >
          <p className="whitespace-pre-wrap break-words">{result.note}</p>
          <div className="mt-1.5 flex flex-col gap-1">
            {result.branchUrl && (
              <a href={result.branchUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="size-3" /> View branch
              </a>
            )}
            {result.prUrl && (
              <a href={result.prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                <GitPullRequest className="size-3" /> View pull request
              </a>
            )}
          </div>
        </div>
      )}

      <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
        Pushes use your GitHub token from Settings. Blank sessions get a new private repo
        (dreamweav-…) under your account; GitHub-sourced sessions push a branch to the source repo.
      </p>
    </div>
  )
}
