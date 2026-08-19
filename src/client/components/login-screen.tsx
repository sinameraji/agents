import { useEffect, useState } from 'react'
import { Cloud, Loader2, Lock, Mail, Terminal } from 'lucide-react'

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}
import { Button } from '@/components/ui/button'

interface Providers {
  cloudflare: boolean
  github: boolean
  password: boolean
}

export function LoginScreen() {
  const [providers, setProviders] = useState<Providers | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/auth/providers')
      .then((r) => r.json() as Promise<Providers>)
      .then(setProviders)
      .catch(() => setProviders({ cloudflare: false, github: false, password: true }))
  }, [])

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        setErr('Incorrect password.')
        setBusy(false)
        return
      }
      window.location.reload()
    } catch {
      setErr('Something went wrong. Try again.')
      setBusy(false)
    }
  }

  return (
    <main className="flex h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-xs flex-col items-center gap-5">
        <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Terminal className="size-6" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">Dreamweav</h1>
          <p className="mt-1 text-sm text-muted-foreground">Coding agents in your browser.</p>
        </div>

        {providers === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex w-full flex-col gap-2">
            {providers.cloudflare && (
              <Button className="w-full gap-2" onClick={() => window.location.assign('/auth/cloudflare')}>
                <Cloud className="size-4" />
                Log in with Cloudflare
                <span className="ml-auto rounded-full bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] font-medium">
                  recommended
                </span>
              </Button>
            )}
            {providers.github && (
              <Button variant="outline" className="w-full gap-2" onClick={() => window.location.assign('/auth/github')}>
                <GithubMark className="size-4" />
                Continue with GitHub
              </Button>
            )}
            <Button variant="outline" className="w-full gap-2 opacity-50" disabled title="Coming soon">
              <Mail className="size-4" />
              Email magic link · soon
            </Button>

            {providers.password && !showPassword && (
              <button
                type="button"
                onClick={() => setShowPassword(true)}
                className="mt-1 text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Sign in with a password instead
              </button>
            )}
            {providers.password && showPassword && (
              <form onSubmit={submitPassword} className="mt-1 flex w-full flex-col gap-2">
                <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-primary/50">
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
                {err && <p className="text-sm text-destructive">{err}</p>}
                <Button type="submit" disabled={busy || !password} className="w-full gap-2">
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Continue
                </Button>
              </form>
            )}
          </div>
        )}

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Logging in with Cloudflare auto-configures KimiFlare and AI Gateway routing from the
          permissions you approve — no manual tokens.
        </p>
      </div>
    </main>
  )
}
