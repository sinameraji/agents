import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useAgent } from 'agents/react'
import type { AgentStep, Message } from '~shared/protocol'

interface SessionMeta {
  id: string
  name: string
  repo: string
  branch: string
  harness: string
  provider: string
  model: string
  status: string
  region: string
  createdAt: string
  lastActivity: string
}
interface SessionState {
  meta: SessionMeta | null
  usage: { tokensIn: number; tokensOut: number; costUsd: number }
  bridge: 'down' | 'booting' | 'up'
}

// --- message reducer --------------------------------------------------------------------------
type Action =
  | { type: 'hydrate'; messages: Message[] }
  | { type: 'upsert'; message: Message }
  | { type: 'text'; messageId: string; text: string }
  | { type: 'step'; messageId: string; step: AgentStep }

function upsertStep(steps: AgentStep[] | undefined, step: AgentStep): AgentStep[] {
  const list = steps ? [...steps] : []
  const i = list.findIndex((s) => s.id === step.id)
  if (i >= 0) list[i] = { ...list[i], ...step }
  else list.push(step)
  return list
}

function reducer(state: Message[], action: Action): Message[] {
  switch (action.type) {
    case 'hydrate': {
      const byId = new Map(action.messages.map((m) => [m.id, m]))
      // keep any optimistic messages not yet persisted
      for (const m of state) if (!byId.has(m.id)) byId.set(m.id, m)
      return [...byId.values()]
    }
    case 'upsert': {
      const i = state.findIndex((m) => m.id === action.message.id)
      if (i >= 0) {
        const next = [...state]
        next[i] = { ...next[i], ...action.message }
        return next
      }
      return [...state, action.message]
    }
    case 'text':
      return state.map((m) => (m.id === action.messageId ? { ...m, text: action.text } : m))
    case 'step':
      return state.map((m) =>
        m.id === action.messageId ? { ...m, steps: upsertStep(m.steps, action.step) } : m,
      )
    default:
      return state
  }
}

export interface SessionApi {
  meta: SessionMeta | null
  usage: SessionState['usage']
  bridge: SessionState['bridge']
  messages: Message[]
  connected: boolean
  send: (text: string) => Promise<void>
  stop: () => Promise<void>
  setModel: (id: string) => Promise<void>
  error: string | null
}

/** Connect to a SessionAgent DO: synced meta/usage state + streamed message events. */
export function useSession(sessionId: string): SessionApi {
  const [messages, dispatch] = useReducer(reducer, [])
  const [sync, setSync] = useState<SessionState>({
    meta: null,
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
    bridge: 'down',
  })
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agent = useAgent<SessionState>({
    agent: 'session-agent',
    name: sessionId,
    onStateUpdate: (s) => setSync(s),
  })
  const agentRef = useRef(agent)
  agentRef.current = agent

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
      } catch {
        return
      }
      switch (data.t) {
        case 'message.upsert':
          dispatch({ type: 'upsert', message: data.message as Message })
          break
        case 'text.set':
          dispatch({ type: 'text', messageId: data.messageId as string, text: data.text as string })
          break
        case 'step.upsert':
          dispatch({ type: 'step', messageId: data.messageId as string, step: data.step as AgentStep })
          break
        case 'error':
          setError(data.message as string)
          break
      }
    }
    agent.addEventListener('message', onMsg)
    let alive = true
    agent.ready
      .then(() => {
        if (!alive) return
        setConnected(true)
        return agentRef.current.stub.getMessages() as Promise<Message[]>
      })
      .then((msgs) => msgs && dispatch({ type: 'hydrate', messages: msgs }))
      .catch(() => {})
    return () => {
      alive = false
      agent.removeEventListener('message', onMsg)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const send = useCallback(
    async (text: string) => {
      setError(null)
      const messageId = `u-${crypto.randomUUID()}`
      // optimistic echo with the SAME id the server will use, so its upsert replaces this
      dispatch({
        type: 'upsert',
        message: { id: messageId, role: 'user', createdAt: new Date().toISOString(), text },
      })
      await agentRef.current.stub.sendMessage({ text, messageId })
    },
    [],
  )
  const stop = useCallback(async () => {
    await agentRef.current.stub.stop()
  }, [])
  const setModel = useCallback(async (id: string) => {
    await agentRef.current.stub.setModel(id)
  }, [])

  return {
    meta: sync.meta,
    usage: sync.usage,
    bridge: sync.bridge,
    messages,
    connected,
    send,
    stop,
    setModel,
    error,
  }
}
