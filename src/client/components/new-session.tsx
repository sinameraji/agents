import { useState } from 'react'
import { Check, CircleAlert, ExternalLink, GitBranch, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from '@/router'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { HARNESSES, type Harness, type MaskedConnections, type SessionSource } from '~shared/protocol'
import { Button } from '@/components/ui/button'

interface Requirement {
  label: string
  ok: boolean
  optional?: boolean
  hint?: string
  link?: { href: string; text: string }
}

/** What a harness needs before its first turn — written for someone who has never used it. */
function harnessRequirements(h: Harness, conn: MaskedConnections | null): Requirement[] {
  const hasModelKey =
    !!conn?.openrouterKey || !!conn?.anthropicKey || !!conn?.openaiKey ||
    (!!conn?.cloudflareApiToken && !!conn?.cloudflareAccountId && !!conn?.cloudflareGatewayId)
  const ghToken: Requirement = {
    label: 'GitHub token',
    ok: !!conn?.githubPat,
    optional: true,
    hint: 'Only for private repos and the Git tab (push, PRs). Classic token with the “repo” scope.',
    link: { href: 'https://github.com/settings/tokens', text: 'github.com/settings/tokens' },
  }
  if (h === 'kimiflare') {
    return [
      {
        label: 'Cloudflare Account ID',
        ok: !!conn?.cloudflareAccountId,
        hint: 'Shown on the right side of any zone page in the Cloudflare dashboard.',
        link: { href: 'https://dash.cloudflare.com', text: 'dash.cloudflare.com' },
      },
      {
        label: 'Cloudflare API token',
        ok: !!conn?.cloudflareApiToken,
        hint: 'Create a custom token with: Workers AI:Read · AI Gateway:Read · AI Gateway:Edit.',
        link: { href: 'https://dash.cloudflare.com/profile/api-tokens', text: 'dash.cloudflare.com/profile/api-tokens' },
      },
      {
        label: 'AI Gateway ID',
        ok: !!conn?.cloudflareGatewayId,
        optional: true,
        hint: 'Name of a gateway in your account — with the Edit permission KimiFlare can create one for you.',
      },
      ghToken,
    ]
  }
  return [
    {
      label: 'A model provider key',
      ok: hasModelKey,
      hint: 'OpenRouter is the easiest: one key unlocks every model, pay as you go.',
      link: { href: 'https://openrouter.ai/settings/keys', text: 'openrouter.ai/settings/keys' },
    },
    ghToken,
  ]
}

function RequirementRow({ r }: { r: Requirement }) {
  return (
    <div className="flex items-start gap-2">
      {r.ok ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
      ) : (
        <CircleAlert className={cn('mt-0.5 size-3.5 shrink-0', r.optional ? 'text-muted-foreground' : 'text-warning')} />
      )}
      <div className="min-w-0 text-xs leading-relaxed">
        <span className={cn('font-medium', r.ok ? 'text-foreground/80' : 'text-foreground')}>
          {r.label}
          {r.optional && <span className="font-normal text-muted-foreground"> · optional</span>}
          {r.ok && <span className="font-normal text-success"> · configured</span>}
        </span>
        {!r.ok && r.hint && <p className="text-muted-foreground">{r.hint}</p>}
        {!r.ok && r.link && (
          <a href={r.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            {r.link.text} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  )
}

type Source = 'github' | 'blank'

export function NewSession({ ua, onOpenSettings }: { ua: UserAgentApi; onOpenSettings?: () => void }) {
  const { navigate } = useRouter()
  const [source, setSource] = useState<Source>('github')
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [harness, setHarness] = useState<Harness>(ua.settings.defaultHarness)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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

  return (
    <div className="flex min-w-0 flex-1 items-start justify-center overflow-y-auto p-8">
      <div className="flex w-full max-w-lg flex-col gap-6 py-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">New session</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spin up an isolated sandbox and point an agent at your code.
          </p>
        </div>

        <section className="flex flex-col gap-2">
          <label className="text-sm font-medium">Source</label>
          <div className="grid grid-cols-2 gap-2">
            <SourceCard active={source === 'github'} onClick={() => setSource('github')} icon={<GitBranch className="size-4" />} label="GitHub repo" hint="Clone & branch" />
            <SourceCard active={source === 'blank'} onClick={() => setSource('blank')} icon={<Sparkles className="size-4" />} label="Blank" hint="Empty workspace" />
          </div>
        </section>

        {source === 'github' && (
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">Repository URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary/50"
            />
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3">
              <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="branch (optional, defaults to the repo default)"
                className="h-10 w-full bg-transparent font-mono text-sm outline-none"
              />
            </div>
            {!ua.connections?.githubPat && (
              <p className="text-xs text-muted-foreground">
                Private repos need a GitHub token — add one in Settings.
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <label className="text-sm font-medium">Harness</label>
          <div className="flex flex-col gap-1.5">
            {HARNESSES.map((h) => (
              <div
                key={h.id}
                role="button"
                tabIndex={h.enabled ? 0 : -1}
                aria-pressed={harness === h.id}
                onClick={() => h.enabled && setHarness(h.id)}
                onKeyDown={(e) => {
                  if (h.enabled && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    setHarness(h.id)
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                  !h.enabled && 'cursor-not-allowed opacity-40',
                  harness === h.id ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{h.label}{!h.enabled && ' · soon'}</span>
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
            ))}
          </div>
        </section>

        {(() => {
          const reqs = harnessRequirements(harness, ua.connections)
          const missing = reqs.some((r) => !r.ok && !r.optional)
          const label = HARNESSES.find((h) => h.id === harness)?.label ?? harness
          return (
            <div
              className={cn(
                'flex flex-col gap-2.5 rounded-lg border px-3 py-2.5',
                missing ? 'border-warning/40 bg-warning/10' : 'border-border bg-card/60',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-foreground/90">
                  {missing ? `Before your first ${label} turn:` : `${label} is ready to go.`}
                </p>
                {missing && onOpenSettings && (
                  <Button variant="secondary" size="sm" className="shrink-0" onClick={onOpenSettings}>
                    Open Settings
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {reqs.map((r) => (
                  <RequirementRow key={r.label} r={r} />
                ))}
              </div>
            </div>
          )
        })()}

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={create} disabled={busy} className="gap-2">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create session
          </Button>
          <Button variant="ghost" onClick={() => navigate('/')} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

function SourceCard({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-3 py-3 text-left transition-colors',
        active ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">{icon}{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  )
}
