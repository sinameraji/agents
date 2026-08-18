import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useAgent } from 'agents/react'
import { applyEvent, emptyTranscript } from '~shared/agent-reduce'
import type {
  AgentEvent,
  NormPermission,
  NormTodo,
  NormTurn,
  PermissionReply,
  SessionStatus,
  TranscriptState,
} from '~shared/agent'
import type { Harness, Provider, SessionMode } from '~shared/protocol'

interface SessionMeta {
  id: string
  name: string
  repo: string
  branch: string
  harness: Harness
  provider: Provider
  model: string
  region: string
  createdAt: string
  lastActivity: string
}
interface SyncState {
  meta: SessionMeta | null
  status: SessionStatus
  mode: SessionMode
  usage: { tokensIn: number; tokensOut: number; costUsd: number }
}

type Action = { type: 'hydrate'; state: TranscriptState } | { type: 'event'; event: AgentEvent }

function reducer(state: TranscriptState, action: Action): TranscriptState {
  if (action.type === 'hydrate') return action.state
  return applyEvent(state, action.event)
}

export interface SessionApi {
  meta: SessionMeta | null
  status: SessionStatus
  mode: SessionMode
  usage: SyncState['usage']
  turns: NormTurn[]
  todos: NormTodo[]
  permissions: NormPermission[]
  connected: boolean
  send: (text: string) => Promise<void>
  stop: () => Promise<void>
  setModel: (id: string) => Promise<void>
  setMode: (mode: SessionMode) => Promise<void>
  respondPermission: (id: string, reply: PermissionReply, note?: string) => Promise<void>
}

/** Subscribe to a SessionAgent: synced meta/status/usage + the normalized AgentEvent transcript stream. */
export function useSession(sessionId: string): SessionApi {
  const [transcript, dispatch] = useReducer(reducer, undefined, emptyTranscript)
  const [sync, setSync] = useState<SyncState>({
    meta: null,
    status: 'idle',
    mode: 'build',
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
  })
  const [connected, setConnected] = useState(false)

  const agent = useAgent<SyncState>({
    agent: 'session-agent',
    name: sessionId,
    onStateUpdate: (s) => setSync(s),
  })
  const agentRef = useRef(agent)
  agentRef.current = agent

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      let data: { t?: string; event?: AgentEvent }
      try {
        data = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
      } catch {
        return
      }
      if (data.t === 'agent' && data.event) dispatch({ type: 'event', event: data.event })
    }
    agent.addEventListener('message', onMsg)
    let alive = true
    agent.ready
      .then(() => {
        if (!alive) return
        setConnected(true)
        return agentRef.current.stub.getTurns() as Promise<
          TranscriptState & { status: SessionStatus }
        >
      })
      .then((res) => {
        if (!res || !alive) return
        dispatch({ type: 'hydrate', state: { turns: res.turns, todos: res.todos, permissions: res.permissions } })
      })
      .catch(() => {})
    return () => {
      alive = false
      agent.removeEventListener('message', onMsg)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const send = useCallback(async (text: string) => {
    const messageId = `u-${crypto.randomUUID()}`
    // optimistic echo with the SAME id the server will use, so its turn.start replaces this
    dispatch({
      type: 'event',
      event: {
        t: 'turn.start',
        turn: {
          id: messageId,
          role: 'user',
          createdAt: Date.now(),
          status: 'complete',
          parts: [{ kind: 'text', id: `${messageId}:text`, text }],
        },
      },
    })
    await agentRef.current.stub.sendMessage({ text, messageId })
  }, [])

  const stop = useCallback(async () => {
    await agentRef.current.stub.stop()
  }, [])
  const setModel = useCallback(async (id: string) => {
    await agentRef.current.stub.setModel(id)
  }, [])
  const setMode = useCallback(async (mode: SessionMode) => {
    await agentRef.current.stub.setMode(mode)
  }, [])
  const respondPermission = useCallback(async (id: string, reply: PermissionReply, note?: string) => {
    await agentRef.current.stub.respondPermission(id, reply, note)
  }, [])

  return {
    meta: sync.meta,
    status: sync.status,
    mode: sync.mode,
    usage: sync.usage,
    turns: transcript.turns,
    todos: transcript.todos,
    permissions: transcript.permissions,
    connected,
    send,
    stop,
    setModel,
    setMode,
    respondPermission,
  }
}
