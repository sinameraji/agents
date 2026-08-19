'use client'

import { useEffect, useState } from 'react'
import { Check, ExternalLink, Eye, EyeOff, KeyRound, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CloudflareMark } from '../login-screen'
import { GatewayPicker } from '../gateway-picker'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { HARNESSES, type Connections, type Provider } from '~shared/protocol'
import { harnessRequirements } from '../new-session'
import { Button } from '@/components/ui/button'

export const PROVIDERS: { id: Provider; label: string; field: keyof Connections; placeholder: string; keyUrl: string }[] = [
  { id: 'openrouter', label: 'OpenRouter', field: 'openrouterKey', placeholder: 'sk-or-v1-…', keyUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'cloudflare', label: 'Cloudflare AI Gateway', field: 'cloudflareApiToken', placeholder: 'CF API token', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens' },
  { id: 'anthropic', label: 'Anthropic', field: 'anthropicKey', placeholder: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', field: 'openaiKey', placeholder: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
]

function HelpLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
      {children} <ExternalLink className="size-3" />
    </a>
  )
}

export function SettingsDialog({ ua, onClose }: { ua: UserAgentApi; onClose: () => void }) {
  const [provider, setProvider] = useState<Provider>(ua.settings.defaultProvider)
  const [keyInput, setKeyInput] = useState('')
  const [pat, setPat] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [cfAccount, setCfAccount] = useState('')
  const [cfToken, setCfToken] = useState('')
  const [cfGateway, setCfGateway] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [manualCf, setManualCf] = useState(false)
  const [tab, setTab] = useState<'providers' | 'harness' | 'git'>('providers')

  const cfConnected = !!ua.connections?.cloudflareAccountId && !!ua.connections?.cloudflareApiToken
  const gwId = ua.connections?.cloudflareGatewayId ?? null
  const gwDashUrl = ua.connections?.cloudflareAccountId
    ? `https://dash.cloudflare.com/${ua.connections.cloudflareAccountId}/ai/ai-gateway`
    : 'https://dash.cloudflare.com/?to=/:account/ai/ai-gateway'

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
    if (keyInput && provider !== 'cloudflare') connections[current.field] = keyInput
    if (pat) connections.githubPat = pat
    if (cfAccount) connections.cloudflareAccountId = cfAccount
    if (cfToken) connections.cloudflareApiToken = cfToken
    if (cfGateway) connections.cloudflareGatewayId = cfGateway
    await ua.saveSettings({ settings: { defaultProvider: provider }, connections })
    setKeyInput('')
    setPat('')
    setCfToken('')
    setBusy(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Settings">
      <button type="button" aria-label="Close settings" onClick={onClose} className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm" />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4 text-primary" /> Settings
            </h2>
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="tablist" aria-label="Settings sections">
              {(
                [
                  ['providers', 'Providers'],
                  ['harness', 'Harness'],
                  ['git', 'Git'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>

        <div className="scrollbar-thin flex flex-col gap-6 overflow-y-auto px-5 py-5">
          {tab === 'providers' && (
          <>
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">Default model provider</label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Where new sessions send their model calls — keys are encrypted, billed to your own
              accounts. KimiFlare always runs on your Cloudflare account regardless of this choice.
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => {
                const configured =
                  p.id === 'cloudflare'
                    ? cfConnected && !!gwId
                    : !!ua.connections?.[p.field]
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      provider === p.id ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-muted',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        title={configured ? 'Credentials saved' : 'No credentials yet'}
                        className={cn('size-1.5 shrink-0 rounded-full', configured ? 'bg-success' : 'bg-muted-foreground/30')}
                      />
                      <span className="truncate">{p.label}</span>
                    </span>
                    {provider === p.id && <Check className="size-3.5 shrink-0 text-primary" />}
                  </button>
                )
              })}
            </div>
          </section>

          {provider !== 'cloudflare' ? (
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
              <p className="text-xs text-muted-foreground">
                No key yet? <HelpLink href={current.keyUrl}>{current.keyUrl.replace('https://', '')}</HelpLink>
              </p>
            </section>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              The Cloudflare AI Gateway provider uses your Cloudflare account below.
            </p>
          )}

          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              Cloudflare account {cfConnected && <span className="text-xs font-normal text-success">· connected</span>}
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground">Powers KimiFlare and AI Gateway routing.</p>
            {!cfConnected && (
              <button
                type="button"
                onClick={() => window.location.assign('/auth/cloudflare')}
                className="flex h-10 items-center justify-center gap-2.5 rounded-lg border border-black/10 bg-white text-sm font-medium text-[#222] shadow-sm transition-colors hover:bg-[#faf7f2] dark:border-white/10"
              >
                <CloudflareMark className="size-5" />
                Connect Cloudflare — one click, no tokens
              </button>
            )}
            {cfConnected &&
              (gwId ? (
                <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs">
                  <Check className="size-3.5 shrink-0 text-success" />
                  <span className="min-w-0 truncate">
                    AI Gateway <span className="font-mono">“{gwId}”</span>
                  </span>
                  <HelpLink href={gwDashUrl}>dashboard</HelpLink>
                  <button
                    type="button"
                    onClick={() => {
                      void ua.saveSettings({ connections: { cloudflareGatewayId: '' } })
                    }}
                    className="ml-auto shrink-0 text-muted-foreground underline underline-offset-2 hover:text-destructive"
                    title="Stop using this gateway in Dreamweav (it stays in your Cloudflare account)"
                  >
                    Detach
                  </button>
                </div>
              ) : (
                <GatewayPicker ua={ua} compact />
              ))}
            {!cfConnected && (
              <button type="button" onClick={() => setManualCf((v) => !v)} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                {manualCf ? 'Hide manual setup' : 'Enter credentials manually instead'}
              </button>
            )}
            {!cfConnected && manualCf && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Token scopes: <span className="font-mono">Workers AI:Read · AI Gateway:Read/Edit</span> —{' '}
                <HelpLink href="https://dash.cloudflare.com/profile/api-tokens">create one</HelpLink>
              </p>
            )}
            <div className={cn('grid grid-cols-2 gap-2', !cfConnected && !manualCf && 'hidden')}>
              <input
                value={cfAccount}
                onChange={(e) => setCfAccount(e.target.value)}
                placeholder={ua.connections?.cloudflareAccountId ? `Account ID · saved (${ua.connections.cloudflareAccountId})` : 'Account ID'}
                aria-label="Cloudflare Account ID"
                title="Find it on any zone page in the Cloudflare dashboard"
                className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
              <input
                value={cfGateway}
                onChange={(e) => setCfGateway(e.target.value)}
                placeholder={ua.connections?.cloudflareGatewayId ? `Gateway ID · saved (${ua.connections.cloudflareGatewayId})` : 'AI Gateway ID (optional)'}
                aria-label="Cloudflare AI Gateway ID"
                className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
            </div>
            <input
              type="password"
              value={cfToken}
              onChange={(e) => setCfToken(e.target.value)}
              placeholder={ua.connections?.cloudflareApiToken ? 'API token · saved — paste to replace' : 'API token'}
              aria-label="Cloudflare API token"
              className={cn(
                'h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50',
                !cfConnected && !manualCf && 'hidden',
              )}
            />
          </section>

          </>
          )}

          {tab === 'harness' && (
            <section className="flex flex-col gap-2">
              <label className="text-sm font-medium">Default harness</label>
              <p className="text-xs text-muted-foreground">
                Used for new sessions — you can still pick a different one per session.
              </p>
              <div className="flex flex-col gap-1.5">
                {HARNESSES.filter((h) => h.enabled).map((h) => {
                  const reqs = harnessRequirements(h.id, ua.connections)
                  const ready = reqs.every((r) => r.ok || r.optional)
                  const isDefault = ua.settings.defaultHarness === h.id
                  return (
                    <div
                      key={h.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isDefault}
                      onClick={() => void ua.saveSettings({ settings: { defaultHarness: h.id } })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void ua.saveSettings({ settings: { defaultHarness: h.id } })
                        }
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                        isDefault ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5 text-sm">
                          <span
                            aria-hidden
                            title={ready ? 'Ready with your current connections' : 'Needs setup — see the Providers tab'}
                            className={cn('size-1.5 shrink-0 rounded-full', ready ? 'bg-success' : 'bg-warning')}
                          />
                          {h.label}
                          {isDefault && (
                            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">default</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">{h.blurb}</span>
                      </div>
                      <a
                        href={h.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${h.label} source repository`}
                        title={h.repoUrl.replace('https://', '')}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">Green dot = runs with your current connections.</p>
            </section>
          )}

          {tab === 'git' && (
          <section className="flex flex-col gap-2">
            <label htmlFor="gh-pat" className="text-sm font-medium">
              GitHub token {patStored && <span className="text-xs font-normal text-success">· saved ({patStored})</span>}
            </label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Sessions can clone any public HTTPS git remote (GitHub, GitLab, self-hosted) — no setup
              needed. This token adds: private GitHub repos, agent pushes, and the Git tab (push,
              PRs). Classic token, <span className="font-mono">repo</span> scope —{' '}
              <HelpLink href="https://github.com/settings/tokens">create one</HelpLink>
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary/50">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <input
                id="gh-pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={patStored ? 'Replace stored token…' : 'ghp_…'}
                className="h-10 w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </section>
          )}
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
