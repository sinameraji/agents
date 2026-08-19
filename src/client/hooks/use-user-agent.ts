import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgent } from 'agents/react'
import type {
  Harness,
  MaskedConnections,
  Provider,
  SessionSource,
  SessionSummary,
  UserSettings,
} from '~shared/protocol'
import { DEFAULT_SETTINGS } from '~shared/protocol'

export interface UserAgentApi {
  sessions: SessionSummary[]
  settings: UserSettings
  connections: MaskedConnections | null
  connected: boolean
  refresh: () => Promise<void>
  createSession: (input: {
    source: SessionSource
    name?: string
    harness?: Harness
    provider?: Provider
    model?: string
  }) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  markRead: (id: string) => Promise<void>
  saveSettings: (input: {
    settings?: Partial<UserSettings>
    connections?: Partial<Record<keyof MaskedConnections, string>>
  }) => Promise<void>
  ensureAiGateway: () => Promise<{ ok: boolean; gatewayId?: string; note?: string }>
  listAiGateways: () => Promise<{ ok: boolean; gateways: string[]; note?: string }>
  createAiGateway: (name: string) => Promise<{ ok: boolean; gatewayId?: string; note?: string }>
}

/** Connect to the per-user UserAgent DO for the sessions index + settings. */
export function useUserAgent(userId: string): UserAgentApi {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [connections, setConnections] = useState<MaskedConnections | null>(null)
  const [connected, setConnected] = useState(false)

  const agent = useAgent({ agent: 'user-agent', name: userId })
  const agentRef = useRef(agent)
  agentRef.current = agent

  const refresh = useCallback(async () => {
    const [list, s] = await Promise.all([
      agentRef.current.stub.listSessions() as Promise<SessionSummary[]>,
      agentRef.current.stub.getSettings() as Promise<{
        settings: UserSettings
        connections: MaskedConnections
      }>,
    ])
    setSessions(list)
    setSettings(s.settings)
    setConnections(s.connections)
  }, [])

  useEffect(() => {
    let alive = true
    agent.ready
      .then(() => alive && setConnected(true))
      .then(() => refresh())
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Keep the index fresh: statuses/costs change server-side (turns, watchdog) and sessions can be
  // created by the server itself (/fork), so poll lightly instead of trusting mount-time data.
  useEffect(() => {
    if (!connected) return
    let inFlight = false
    const t = setInterval(() => {
      if (inFlight) return
      inFlight = true
      void refresh()
        .catch(() => {})
        .finally(() => {
          inFlight = false
        })
    }, 5000)
    return () => clearInterval(t)
  }, [connected, refresh])

  const ensureAiGateway = useCallback(async () => {
    const r = (await agentRef.current.stub.ensureAiGateway()) as { ok: boolean; gatewayId?: string; note?: string }
    await refresh()
    return r
  }, [refresh])

  const listAiGateways = useCallback(async () => {
    return (await agentRef.current.stub.listAiGateways()) as { ok: boolean; gateways: string[]; note?: string }
  }, [])
  const createAiGateway = useCallback(async (name: string) => {
    const r = (await agentRef.current.stub.createAiGateway(name)) as { ok: boolean; gatewayId?: string; note?: string }
    await refresh()
    return r
  }, [refresh])

  const createSession: UserAgentApi['createSession'] = useCallback(async (input) => {
    const { id } = (await agentRef.current.stub.createSession(input)) as { id: string }
    await refresh()
    return id
  }, [refresh])

  const deleteSession = useCallback(
    async (id: string) => {
      await agentRef.current.stub.deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    },
    [],
  )
  const renameSession = useCallback(
    async (id: string, name: string) => {
      await agentRef.current.stub.renameSession(id, name)
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
    },
    [],
  )
  const markRead = useCallback(async (id: string) => {
    await agentRef.current.stub.markRead(id)
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread: false } : s)))
  }, [])
  const saveSettings: UserAgentApi['saveSettings'] = useCallback(async (input) => {
    const s = (await agentRef.current.stub.saveSettings(input)) as {
      settings: UserSettings
      connections: MaskedConnections
    }
    setSettings(s.settings)
    setConnections(s.connections)
  }, [])

  return {
    sessions,
    settings,
    connections,
    connected,
    refresh,
    createSession,
    deleteSession,
    renameSession,
    markRead,
    saveSettings,
    ensureAiGateway,
    listAiGateways,
    createAiGateway,
  }
}
