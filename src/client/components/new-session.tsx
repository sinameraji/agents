import { useState } from 'react'
import { File, GitBranch, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from '@/router'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { HARNESSES, type Harness, type MaskedConnections, type SessionSource } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { CloudflareMark } from './login-screen'
import { KimiFlareMark, OpenCodeMark, PiMark, VercelMark } from './brand-marks'

import { PROVIDERS } from './coding-agent/settings-dialog'
import { AnthropicMark, OpenAIMark, OpenRouterMark } from './brand-marks'

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

interface Requirement {
  label: string
  ok: boolean
  optional?: boolean
  hint?: string
  link?: { href: string; text: string }
}

/** What a harness needs before its first turn, written for someone who has never used it. */
export function harnessRequirements(h: Harness, conn: MaskedConnections | null): Requirement[] {
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
        hint: 'Name of a gateway in your account, with the Edit permission KimiFlare can create one for you.',
      },
      ghToken,
    ]
  }
  return [
    {
      label: 'A model provider key',
      ok: hasModelKey,
      hint: 'Add a key for your provider of choice in Settings → Connections.',
    },
    ghToken,
  ]
}


type Source = 'github' | 'blank'

export function NewSession({
  ua,
  onOpenSettings,
}: {
  ua: UserAgentApi
  onOpenSettings?: (tab?: 'providers' | 'harness' | 'git') => void
}) {
  const { navigate } = useRouter()
  const [source, setSource] = useState<Source>('github')
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const harness = ua.settings.defaultHarness
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const create = async () => {
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
      const id = await ua.createSession({ source: sessionSource })
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
            <SourceCard active={source === 'github'} onClick={() => setSource('github')} icon={<GitBranch className="size-4" />} label="Git repo" hint="GitHub, GitLab, any HTTPS remote" />
            <SourceCard active={source === 'blank'} onClick={() => setSource('blank')} icon={<File className="size-4" />} label="Blank" hint="Empty workspace" />
          </div>
        </section>

        {source === 'github' && (
          <section className="flex flex-col gap-2">
            <label className="text-sm font-medium">Repository URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo, or any HTTPS git URL"
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
                Private GitHub repos need a token (Settings → Git). Other hosts: public repos for now.
              </p>
            )}
          </section>
        )}

        {(() => {
          const h = HARNESSES.find((x) => x.id === harness)!
          const HM = HARNESS_MARKS[harness]
          const p = PROVIDERS.find((x) => x.id === ua.settings.defaultProvider)!
          const PM = PROVIDER_MARKS[p.id]
          const reqs = harnessRequirements(harness, ua.connections)
          const missing = reqs.filter((r) => !r.ok && !r.optional)
          const providerConfigured =
            p.id === 'cloudflare'
              ? !!ua.connections?.cloudflareAccountId && !!ua.connections?.cloudflareApiToken && !!ua.connections?.cloudflareGatewayId
              : !!ua.connections?.[p.field]
          const Row = ({
            label,
            mark,
            value,
            ok,
            tab,
          }: {
            label: string
            mark: React.ReactNode
            value: string
            ok: boolean
            tab: 'providers' | 'harness'
          }) => (
            <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card/60 px-3 py-2">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
              {mark}
              <span className="min-w-0 flex-1 truncate text-sm">{value}</span>
              <span
                aria-hidden
                title={ok ? 'Ready' : 'Needs setup'}
                className={cn('size-1.5 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-warning')}
              />
              <button
                type="button"
                onClick={() => onOpenSettings?.(tab)}
                className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Change
              </button>
            </div>
          )
          return (
            <section className="flex flex-col gap-1.5">
              <Row
                label="Harness"
                mark={HM ? <HM className="size-4 shrink-0" /> : null}
                value={h.label}
                ok={missing.length === 0}
                tab="harness"
              />
              <Row
                label="Provider"
                mark={PM ? <PM className="size-4 shrink-0" /> : null}
                value={`${p.label}${providerConfigured ? ' · configured' : ''}`}
                ok={providerConfigured || harness === 'kimiflare'}
                tab="providers"
              />
              {missing.length > 0 && (
                <p className="text-xs text-warning">
                  {h.label} needs: {missing.map((r) => r.label).join(', ')} — use Change to set it up.
                </p>
              )}
            </section>
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
