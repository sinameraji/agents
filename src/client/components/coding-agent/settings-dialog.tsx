'use client'

import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { GATEWAYS, MODELS } from '@/lib/mock-data'
import { Button } from '@/components/ui/button'

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [gateway, setGateway] = useState('openrouter')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [defaultModel, setDefaultModel] = useState('claude-sonnet-4.5')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const save = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Settings">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <h2 className="text-sm font-medium">Workspace settings</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="scrollbar-thin flex flex-col gap-6 overflow-y-auto px-5 py-5">
          {/* Gateway */}
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">AI gateway</label>
            <p className="text-xs text-muted-foreground">
              Route requests through your provider of choice. Your key is used to run every session.
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {GATEWAYS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGateway(g.id)}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    gateway === g.id
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  <span className="truncate">{g.label}</span>
                  {gateway === g.id && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </section>

          {/* API key */}
          <section className="flex flex-col gap-2">
            <label htmlFor="api-key" className="text-sm font-medium">
              API key
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary/50">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-…"
                className="h-10 w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
                className="text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored encrypted and scoped to your workspace. Never sent to the browser after saving.
            </p>
          </section>

          {/* Default model */}
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">Default model</label>
            <div className="flex flex-col gap-1.5">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDefaultModel(m.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                    defaultModel === m.id
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.provider}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    ${m.inputPerM}/${m.outputPerM} per 1M
                  </span>
                  {defaultModel === m.id && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            {saved ? (
              <>
                <Check className="size-3.5" /> Saved
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </footer>
      </div>
    </div>
  )
}
