'use client'

import { useState } from 'react'
import { Check, ChevronDown, ExternalLink, GitBranch, KeyRound, Loader2, Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useRouter } from '@/router'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { HARNESSES, type Harness, type SessionSource } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { PROVIDERS } from './coding-agent/settings-dialog'

type Step = 1 | 2 | 3

const STEPS: { n: Step; title: string; hint: string }[] = [
  { n: 1, title: 'Provider', hint: 'where your models run' },
  { n: 2, title: 'Harness', hint: 'the agent that does the work' },
  { n: 3, title: 'Workspace', hint: 'repo or blank' },
]

/** First-run wizard: provider key → harness → workspace → session. Shown until a model key exists. */
export function Onboarding({ ua }: { ua: UserAgentApi }) {
  const { navigate } = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [done, setDone] = useState<Set<Step>>(new Set())

  // step 1 — provider
  const [provider, setProvider] = useState(ua.settings.defaultProvider)
  const [key, setKey] = useState('')
  const [cfAccount, setCfAccount] = useState('')
  const [cfGateway, setCfGateway] = useState('')

  // step 2 — harness (+ inline CF creds when KimiFlare needs them)
  const [harness, setHarness] = useState<Harness>(ua.settings.defaultHarness)
  const [kfAccount, setKfAccount] = useState('')
  const [kfToken, setKfToken] = useState('')
  const [kfGateway, setKfGateway] = useState('')

  // step 3 — workspace
  const [source, setSource] = useState<'blank' | 'github'>('blank')
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const meta = PROVIDERS.find((p) => p.id === provider)!
  const keyStored = !!ua.connections?.[meta.field]
  const cfStored = !!ua.connections?.cloudflareAccountId && !!ua.connections?.cloudflareApiToken
  const providerReady =
    provider === 'cloudflare' ? (cfStored || (!!key && !!cfAccount)) : keyStored || !!key
  const kimiNeedsCreds = harness === 'kimiflare' && !cfStored && provider !== 'cloudflare'

  const finishStep1 = async () => {
    setErr(null)
    setBusy(true)
    try {
      const connections: Record<string, string> = {}
      if (key) connections[meta.field] = key
      if (provider === 'cloudflare') {
        if (cfAccount) connections.cloudflareAccountId = cfAccount
        if (cfGateway) connections.cloudflareGatewayId = cfGateway
      }
      await ua.saveSettings({ settings: { defaultProvider: provider }, connections })
      setKey('')
      setDone((d) => new Set(d).add(1))
      setStep(2)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finishStep2 = async () => {
    setErr(null)
    setBusy(true)
    try {
      if (kimiNeedsCreds && (kfAccount || kfToken)) {
        const connections: Record<string, string> = {}
        if (kfAccount) connections.cloudflareAccountId = kfAccount
        if (kfToken) connections.cloudflareApiToken = kfToken
        if (kfGateway) connections.cloudflareGatewayId = kfGateway
        await ua.saveSettings({ connections })
      }
      setDone((d) => new Set(d).add(2))
      setStep(3)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setErr(null)
    if (source === 'github' && !/github\.com\/.+\/.+/.test(url)) {
      setErr('Enter a GitHub repo URL, e.g. https://github.com/owner/repo')
      return
    }
    setBusy(true)
    try {
      const sessionSource: SessionSource =
        source === 'github'
          ? { kind: 'github', url: url.trim(), branch: branch.trim() || undefined }
          : { kind: 'blank' }
      const id = await ua.createSession({ source: sessionSource, harness })
      navigate(`/s/${id}`)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  const selectedHarness = HARNESSES.find((h) => h.id === harness)!
  const inputCls =
    'h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/50'

  return (
    <main className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Welcome to Dreamweav</h1>
          <p className="text-sm text-muted-foreground">One-time setup — you can change all of this later.</p>
        </div>

        {/* Stepper */}
        <ol className="flex items-start gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const isDone = done.has(s.n)
            const isActive = step === s.n
            return (
              <li key={s.n} className="flex flex-1 items-start gap-2">
                <button
                  type="button"
                  disabled={!isDone && !isActive}
                  onClick={() => (isDone || isActive) && setStep(s.n)}
                  className={cn('flex flex-1 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors',
                    isActive ? 'border-primary/60 bg-primary/10' : isDone ? 'border-border bg-card hover:bg-muted' : 'border-border/60 opacity-60')}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span className={cn('grid size-4.5 shrink-0 place-items-center rounded-full text-[10px]',
                      isDone ? 'bg-success text-white' : isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      {isDone ? <Check className="size-3" /> : s.n}
                    </span>
                    {s.title}
                  </span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{s.hint}</span>
                </button>
                {i < STEPS.length - 1 && <span className="mt-4 hidden h-px w-3 shrink-0 bg-border sm:block" />}
              </li>
            )
          })}
        </ol>

        {/* Step 1 — provider */}
        {step === 1 && (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold">Where should your models run?</h2>
              <p className="text-xs text-muted-foreground">
                Bring your own key — it&apos;s encrypted and only used to run your sessions.
              </p>
            </div>
            <div className="relative">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
                aria-label="Model provider"
                className="h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-9 text-sm outline-none focus:border-primary/50"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.id === 'openrouter' ? ' — recommended: one key, every model' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-3 right-3 size-4 text-muted-foreground" />
            </div>

            {provider === 'cloudflare' ? (
              <div className="flex flex-col gap-2">
                <input value={cfAccount} onChange={(e) => setCfAccount(e.target.value)} placeholder={cfStored ? 'Account ID · saved' : 'Account ID'} aria-label="Cloudflare Account ID" className={inputCls} />
                <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfStored ? 'API token · saved — paste to replace' : 'API token'} aria-label="Cloudflare API token" className={inputCls} />
                <input value={cfGateway} onChange={(e) => setCfGateway(e.target.value)} placeholder="AI Gateway ID (optional)" aria-label="Cloudflare AI Gateway ID" className={inputCls} />
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary/50">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && providerReady && void finishStep1()}
                  placeholder={keyStored ? 'Key saved — paste to replace' : meta.placeholder}
                  aria-label={`${meta.label} API key`}
                  className="h-10 w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              No key yet?{' '}
              <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                {meta.keyUrl.replace('https://', '')} <ExternalLink className="size-3" />
              </a>
            </p>
            <Button onClick={() => void finishStep1()} disabled={!providerReady || busy} className="gap-2 self-start">
              {busy && <Loader2 className="size-4 animate-spin" />}
              Start
            </Button>
          </section>
        )}

        {/* Step 2 — harness */}
        {step === 2 && (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold">Choose your harness <span className="font-normal text-muted-foreground">· optional</span></h2>
              <p className="text-xs text-muted-foreground">
                The open-source agent that reads, edits, and runs your code. OpenCode is a great default — you can pick a different one per session anytime.
              </p>
            </div>
            <div className="relative">
              <select
                value={harness}
                onChange={(e) => setHarness(e.target.value as Harness)}
                aria-label="Harness"
                className="h-10 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-9 text-sm outline-none focus:border-primary/50"
              >
                {HARNESSES.filter((h) => h.enabled).map((h) => (
                  <option key={h.id} value={h.id}>{h.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-3 right-3 size-4 text-muted-foreground" />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {selectedHarness.blurb} ·{' '}
              <a href={selectedHarness.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                source <ExternalLink className="size-3" />
              </a>
            </p>
            {kimiNeedsCreds && (
              <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="text-xs text-foreground/90">
                  KimiFlare runs on your Cloudflare account. Token scopes:{' '}
                  <span className="font-mono">Workers AI:Read · AI Gateway:Read/Edit</span> —{' '}
                  <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className="text-primary hover:underline">create one</a>
                </p>
                <input value={kfAccount} onChange={(e) => setKfAccount(e.target.value)} placeholder="Account ID" aria-label="Cloudflare Account ID" className={inputCls} />
                <input type="password" value={kfToken} onChange={(e) => setKfToken(e.target.value)} placeholder="API token" aria-label="Cloudflare API token" className={inputCls} />
                <input value={kfGateway} onChange={(e) => setKfGateway(e.target.value)} placeholder="AI Gateway ID (optional)" aria-label="Cloudflare AI Gateway ID" className={inputCls} />
              </div>
            )}
            <Button
              onClick={() => void finishStep2()}
              disabled={busy || (kimiNeedsCreds && (!kfAccount || !kfToken))}
              className="gap-2 self-start"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Continue
            </Button>
          </section>
        )}

        {/* Step 3 — workspace */}
        {step === 3 && (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold">Pick a workspace</h2>
              <p className="text-xs text-muted-foreground">An isolated sandbox is created either way.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSource('blank')}
                className={cn('flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  source === 'blank' ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted')}
              >
                <span className="flex items-center gap-1.5 text-sm"><Sparkles className="size-3.5" /> Blank</span>
                <span className="text-xs text-muted-foreground">Empty workspace — fastest start</span>
              </button>
              <button
                type="button"
                onClick={() => setSource('github')}
                className={cn('flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  source === 'github' ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted')}
              >
                <span className="flex items-center gap-1.5 text-sm"><GitBranch className="size-3.5" /> GitHub repo</span>
                <span className="text-xs text-muted-foreground">Clone &amp; work on real code</span>
              </button>
            </div>
            {source === 'github' && (
              <div className="flex flex-col gap-2">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" aria-label="Repository URL" className={inputCls} />
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="branch (optional)" aria-label="Branch" className={inputCls} />
                {!ua.connections?.githubPat && (
                  <p className="text-xs text-muted-foreground">Private repo? Add a GitHub token later in Settings.</p>
                )}
              </div>
            )}
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button onClick={() => void create()} disabled={busy} className="gap-2 self-start">
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create session
            </Button>
          </section>
        )}

        {err && step !== 3 && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </main>
  )
}
