'use client'

import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, KeyRound, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import type { Connections, Provider } from '~shared/protocol'
import { Button } from '@/components/ui/button'

const PROVIDERS: { id: Provider; label: string; field: keyof Connections; placeholder: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', field: 'openrouterKey', placeholder: 'sk-or-v1-…' },
  { id: 'cloudflare', label: 'Cloudflare AI Gateway', field: 'cloudflareApiToken', placeholder: 'CF API token' },
  { id: 'anthropic', label: 'Anthropic', field: 'anthropicKey', placeholder: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', field: 'openaiKey', placeholder: 'sk-…' },
]

export function SettingsDialog({ ua, onClose }: { ua: UserAgentApi; onClose: () => void }) {
  const [provider, setProvider] = useState<Provider>(ua.settings.defaultProvider)
  const [keyInput, setKeyInput] = useState('')
  const [pat, setPat] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [cfAccount, setCfAccount] = useState('')
  const [cfGateway, setCfGateway] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const current = PROVIDERS.find((p) => p.id === provider)!
  const keyStored = ua.connections?.[current.field]
  const patStored = ua.connections?.githubPat

  const save = async () => {
    setBusy(true)
    const connections: Partial<Record<keyof Connections, string>> = {}
    if (keyInput) connections[current.field] = keyInput
    if (pat) connections.githubPat = pat
    if (provider === 'cloudflare') {
      if (cfAccount) connections.cloudflareAccountId = cfAccount
      if (cfGateway) connections.cloudflareGatewayId = cfGateway
    }
    await ua.saveSettings({ settings: { defaultProvider: provider }, connections })
    setKeyInput('')
    setPat('')
    setBusy(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Settings">
      <button type="button" aria-label="Close settings" onClick={onClose} className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm" />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <h2 className="text-sm font-medium">Connections</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="scrollbar-thin flex flex-col gap-6 overflow-y-auto px-5 py-5">
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">Provider</label>
            <p className="text-xs text-muted-foreground">
              Bring your own credits. Keys are encrypted and used only to run your sessions.
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    provider === p.id ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  <span className="truncate">{p.label}</span>
                  {provider === p.id && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <label htmlFor="api-key" className="text-sm font-medium">
              {current.label} key {keyStored && <span className="text-xs font-normal text-success">· saved ({keyStored})</span>}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary/50">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={keyStored ? 'Replace stored key…' : current.placeholder}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
              />
              <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide key' : 'Show key'} className="text-muted-foreground hover:text-foreground">
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {provider === 'cloudflare' && (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input value={cfAccount} onChange={(e) => setCfAccount(e.target.value)} placeholder="Account ID" className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary/50" />
                <input value={cfGateway} onChange={(e) => setCfGateway(e.target.value)} placeholder="Gateway ID" className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary/50" />
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <label htmlFor="gh-pat" className="text-sm font-medium">
              GitHub token {patStored && <span className="text-xs font-normal text-success">· saved ({patStored})</span>}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary/50">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <input
                id="gh-pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={patStored ? 'Replace stored token…' : 'ghp_… (for private repos & pushes)'}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {saved ? (<><Check className="size-3.5" /> Saved</>) : 'Save changes'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
