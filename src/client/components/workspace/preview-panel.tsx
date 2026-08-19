'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
  const [failReason, setFailReason] = useState<'nothing-listening' | 'expose-failed' | 'reserved-port' | 'needs-domain' | null>(null)

  // Ports the session has surfaced (agent-declared or detected) — but only ones that answer
  // RIGHT NOW get a chip. History is not a menu; a dead server's chip is just a future error.
  const knownPorts = useMemo(
    () => [
      ...new Set(
        session.turns.flatMap((t) =>
          t.parts.filter((p): p is Extract<(typeof t.parts)[number], { kind: 'preview' }> => p.kind === 'preview').map((p) => p.port),
        ),
      ),
    ].filter((p) => p !== 3000),
    [session.turns],
  )
  const [livePorts, setLivePorts] = useState<number[] | null>(null)
  useEffect(() => {
    if (!knownPorts.length) {
      setLivePorts([])
      return
    }
    let alivePoll = true
    void session
      .checkPorts(knownPorts)
      .then((r) => alivePoll && setLivePorts(r.alive))
      .catch(() => alivePoll && setLivePorts([]))
    return () => {
      alivePoll = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownPorts.join(',')])
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
    setFailReason(null)
    setStarted(true)
    setUrl(null)
    try {
      const result = await session.exposePort(p, window.location.host)
      if (result.url) {
        setUrl(result.url)
      } else {
        setFailed(true)
        setFailReason(result.reason ?? 'expose-failed')
      }
    } catch {
      setFailed(true)
      setFailReason('expose-failed')
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

      {(livePorts?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Running:</span>
          {(livePorts ?? []).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPort(p)
                void start(p)
              }}
              className={
                p === port && url
                  ? 'rounded-md border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary'
                  : 'rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              }
            >
              :{p}
            </button>
          ))}
        </div>
      )}

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
              <p className="text-sm font-medium text-foreground">
                {failReason === 'nothing-listening'
                  ? `Nothing is answering on port ${port}`
                  : failReason === 'reserved-port'
                    ? 'Port 3000 is reserved by the sandbox'
                    : failReason === 'needs-domain'
                      ? 'Live preview needs a custom domain'
                      : 'Could not open a preview URL'}
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                {failReason === 'nothing-listening'
                  ? 'The server may have stopped or crashed. Ask the agent to restart it, then try again.'
                  : failReason === 'reserved-port'
                    ? 'Ask the agent to run the server on another port, like 8080.'
                    : failReason === 'needs-domain'
                      ? 'This instance runs on workers.dev, where previews use slow, unreliable temporary tunnels. Add a domain in Settings → Domain for instant previews.'
                      : 'Something went wrong exposing the port. Try again in a moment.'}
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
