import { useMemo, useState } from 'react'
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

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <div className="hidden w-72 shrink-0 border-r border-border md:block">
        <SessionSidebar
          sessions={ua.sessions}
          activeId={sessionId ?? ''}
          email={email}
          onSelect={(id) => {
            void ua.markRead(id)
            navigate(`/s/${id}`)
          }}
          onNew={() => navigate('/new')}
          onOpenSettings={() => setSettingsOpen(true)}
          onDelete={(id) => {
            void ua.deleteSession(id)
            if (sessionId === id) navigate('/')
          }}
          onRename={(id, name) => void ua.renameSession(id, name)}
        />
      </div>
      {main}
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
