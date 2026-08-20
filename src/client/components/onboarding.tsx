'use client'

import { useState } from 'react'
import { Check, ExternalLink, File, GitBranch, KeyRound, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useRouter } from '@/router'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { HARNESSES, type Harness, type SessionSource } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { PROVIDERS } from './coding-agent/settings-dialog'
import { CloudflareMark } from './login-screen'
import { AnthropicMark, KimiFlareMark, OpenAIMark, OpenCodeMark, OpenRouterMark, PiMark, VercelMark } from './brand-marks'

const PROVIDER_MARKS: Record<string, (p: { className?: string }) => React.ReactNode> = {
  openrouter: OpenRouterMark,
  cloudflare: CloudflareMark,
  anthropic: AnthropicMark,
  openai: OpenAIMark,
}
const HARNESS_MARKS: Record<string, (p: { className?: string }) => React.ReactNode> = {
  opencode: OpenCodeMark,
  aisdk: VercelMark,
  cfagent: CloudflareMark,
  pi: PiMark,
  kimiflare: KimiFlareMark,
}
import { GatewayPicker } from './gateway-picker'

/** Every option visible, one click to pick. A dropdown hides the menu; this IS the menu. */
function OptionGrid<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { id: T; label: string; icon?: React.ReactNode }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-2 gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
            o.id === value ? 'border-primary/60 bg-primary/10' : 'border-border bg-background hover:bg-muted',
          )}
        >
          {o.icon}
          <span className="min-w-0 truncate font-medium">{o.label}</span>
          {o.id === value && <Check className="ml-auto size-3.5 shrink-0 text-primary" />}
        </button>
      ))}
    </div>
  )
}

type Step = 1 | 2 | 3

const STEPS: { n: Step; title: string; hint: string }[] = [
  { n: 1, title: 'Provider', hint: 'where your models run' },
  { n: 2, title: 'Harness', hint: 'the agent that does the work' },
  { n: 3, title: 'Starting workspace', hint: 'for your first session' },
]

/** First-run wizard: provider key → harness → workspace → session. Guests browse every step
 *  freely, nothing is marked complete until a signed-in user actually commits something. */
export function Onboarding({ ua, guest, onRequireAuth }: { ua: UserAgentApi; guest?: boolean; onRequireAuth?: () => void }) {
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
  const [manualCf, setManualCf] = useState(false)

  const gwStored = !!ua.connections?.cloudflareGatewayId
  const gwId = ua.connections?.cloudflareGatewayId ?? null
  const gwDashUrl = ua.connections?.cloudflareAccountId
    ? `https://dash.cloudflare.com/${ua.connections.cloudflareAccountId}/ai/ai-gateway`
    : 'https://dash.cloudflare.com/?to=/:account/ai/ai-gateway'
  const cfBtnCls =
    'flex h-10 items-center justify-center gap-2.5 rounded-lg border border-black/10 bg-white text-sm font-medium text-[#222] shadow-sm transition-colors hover:bg-[#faf7f2] dark:border-white/10'

  const meta = PROVIDERS.find((p) => p.id === provider)!
  const keyStored = !!ua.connections?.[meta.field]
  const cfStored = !!ua.connections?.cloudflareAccountId && !!ua.connections?.cloudflareApiToken
  /** "Log in with Cloudflare" already provisioned creds, step 1 becomes a confirmation + optional extras. */
  const cfFromLogin = cfStored
  const providerReady =
    provider === 'cloudflare' ? ((cfStored && gwStored) || (!!key && !!cfAccount)) : keyStored || !!key
  const kimiNeedsCreds = harness === 'kimiflare' && !cfStored && provider !== 'cloudflare'

  /** Guests browse freely, but committing anything asks them to sign in. */
  const gate = (): boolean => {
    if (guest) {
      onRequireAuth?.()
      return true
    }
    return false
  }

  const finishStep1 = async () => {
    if (gate()) return
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
      if (!guest) setDone((d) => new Set(d).add(1))
      setStep(2)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finishStep2 = async () => {
    if (gate()) return
    setErr(null)
    setBusy(true)
    try {
      await ua.saveSettings({ settings: { defaultHarness: harness } })
      if (kimiNeedsCreds && (kfAccount || kfToken)) {
        const connections: Record<string, string> = {}
        if (kfAccount) connections.cloudflareAccountId = kfAccount
        if (kfToken) connections.cloudflareApiToken = kfToken
        if (kfGateway) connections.cloudflareGatewayId = kfGateway
        await ua.saveSettings({ connections })
      }
      if (!guest) setDone((d) => new Set(d).add(2))
      setStep(3)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (gate()) return
    setErr(null)
    if (source === 'github' && !/^https:\/\/[^\s/]+\.[^\s/]+\/.+/.test(url)) {
      setErr('Enter an HTTPS git URL, e.g. https://github.com/owner/repo')
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
          <h1 className="text-xl font-semibold">Welcome to Agents.</h1>
          <p className="text-sm text-muted-foreground">One-time setup, you can change all of this later.</p>
        </div>

        {/* Stepper */}
        <ol className="flex items-start gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const isDone = !guest && done.has(s.n)
            const isActive = step === s.n
            const clickable = guest || isDone || isActive
            return (
              <li key={s.n} className="flex flex-1 items-start gap-2">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && setStep(s.n)}
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
        {step === 1 && cfFromLogin && (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              <div className="min-w-0 text-sm">
                <p className="font-medium">Cloudflare connected from your login</p>
                {gwStored ? (
                  <p className="text-xs text-muted-foreground">
                    KimiFlare and AI Gateway <span className="font-mono text-foreground/80">“{gwId}”</span> are
                    ready, no keys needed.{' '}
                    <a href={gwDashUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      View in dashboard <ExternalLink className="size-3" />
                    </a>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">The KimiFlare harness is ready, no keys needed.</p>
                )}
              </div>
            </div>
            {!gwStored && <GatewayPicker ua={ua} compact />}
            <p className="text-xs text-muted-foreground">
              Other providers can be added anytime in Settings → Connections.
            </p>
            <Button
              onClick={() => {
                if (gate()) return
                setDone((d) => new Set(d).add(1))
                setStep(2)
              }}
              className="self-start"
            >
              Continue
            </Button>
          </section>
        )}
        {step === 1 && !cfFromLogin && (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold">Where should your models run?</h2>
              <p className="text-xs text-muted-foreground">
                Bring your own key, it&apos;s encrypted and only used to run your sessions.
              </p>
            </div>
            <OptionGrid
              value={provider}
              onChange={setProvider}
              ariaLabel="Model provider"
              options={PROVIDERS.map((p) => {
                const M = PROVIDER_MARKS[p.id]
                return { id: p.id, label: p.label, icon: M ? <M className="size-4 shrink-0" /> : undefined }
              })}
            />

            {provider === 'cloudflare' ? (
              <div className="flex flex-col gap-2">
                {cfStored ? (
                  <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
                    <Check className="size-4 shrink-0 text-success" />
                    Cloudflare connected from your login
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (gate()) return
                      window.location.assign('/auth/cloudflare')
                    }}
                    className={cfBtnCls}
                  >
                    <CloudflareMark className="size-5" />
                    Connect Cloudflare
                  </button>
                )}
                {cfStored &&
                  (gwStored ? (
                    <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
                      <Check className="size-4 shrink-0 text-success" />
                      <span className="min-w-0 truncate">
                        AI Gateway <span className="font-mono">“{gwId}”</span> ready
                      </span>
                      <a href={gwDashUrl} target="_blank" rel="noreferrer" aria-label="Open AI Gateway in the Cloudflare dashboard" className="ml-auto shrink-0 text-primary hover:underline">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  ) : (
                    <GatewayPicker ua={ua} compact />
                  ))}
                {!cfStored && (
                  <button type="button" onClick={() => setManualCf((v) => !v)} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                    {manualCf ? 'Hide manual setup' : 'Enter credentials manually instead'}
                  </button>
                )}
                {!cfStored && manualCf && (
                  <>
                    <input value={cfAccount} onChange={(e) => setCfAccount(e.target.value)} placeholder="Account ID" aria-label="Cloudflare Account ID" className={inputCls} />
                    <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="API token" aria-label="Cloudflare API token" className={inputCls} />
                    <input value={cfGateway} onChange={(e) => setCfGateway(e.target.value)} placeholder="AI Gateway ID (optional)" aria-label="Cloudflare AI Gateway ID" className={inputCls} />
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary/50">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && providerReady && void finishStep1()}
                  placeholder={keyStored ? 'Key saved, paste to replace' : meta.placeholder}
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
                The open-source agent that reads, edits, and runs your code. OpenCode is a great default, you can pick a different one per session anytime.
              </p>
            </div>
            <OptionGrid
              value={harness}
              onChange={setHarness}
              ariaLabel="Harness"
              options={HARNESSES.filter((h) => h.enabled).map((h) => {
                const M = HARNESS_MARKS[h.id]
                return { id: h.id, label: h.label, icon: M ? <M className="size-4 shrink-0" /> : undefined }
              })}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {selectedHarness.blurb} ·{' '}
              <a href={selectedHarness.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                source <ExternalLink className="size-3" />
              </a>
            </p>
            {kimiNeedsCreds && (
              <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="text-xs text-foreground/90">KimiFlare runs on your Cloudflare account.</p>
                <button
                  type="button"
                  onClick={() => {
                    if (gate()) return
                    window.location.assign('/auth/cloudflare')
                  }}
                  className={cn(cfBtnCls, 'h-9 self-start px-3 text-xs')}
                >
                  <CloudflareMark className="size-4" />
                  Connect Cloudflare
                </button>
                <p className="text-xs text-muted-foreground">
                  Or paste a token with <span className="font-mono">Workers AI:Read · AI Gateway:Read/Edit</span>{' '}
                  from{' '}
                  <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className="text-primary hover:underline">dash.cloudflare.com</a>:
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
              <h2 className="text-sm font-semibold">Pick a starting workspace</h2>
              <p className="text-xs text-muted-foreground">
                Just for your first session, every new session picks its own.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSource('blank')}
                className={cn('flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  source === 'blank' ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted')}
              >
                <span className="flex items-center gap-1.5 text-sm"><File className="size-3.5" /> Blank</span>
                <span className="text-xs text-muted-foreground">Empty workspace, fastest start</span>
              </button>
              <button
                type="button"
                onClick={() => setSource('github')}
                className={cn('flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  source === 'github' ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted')}
              >
                <span className="flex items-center gap-1.5 text-sm"><GitBranch className="size-3.5" /> Git repo</span>
                <span className="text-xs text-muted-foreground">GitHub, GitLab, any HTTPS remote</span>
              </button>
            </div>
            {source === 'github' && (
              <div className="flex flex-col gap-2">
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo, or any HTTPS git URL" aria-label="Repository URL" className={inputCls} />
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
