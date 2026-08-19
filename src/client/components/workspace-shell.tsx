import { useMemo, useState } from 'react'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { LoginDialog } from './login-dialog'
import { Landing } from './landing'
import { useConfig } from '@/hooks/use-config'
import { DEFAULT_SETTINGS } from '~shared/protocol'
import type { UserAgentApi } from '@/hooks/use-user-agent'

export function WorkspaceShell() {
  const { config } = useConfig()
  const { me, loading } = useMe()
  if (!config || loading) return <FullScreen>Connecting…</FullScreen>
  // The public host is a storefront with ONE call to action: deploy your own. The app itself
  // lives on each owner's host (OWNER_HOST / workers.dev / their custom domain).
  if (config.mode === 'landing') return <Landing />
  if (!me) return <GuestShell />
  return <Shell userId={me.id} email={me.email} />
}

/** The app IS the homepage: guests browse the real UI; consequential actions raise the login dialog. */
function GuestShell() {
  const { navigate } = useRouter()
  const [loginOpen, setLoginOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const ask = <T,>(value: T): Promise<T> => {
    setLoginOpen(true)
    return Promise.resolve(value)
  }
  const ua: UserAgentApi = {
    sessions: [],
    settings: DEFAULT_SETTINGS,
    connections: {
      openrouterKey: null, cloudflareAccountId: null, cloudflareApiToken: null,
      cloudflareGatewayId: null, anthropicKey: null, openaiKey: null, githubPat: null,
    },
    connected: false,
    refresh: async () => {},
    createSession: () => ask('').then(() => Promise.reject(new Error('Sign in to create a session.'))),
    deleteSession: () => ask(undefined),
    renameSession: () => ask(undefined),
    markRead: async () => {},
    saveSettings: () => ask(undefined),
    ensureAiGateway: () => ask({ ok: false as const, note: 'Sign in first.' }),
    listAiGateways: async () => ({ ok: false, gateways: [], note: 'Sign in to list your gateways.' }),
    createAiGateway: () => ask({ ok: false as const, note: 'Sign in first.' }),
    setupCustomDomain: () => ask({ ok: false as const, note: 'Sign in first.' }),
  }

  const sidebar = (
    <SessionSidebar
      sessions={[]}
      activeId=""
      email="guest"
      guest
      onSignIn={() => setLoginOpen(true)}
      onSelect={() => setLoginOpen(true)}
      onNew={() => {
        setDrawerOpen(false)
        navigate('/new')
      }}
      onOpenSettings={() => {
        setDrawerOpen(false)
        setSettingsOpen(true)
      }}
      onDelete={() => setLoginOpen(true)}
      onRename={() => setLoginOpen(true)}
    />
  )

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
        <Button variant="ghost" size="icon-sm" aria-label="Open menu" title="Sessions & settings" onClick={() => setDrawerOpen(true)}>
          <Menu className="size-5" />
        </Button>
        <span className="text-sm font-semibold">Dreamweav</span>
      </div>
      <div className="hidden w-72 shrink-0 border-r border-border md:block">{sidebar}</div>
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[85vw] border-r border-border bg-background shadow-2xl">{sidebar}</div>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <Onboarding ua={ua} guest onRequireAuth={() => setLoginOpen(true)} />
      </div>
      {settingsOpen && <SettingsDialog ua={ua} onClose={() => setSettingsOpen(false)} onRequireAuth={() => setLoginOpen(true)} />}
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
    </div>
  )
}

function Shell({ userId, email }: { userId: string; email: string }) {
  const ua = useUserAgent(userId)
  const { path, navigate } = useRouter()
  const sessionId = useSessionRoute()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'providers' | 'harness' | 'git'>('providers')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const openSettings = (tab?: 'providers' | 'harness' | 'git') => {
    setSettingsTab(tab ?? 'providers')
    setSettingsOpen(true)
  }

  // The wizard is only for accounts that have never been set up: no sessions AND no credentials.
  // A configured user with zero sessions (e.g. they deleted them all) goes straight to the
  // create-session form with their saved defaults.
  const conn = ua.connections
  const configured =
    !!conn?.openrouterKey || !!conn?.anthropicKey || !!conn?.openaiKey ||
    (!!conn?.cloudflareApiToken && !!conn?.cloudflareAccountId)
  const firstTime = conn !== null && ua.sessions.length === 0 && !configured
  const main = useMemo(() => {
    if (sessionId) return <LiveChatView key={sessionId} sessionId={sessionId} />
    if (path === '/new') {
      return firstTime ? <Onboarding ua={ua} /> : <NewSession ua={ua} onOpenSettings={openSettings} />
    }
    if (firstTime) return <Onboarding ua={ua} />
    if (ua.sessions.length === 0 && conn !== null) {
      return <NewSession ua={ua} onOpenSettings={openSettings} />
    }
    return <EmptyState onNew={() => navigate('/new')} hasSessions={ua.sessions.length > 0} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, sessionId, ua.sessions.length, conn, firstTime])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('dw:sidebarCollapsed') === '1',
  )
  const toggleSidebar = () =>
    setSidebarCollapsed((v) => {
      localStorage.setItem('dw:sidebarCollapsed', v ? '0' : '1')
      return !v
    })

  // The mobile drawer always renders expanded; only the desktop rail collapses.
  const sidebar = (collapsed: boolean) => (
    <SessionSidebar
      collapsed={collapsed}
      onToggleCollapse={toggleSidebar}
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
      {/* Mobile top bar, the only chrome small screens get */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
        <Button variant="ghost" size="icon-sm" aria-label="Open menu" title="Sessions & settings" onClick={() => setDrawerOpen(true)}>
          <Menu className="size-5" />
        </Button>
        <span className="text-sm font-semibold">Dreamweav</span>
      </div>

      <div className={cn('hidden shrink-0 border-r border-border md:block', sidebarCollapsed ? 'w-12' : 'w-72')}>
        {sidebar(sidebarCollapsed)}
      </div>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-background/70 backdrop-blur-sm" />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[85vw] border-r border-border bg-background shadow-2xl">
            {sidebar(false)}
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">{main}</div>
      {settingsOpen && <SettingsDialog ua={ua} onClose={() => setSettingsOpen(false)} initialTab={settingsTab} />}
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
