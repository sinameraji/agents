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

  // First-time users (no model key yet) get the 3-step wizard instead of the full session form.
  const conn = ua.connections
  const hasModelKey =
    !!conn?.openrouterKey || !!conn?.anthropicKey || !!conn?.openaiKey ||
    (!!conn?.cloudflareApiToken && !!conn?.cloudflareAccountId)
  const main = useMemo(() => {
    if (path === '/new') {
      if (conn !== null && !hasModelKey) return <Onboarding ua={ua} />
      return <NewSession ua={ua} onOpenSettings={() => setSettingsOpen(true)} />
    }
    if (sessionId) return <LiveChatView key={sessionId} sessionId={sessionId} />
    return <EmptyState onNew={() => navigate('/new')} hasSessions={ua.sessions.length > 0} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, sessionId, ua.sessions.length, conn, hasModelKey])

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
