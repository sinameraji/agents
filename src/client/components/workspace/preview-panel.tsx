'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ExternalLink, Globe, LoaderCircle, Maximize2, Minimize2, MonitorPlay, Play, RefreshCw } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SessionApi } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'

export function PreviewPanel({
  session,
  requested,
}: {
  session: SessionApi
  requested?: { port: number; nonce: number } | null
}) {
  const [port, setPort] = useState(3000)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [started, setStarted] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const [full, setFull] = useState(false)

  // Fullscreen closes on Escape.
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  // A detected dev server chip was clicked: prefill the port and start immediately.
  const handledNonce = useRef(0)
  useEffect(() => {
    if (!requested || requested.nonce === handledNonce.current) return
    handledNonce.current = requested.nonce
    setPort(requested.port)
    void start(requested.port)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])

  async function start(p: number) {
    if (!Number.isFinite(p) || p < 1 || p > 65535) return
    setLoading(true)
    setFailed(false)
    setStarted(true)
    setUrl(null)
    try {
      const result = await session.exposePort(p, window.location.host)
      if (result) {
        setUrl(result)
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleStart(e: FormEvent) {
    e.preventDefault()
    return start(port)
  }


  return (
    <div className={cn('flex flex-col gap-3 p-4', full ? 'fixed inset-0 z-50 bg-background' : 'h-full')}>
      <form onSubmit={handleStart} className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 rounded-md border border-border bg-card pl-2.5 text-xs text-muted-foreground focus-within:border-ring">
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            className="w-16 bg-transparent py-1.5 pr-2.5 font-mono text-sm text-foreground outline-none"
          />
        </label>
        <Button type="submit" size="sm" className="gap-1.5" disabled={loading}>
          {loading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {loading ? 'Starting…' : 'Start preview'}
        </Button>
      </form>

      {url ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1">
            <Globe className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={url}>
              {url}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setFrameKey((k) => k + 1)}
              aria-label="Refresh preview"
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setFull((v) => !v)}
              aria-label={full ? 'Exit full screen' : 'Full screen'}
              title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            >
              {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noopener"
              aria-label="Open in new tab"
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
          <iframe
            key={frameKey}
            src={url}
            title="Preview"
            className="w-full flex-1 rounded-md border border-border bg-white"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/40 p-6 text-center">
          <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
            {loading ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <MonitorPlay className="size-5" />
            )}
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Starting preview on port {port}…</p>
          ) : started && failed ? (
            <>
              <p className="text-sm font-medium text-foreground">Preview needs the custom domain</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Sandbox preview URLs require *.dreamweav.com (wildcard DNS), which isn't wired yet.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">No preview running</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Enter the port your dev server listens on, then start the preview.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
