import { useState } from 'react'
import { Loader2, Lock, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LoginScreen() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
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
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-center gap-5">
        <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Terminal className="size-6" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">Dreamweav</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter your password to continue.</p>
        </div>
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
    </main>
  )
}
