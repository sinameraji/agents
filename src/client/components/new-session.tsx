import { useState } from 'react'
import { GitBranch, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from '@/router'
import type { UserAgentApi } from '@/hooks/use-user-agent'
import { HARNESSES, type Harness, type SessionSource } from '~shared/protocol'
import { Button } from '@/components/ui/button'

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
              <button
                key={h.id}
                type="button"
                disabled={!h.enabled}
                onClick={() => setHarness(h.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40',
                  harness === h.id ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{h.label}{!h.enabled && ' · soon'}</span>
                  <span className="text-xs text-muted-foreground">{h.blurb}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {harness === 'kimiflare' && (!ua.connections?.cloudflareApiToken || !ua.connections?.cloudflareAccountId) && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
            <p className="text-sm text-foreground/90">
              KimiFlare runs on <span className="font-medium">your own Cloudflare account</span>. Add your
              Account ID and an API token (Workers AI + AI Gateway) to authenticate.
            </p>
            {onOpenSettings && (
              <Button variant="secondary" size="sm" className="shrink-0" onClick={onOpenSettings}>
                Open Settings
              </Button>
            )}
          </div>
        )}

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
