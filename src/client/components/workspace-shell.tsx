import { useMemo, useState } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMe } from '@/hooks/use-me'
import { useUserAgent } from '@/hooks/use-user-agent'
import { useRouter, useSessionRoute } from '@/router'
import { SessionSidebar } from './coding-agent/session-sidebar'
import { SettingsDialog } from './coding-agent/settings-dialog'
import { LiveChatView } from './live-chat-view'
import { NewSession } from './new-session'
import { Onboarding } from './onboarding'
import { EmptyState } from './empty-state'
import { LoginScreen } from './login-screen'

export function WorkspaceShell() {
  const { me, loading } = useMe()
  if (loading) return <FullScreen>Connecting…</FullScreen>
  if (!me) return <LoginScreen />
  return <Shell userId={me.id} email={me.email} />
}

function Shell({ userId, email }: { userId: string; email: string }) {
  const ua = useUserAgent(userId)
  const { path, navigate } = useRouter()
  const sessionId = useSessionRoute()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // First-time = no sessions yet: the 3-step wizard IS the home screen (and /new) until the
  // first session exists. Step 1 adapts to whatever a Cloudflare/GitHub login already provisioned.
  const conn = ua.connections
  const firstTime = conn !== null && ua.sessions.length === 0
  const main = useMemo(() => {
    if (sessionId) return <LiveChatView key={sessionId} sessionId={sessionId} />
    if (path === '/new') {
      return firstTime ? <Onboarding ua={ua} /> : <NewSession ua={ua} onOpenSettings={() => setSettingsOpen(true)} />
    }
    if (firstTime) return <Onboarding ua={ua} />
    return <EmptyState onNew={() => navigate('/new')} hasSessions={ua.sessions.length > 0} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, sessionId, ua.sessions.length, conn, firstTime])

  const sidebar = (
    <SessionSidebar
      sessions={ua.sessions}
      activeId={sessionId ?? ''}
      email={email}
      onSelect={(id) => {
        void ua.markRead(id)
        setDrawerOpen(false)
        navigate(`/s/${id}`)
      }}
      onNew={() => {
        setDrawerOpen(false)
        navigate('/new')
      }}
      onOpenSettings={() => {
        setDrawerOpen(false)
        setSettingsOpen(true)
      }}
      onDelete={(id) => {
        void ua.deleteSession(id)
        if (sessionId === id) navigate('/')
      }}
      onRename={(id, name) => void ua.renameSession(id, name)}
    />
  )

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* Mobile top bar — the only chrome small screens get */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
        <Button variant="ghost" size="icon-sm" aria-label="Open menu" title="Sessions & settings" onClick={() => setDrawerOpen(true)}>
          <Menu className="size-5" />
        </Button>
        <span className="text-sm font-semibold">Dreamweav</span>
      </div>

      <div className="hidden w-72 shrink-0 border-r border-border md:block">{sidebar}</div>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[85vw] border-r border-border bg-background shadow-2xl">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">{main}</div>
      {settingsOpen && <SettingsDialog ua={ua} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex h-dvh w-full items-center justify-center bg-background p-8 text-center text-sm text-muted-foreground">
      {children}
    </main>
  )
}
