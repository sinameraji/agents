'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Harness, ModelInfo, Provider } from '~shared/protocol'

const PAGE = 40

// Cache per (provider, harness) so reopening is instant and KimiFlare's filtered list is distinct.
const cache = new Map<string, ModelInfo[]>()
// In-flight fetches per key, so the picker opening while the cost chip is loading (or two chips)
// share one request instead of racing.
const inflight = new Map<string, Promise<ModelInfo[]>>()

/** Catalog key + query string for a (provider, harness) pair: KimiFlare serves a fixed set
 *  regardless of provider, everything else is keyed by provider. */
function catalogKey(provider: Provider, harness: Harness | undefined) {
  return harness === 'kimiflare'
    ? { key: 'kimiflare', query: `provider=${provider}&harness=kimiflare` }
    : { key: provider as string, query: `provider=${provider}` }
}

/** Fetch a provider's catalog once per page load. Failures resolve to [] and are NOT cached, so
 *  the next caller retries. */
function loadCatalog(key: string, query: string): Promise<ModelInfo[]> {
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(key)
  if (running) return running
  const p = fetch(`/api/models?${query}`)
    .then((r) => r.json())
    .then((d: { models?: ModelInfo[] }) => {
      const list = d.models ?? []
      cache.set(key, list)
      return list
    })
    .catch(() => [] as ModelInfo[])
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** The already-fetched catalog entry for a model id: the synchronous seed for useModelInfo, so a
 *  remount with a warm cache renders the price on the first paint instead of a frame later. */
function cachedModelInfo(provider: Provider, harness: Harness | undefined, id: string): ModelInfo | undefined {
  return cache.get(catalogKey(provider, harness).key)?.find((m) => m.id === id)
}

/** Live catalog entry for the session's current model (pricing, vision), fetching the catalog if
 *  no picker has opened yet. Shares the picker's cache, so opening the picker stays instant. */
export function useModelInfo(provider: Provider, harness: Harness | undefined, id: string): ModelInfo | undefined {
  const { key, query } = catalogKey(provider, harness)
  const [info, setInfo] = useState<ModelInfo | undefined>(() => cachedModelInfo(provider, harness, id))
  useEffect(() => {
    if (!id) {
      setInfo(undefined)
      return
    }
    let alive = true
    void loadCatalog(key, query).then((list) => {
      if (alive) setInfo(list.find((m) => m.id === id))
    })
    return () => {
      alive = false
    }
  }, [key, query, id])
  return info
}

export function ModelPicker({
  value,
  provider,
  harness,
  onChange,
  direction = 'down',
}: {
  value: string
  provider: Provider
  harness?: Harness
  onChange: (id: string) => void
  direction?: 'up' | 'down'
}) {
  const { key, query: query$ } = catalogKey(provider, harness)
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>(() => cache.get(key) ?? [])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const current = models.find((m) => m.id === value)
  const currentLabel = current?.label ?? value ?? 'Select model'

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Load-on-open (lazy): fetch the provider's catalog the first time the menu opens.
  useEffect(() => {
    if (!open || cache.has(key)) {
      if (cache.has(key)) setModels(cache.get(key)!)
      return
    }
    setLoading(true)
    void loadCatalog(key, query$)
      .then(setModels)
      .finally(() => setLoading(false))
  }, [open, key, query$])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
  }, [models, query])

  const visible = filtered.slice(0, limit)

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setLimit((n) => (n < filtered.length ? n + PAGE : n))
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] hover:bg-muted"
      >
        <span className="hidden max-w-40 truncate sm:inline">{currentLabel}</span>
        <span className="sm:hidden">{currentLabel.split(/[\/\s]/)[0]}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className={"absolute right-0 z-30 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-xl " + (direction === "up" ? "bottom-full mb-1.5" : "mt-1.5")}>
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setLimit(PAGE)
              }}
              placeholder={`Search ${provider} models…`}
              className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div ref={listRef} onScroll={onScroll} className="scrollbar-thin max-h-80 overflow-y-auto p-1">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading models…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                {models.length === 0 ? 'No live catalog for this provider yet.' : 'No matches.'}
              </div>
            )}
            {visible.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                  m.id === value && 'bg-muted',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{m.label}</span>
                  <span className="truncate font-mono text-[0.65rem] text-muted-foreground">{m.id}</span>
                </div>
                {(m.inputPerM > 0 || m.outputPerM > 0) && (
                  <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                    ${m.inputPerM.toFixed(2)}/${m.outputPerM.toFixed(2)}
                  </span>
                )}
              </button>
            ))}
            {!loading && visible.length < filtered.length && (
              <div className="px-2 py-1.5 text-center text-[0.7rem] text-muted-foreground">
                {filtered.length - visible.length} more, scroll to load
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
