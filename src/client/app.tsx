import { useEffect, useState } from 'react'
import { Terminal } from 'lucide-react'

export function App() {
  const [me, setMe] = useState<{ email: string } | null>(null)
  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d as { email: string } | null))
      .catch(() => setMe(null))
  }, [])

  return (
    <main className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Terminal className="size-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Dreamweav</h1>
        <p className="text-sm text-muted-foreground">coding agents in your browser</p>
        <p className="font-mono text-xs text-muted-foreground/70">
          {me ? `signed in as ${me.email}` : 'not signed in'}
        </p>
      </div>
    </main>
  )
}
