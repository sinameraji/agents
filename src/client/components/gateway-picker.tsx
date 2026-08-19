'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { Button } from '@/components/ui/button'

/**
 * Pick-or-create an AI Gateway on the user's Cloudflare account. It's their account: they choose
 * which existing gateway Dreamweav uses, or create a new one with a name of their choosing
 * (pre-filled "dreamweav").
 */
export function GatewayPicker({ ua, compact }: { ua: UserAgentApi; compact?: boolean }) {
  const [gateways, setGateways] = useState<string[] | null>(null)
  const [loadNote, setLoadNote] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('dreamweav')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void ua
      .listAiGateways()
      .then((r) => {
        if (!alive) return
        setGateways(r.ok ? r.gateways : [])
        if (!r.ok && r.note) setLoadNote(r.note)
      })
      .catch(() => alive && setGateways([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const attach = async (id: string) => {
    setBusy(true)
    setNote(null)
    try {
      await ua.saveSettings({ connections: { cloudflareGatewayId: id } })
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    setNote(null)
    try {
      const r = await ua.createAiGateway(name)
      if (!r.ok) setNote(r.note ?? 'Could not create the gateway.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3', compact && 'p-2.5')}>
      <p className="text-xs font-medium text-foreground/90">Choose an AI Gateway</p>
      {gateways === null ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading your gateways…
        </p>
      ) : (
        <>
          {gateways.length > 0 && (
            <div className="flex flex-col gap-1">
              {gateways.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSelected(g)}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left font-mono text-xs transition-colors',
                    selected === g ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted',
                  )}
                >
                  {g}
                  {selected === g && <Check className="size-3.5 text-primary" />}
                </button>
              ))}
              <Button
                type="button"
                size="sm"
                disabled={!selected || busy}
                onClick={() => selected && void attach(selected)}
                className="gap-1.5 self-start"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                Use selected
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {gateways.length > 0 && <span className="text-[11px] text-muted-foreground">or create a new one</span>}
            {gateways.length === 0 && (
              <span className="text-[11px] text-muted-foreground">
                {loadNote ?? 'No gateways in your account yet — create one:'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="New gateway name"
              placeholder="dreamweav"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <Button type="button" variant="outline" size="sm" disabled={busy || !name.trim()} onClick={() => void create()} className="h-9 shrink-0 gap-1.5">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Create
            </Button>
          </div>
          {note && <p className="text-xs text-destructive">{note}</p>}
        </>
      )}
    </div>
  )
}
