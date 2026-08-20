'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { deriveZone, zoneStatusLabel, type DomainWizardState } from '~shared/domain'

/**
 * Settings → Domain (admin only): put this instance on agents.yourcompany.com even when the
 * domain is NOT yet on Cloudflare. Stepper: enter hostname → swap nameservers at the registrar
 * (with live polling) → attach this worker → done. State lives server-side on the UserAgent, so
 * closing the dialog or reloading resumes mid-wait. A domain already active on Cloudflare skips
 * straight to the attach step.
 */

type Phase = 'loading' | 'enter' | 'nameservers' | 'attach' | 'done'

interface WizardError {
  note: string
  needsReconnect?: boolean
}

const STEPS: { id: Exclude<Phase, 'loading'>; label: string }[] = [
  { id: 'enter', label: 'Domain' },
  { id: 'nameservers', label: 'Nameservers' },
  { id: 'attach', label: 'Attach' },
  { id: 'done', label: 'Live' },
]

const phaseForStep = (step: DomainWizardState['step']): Phase =>
  step === 'done' ? 'done' : step === 'attach' ? 'attach' : 'nameservers'

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(path, init)
    return (await r.json()) as T
  } catch {
    return null
  }
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
})

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${text}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  )
}

function ErrorNote({ error }: { error: WizardError | null }) {
  if (!error) return null
  return (
    <div className="text-xs text-destructive">
      {error.note}
      {error.needsReconnect && (
        <button
          type="button"
          onClick={() => window.location.assign('/auth/cloudflare')}
          className="ml-1 underline underline-offset-2 hover:opacity-80"
        >
          Reconnect Cloudflare
        </button>
      )}
    </div>
  )
}

export function DomainWizard({ ua }: { ua: UserAgentApi }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [wizard, setWizard] = useState<DomainWizardState | null>(null)
  const [hostname, setHostname] = useState('')
  const [zoneOverride, setZoneOverride] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<WizardError | null>(null)
  const [skippedNs, setSkippedNs] = useState(false)

  // Resume: the wizard state is persisted server-side on the UserAgent.
  useEffect(() => {
    let alive = true
    void api<{ state: DomainWizardState | null }>('/api/domain/state').then((d) => {
      if (!alive) return
      if (d?.state) {
        setWizard(d.state)
        setHostname(d.state.hostname)
        setPhase(phaseForStep(d.state.step))
      } else {
        setPhase('enter')
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const checkStatus = useCallback(
    async (manual: boolean) => {
      const zoneId = wizard?.zoneId
      if (!zoneId) return
      if (manual) setChecking(true)
      const d = await api<{ ok: boolean; status?: string; nameServers?: string[]; note?: string; needsReconnect?: boolean }>(
        `/api/domain/status?zoneId=${encodeURIComponent(zoneId)}`,
      )
      if (manual) setChecking(false)
      if (!d) return
      if (!d.ok) {
        if (manual) setError({ note: d.note ?? 'Could not check the zone status.', needsReconnect: d.needsReconnect })
        return
      }
      setError(null)
      setWizard((w) =>
        w && w.zoneId === zoneId
          ? { ...w, status: d.status ?? w.status, nameServers: d.nameServers?.length ? d.nameServers : w.nameServers }
          : w,
      )
      if (d.status === 'active') setPhase('attach')
    },
    [wizard?.zoneId],
  )

  // Live polling while waiting for the registrar change (~30s, plus one check on entry).
  useEffect(() => {
    if (phase !== 'nameservers' || !wizard?.zoneId) return
    void checkStatus(false)
    const t = setInterval(() => void checkStatus(false), 30_000)
    return () => clearInterval(t)
  }, [phase, wizard?.zoneId, checkStatus])

  const start = async () => {
    setBusy(true)
    setError(null)
    setSkippedNs(false)
    const d = await api<{ ok: boolean; state?: DomainWizardState; note?: string; needsReconnect?: boolean }>(
      '/api/domain/start',
      post({ hostname, zone: showOverride ? zoneOverride : undefined }),
    )
    setBusy(false)
    if (!d) return setError({ note: 'Something went wrong. Try again.' })
    if (!d.ok || !d.state) return setError({ note: d.note ?? 'Could not start the domain setup.', needsReconnect: d.needsReconnect })
    setWizard(d.state)
    if (d.state.step === 'attach') setSkippedNs(true)
    setPhase(phaseForStep(d.state.step))
  }

  const attach = async () => {
    setBusy(true)
    setError(null)
    const d = await api<{ ok: boolean; url?: string; note?: string; needsReconnect?: boolean }>(
      '/api/domain/attach',
      post({ hostname: wizard?.hostname, zoneId: wizard?.zoneId }),
    )
    setBusy(false)
    if (!d) return setError({ note: 'Something went wrong. Try again.' })
    if (!d.ok) return setError({ note: d.note ?? 'Could not attach the domain.', needsReconnect: d.needsReconnect })
    setWizard((w) => (w ? { ...w, step: 'done', url: d.url } : w))
    setPhase('done')
  }

  const reset = async () => {
    setBusy(true)
    await api('/api/domain/reset', post())
    setBusy(false)
    setWizard(null)
    setHostname('')
    setZoneOverride('')
    setShowOverride(false)
    setError(null)
    setSkippedNs(false)
    setPhase('enter')
  }

  const derived = hostname.trim() ? deriveZone(hostname, showOverride ? zoneOverride : undefined) : null
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.id === phase))

  if (phase === 'loading') {
    return <p className="text-xs text-muted-foreground">Loading domain setup…</p>
  }

  return (
    <section className="flex flex-col gap-3">
      {/* stepper */}
      <ol className="flex items-center gap-1" aria-label="Domain setup steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="h-px w-4 bg-border" />}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                i < stepIndex && 'text-success',
                i === stepIndex && 'bg-primary/10 text-primary',
                i > stepIndex && 'text-muted-foreground/60',
              )}
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              {i < stepIndex ? <Check className="size-3" /> : <span>{i + 1}.</span>}
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {phase === 'enter' && (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Put this app on your own subdomain, even if the domain is not on Cloudflare yet. The zone is
            created on your Cloudflare account, you switch nameservers at your registrar, and the app plus
            wildcard previews get attached here.
          </p>
          <label htmlFor="dw-hostname" className="text-sm font-medium">Hostname</label>
          <input
            id="dw-hostname"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="agents.yourcompany.com"
            className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          {derived?.ok && (
            <p className="text-xs text-muted-foreground">
              Cloudflare zone: <span className="font-mono text-foreground">{derived.zone}</span>
            </p>
          )}
          {derived && !derived.ok && <p className="text-xs text-destructive">{derived.error}</p>}
          {!showOverride ? (
            <button
              type="button"
              onClick={() => setShowOverride(true)}
              className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              My registrable domain is different (co.uk style)
            </button>
          ) : (
            <>
              <label htmlFor="dw-zone" className="text-sm font-medium">Registrable domain (zone)</label>
              <input
                id="dw-zone"
                value={zoneOverride}
                onChange={(e) => setZoneOverride(e.target.value)}
                placeholder="yourcompany.co.uk"
                className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
              />
            </>
          )}
          <Button
            size="sm"
            className="mt-1 self-start"
            disabled={busy || !hostname.trim() || (derived ? !derived.ok : true)}
            onClick={() => void start()}
          >
            {busy ? 'Setting up…' : 'Start setup'}
          </Button>
          <ErrorNote error={error} />
          <ManualTokenFallback ua={ua} />
        </>
      )}

      {phase === 'nameservers' && wizard && (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-mono text-foreground">{wizard.zone}</span> is on your Cloudflare account and
            waiting for its nameservers. At your registrar (where you bought the domain):
          </p>
          <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>Disable DNSSEC first, if it is on. The switch fails silently while DNSSEC is active.</li>
            <li>Replace ALL existing nameservers with the two below. Remove every old entry.</li>
            <li>Copy the exact spelling. No extra dots or spaces.</li>
          </ol>
          <div className="flex flex-col gap-1.5">
            {(wizard.nameServers.length ? wizard.nameServers : ['(assigned nameservers appear here shortly)']).map((ns) => (
              <div key={ns} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{ns}</span>
                {wizard.nameServers.length > 0 && <CopyButton text={ns} />}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                wizard.status === 'active'
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-warning/30 bg-warning/10 text-warning',
              )}
            >
              <span aria-hidden className={cn('size-1.5 rounded-full', wizard.status === 'active' ? 'bg-success' : 'animate-pulse bg-warning')} />
              {zoneStatusLabel(wizard.status)}…
            </span>
            <button
              type="button"
              disabled={checking}
              onClick={() => void checkStatus(true)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3', checking && 'animate-spin')} /> Check now
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Rechecks every 30 seconds. Registrar changes usually land within minutes but can take up to 24 hours.
            You can close this window, the setup resumes where you left off.
          </p>
          <ErrorNote error={error} />
          <button type="button" onClick={() => void reset()} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Start over with a different domain
          </button>
        </>
      )}

      {phase === 'attach' && wizard && (
        <>
          {skippedNs && (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{wizard.zone}</span> is already active on Cloudflare, so the
              nameserver step was skipped.
            </p>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs">
            <Check className="size-3.5 shrink-0 text-success" />
            <span>
              Nameservers verified. <span className="font-mono">{wizard.zone}</span> is active on Cloudflare.
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Last step: attach <span className="font-mono text-foreground">{wizard.hostname}</span> (and wildcard
            previews under it) to this app.
          </p>
          <Button size="sm" className="self-start" disabled={busy} onClick={() => void attach()}>
            {busy ? 'Attaching…' : 'Attach domain'}
          </Button>
          <ErrorNote error={error} />
          <button type="button" onClick={() => void reset()} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Start over with a different domain
          </button>
        </>
      )}

      {phase === 'done' && wizard && (
        <>
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs">
            <Check className="size-3.5 shrink-0 text-success" />
            <span className="min-w-0 truncate">
              This app is live at{' '}
              <a
                href={wizard.url ?? `https://${wizard.hostname}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-success underline underline-offset-2"
              >
                {wizard.url ?? `https://${wizard.hostname}`} <ExternalLink className="size-3" />
              </a>
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            TLS certificates can take a few minutes to issue. If the browser shows a certificate warning at
            first, wait a little and reload.
          </p>
          <button type="button" onClick={() => void reset()} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Set up another domain
          </button>
        </>
      )}
    </section>
  )
}

/** Fallback for zones already on Cloudflare when no Cloudflare login is connected: a one-shot
 *  API token (Zone Read + DNS Edit + Workers Routes Edit), used once and never stored. */
function ManualTokenFallback({ ua }: { ua: UserAgentApi }) {
  const [open, setOpen] = useState(false)
  const [domain, setDomain] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; note: string } | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Domain already on Cloudflare? Use a manual API token instead
      </button>
    )
  }
  const wire = async () => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await ua.setupCustomDomain(domain, token))
    } catch (e) {
      setResult({ ok: false, note: (e as Error).message })
    } finally {
      setBusy(false)
      setToken('')
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <label htmlFor="dw-manual-domain" className="text-sm font-medium">Domain</label>
      <input
        id="dw-manual-domain"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="example.com"
        className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
      />
      <label htmlFor="dw-manual-token" className="text-sm font-medium">API token</label>
      <p className="text-xs text-muted-foreground">
        Zone Read + DNS Edit + Workers Routes Edit for that zone. Used once, never stored.
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary/50">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <input
          id="dw-manual-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Cloudflare API token"
          className="h-9 w-full bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !domain.trim() || !token.trim()} onClick={() => void wire()}>
          {busy ? 'Wiring…' : 'Wire domain'}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Back to the guided setup
        </button>
      </div>
      {result && <div className={cn('text-xs', result.ok ? 'text-success' : 'text-destructive')}>{result.note}</div>}
    </div>
  )
}
