import { useEffect, useState } from 'react'
import { Loader2, Lock, Mail } from 'lucide-react'

/** Official Cloudflare logomark (Simple Icons, CC0) in brand orange. */
export function CloudflareMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#F38020" aria-hidden className={className}>
      <path d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727" />
    </svg>
  )
}

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
  email: boolean
  password: boolean
}

export function LoginOptions() {
  const [providers, setProviders] = useState<Providers | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/auth/providers')
      .then((r) => r.json() as Promise<Providers>)
      .then(setProviders)
      .catch(() => setProviders({ cloudflare: false, github: false, email: false, password: true }))
  }, [])

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setEmailState('sending')
    setErr(null)
    try {
      const res = await fetch('/api/login/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setErr(j.error ?? 'Could not send the link, try again.')
        setEmailState('idle')
        return
      }
      setEmailState('sent')
    } catch {
      setErr('Could not send the link, try again.')
      setEmailState('idle')
    }
  }

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
    <div className="flex w-full max-w-xs flex-col items-center gap-5">
        <img src="/icon-512.png" alt="Dreamweav logo" className="size-28 drop-shadow-[0_8px_30px_rgba(117,230,99,0.25)] sm:size-36" />
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">Dreamweav</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your favorite coding models, harnesses, and providers in your browser.
          </p>
        </div>

        {providers === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex w-full flex-col gap-2">
            {providers.cloudflare && (
              <button
                type="button"
                onClick={() => window.location.assign('/auth/cloudflare')}
                className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-black/10 bg-white text-sm font-medium text-[#222] shadow-sm transition-colors hover:bg-[#faf7f2] dark:border-white/10"
              >
                <CloudflareMark className="size-5" />
                Log in with Cloudflare
                <span className="rounded-full bg-[#F38020]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#b35400]">
                  recommended
                </span>
              </button>
            )}
            {providers.github && (
              <button
                type="button"
                onClick={() => window.location.assign('/auth/github')}
                className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg bg-[#24292f] text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#31373e]"
              >
                <GithubMark className="size-4.5 text-white" />
                Continue with GitHub
              </button>
            )}
            {providers.email &&
              (emailState === 'sent' ? (
                <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-center text-sm text-foreground/90">
                  📬 Check your inbox, the link works once and expires in 15 minutes.
                </div>
              ) : (
                <form onSubmit={sendMagicLink} className="flex w-full items-center gap-1.5">
                  <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-primary/50">
                    <Mail className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      aria-label="Email address"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  <Button type="submit" variant="outline" disabled={emailState === 'sending' || !email.trim()} className="h-10 shrink-0 gap-1.5">
                    {emailState === 'sending' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Send link
                  </Button>
                </form>
              ))}
            {/* The "coming soon" teaser only makes sense on a general instance. A locked-down
                Cloudflare-only host (the owner host) shows exactly one door and nothing else. */}
            {!providers.email && !(providers.cloudflare && !providers.github && !providers.password) && (
              <Button variant="outline" className="w-full gap-2 opacity-50" disabled title="Coming soon">
                <Mail className="size-4" />
                Email magic link · soon
              </Button>
            )}

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


    </div>
  )
}

/** Full-page variant. */
export function LoginScreen() {
  return (
    <main className="flex h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
      <LoginOptions />
    </main>
  )
}
