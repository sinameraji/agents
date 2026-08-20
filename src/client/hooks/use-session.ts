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
import type { Harness, HarnessAgent, Provider, SessionMode } from '~shared/protocol'

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
  /** Named agents the running harness advertises. Absent until the harness has booted once. */
  agents?: HarnessAgent[]
  /** Boot narration ("Cloning owner/repo"), present only while the session is starting up. */
  phase?: string
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
  /** OpenCode's agent roster, empty until the harness has booted at least once. */
  agents: HarnessAgent[]
  /** What the session is doing while it boots, for the working indicator. */
  phase?: string
  turns: NormTurn[]
  todos: NormTodo[]
  permissions: NormPermission[]
  connected: boolean
  send: (
    text: string,
    attachments?: { key: string; name: string; size: number; mime?: string }[],
    agent?: string,
  ) => Promise<void>
  /** Run a '!' line as a direct shell command (no model turn). OpenCode sessions only. */
  runShell: (command: string) => Promise<string>
  /** Mid-turn steering: native (no abort) where the harness supports it, stop + re-prompt otherwise. */
  steer: (text: string, attachments?: { key: string; name: string; size: number; mime?: string }[]) => Promise<void>
  stop: () => Promise<void>
  setModel: (id: string) => Promise<void>
  setMode: (mode: SessionMode) => Promise<void>
  respondPermission: (id: string, reply: PermissionReply, note?: string) => Promise<void>
  runCommand: (name: string) => Promise<string>
  bridgeCommand: (name: string) => Promise<string>
  harnessCommands: () => Promise<{ name: string; description?: string; takesArgs?: boolean }[]>
  runCustomCommand: (name: string, args?: string) => Promise<string>
  rename: (name: string) => Promise<void>
  fork: () => Promise<{ id?: string; note: string }>
  gitStatus: () => Promise<{ repo: boolean; branch: string; dirty: number; remote: string | null; lastCommit: string | null }>
  gitExport: (input: { message?: string; branch?: string; openPr?: boolean }) => Promise<{ ok: boolean; note: string; branchUrl?: string; prUrl?: string }>
  gitChanges: () => Promise<{ repo: boolean; changes: { path: string; status: 'M' | 'A' | 'D' | 'R' | '?' }[] }>
  gitDiff: (path: string) => Promise<{ diff: string }>
  listFiles: (path?: string) => Promise<{ name: string; path: string; isDirectory: boolean; size: number }[]>
  readFile: (path: string) => Promise<string | null>
  writeFile: (path: string, content: string) => Promise<boolean>
  checkPorts: (ports: number[]) => Promise<{ alive: number[] }>
  exposePort: (
    port: number,
    hostname?: string,
  ) => Promise<{ url: string | null; reason?: 'nothing-listening' | 'expose-failed' | 'reserved-port' | 'needs-domain' }>
}

/** Subscribe to a SessionAgent: synced meta/status/usage + the normalized AgentEvent transcript stream. */
export function useSession(sessionId: string): SessionApi {
  const [transcript, dispatch] = useReducer(reducer, undefined, emptyTranscript)
  const [sync, setSync] = useState<SyncState>({
    meta: null,
    status: 'idle',
    mode: 'build',
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
    agents: [],
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
      if ((data as { t?: string }).t === 'reset') dispatch({ type: 'hydrate', state: { turns: [], todos: [], permissions: [] } })
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

  const send = useCallback(async (
    text: string,
    attachments?: { key: string; name: string; size: number; mime?: string }[],
    agent?: string,
  ) => {
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
    await agentRef.current.stub.sendMessage({ text, messageId, attachments, agent })
  }, [])

  const steer = useCallback(async (text: string, attachments?: { key: string; name: string; size: number; mime?: string }[]) => {
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
    await agentRef.current.stub.steer({ text, messageId, attachments })
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
  const runCommand = useCallback(async (name: string) => {
    const r = (await (agentRef.current.stub as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]()) as { note?: string }
    return r?.note ?? 'Done.'
  }, [])
  const harnessCommands = useCallback(async () => {
    const r = (await agentRef.current.stub.harnessCommands()) as {
      commands: { name: string; description?: string; takesArgs?: boolean }[]
    }
    return r.commands
  }, [])
  const runCustomCommand = useCallback(async (name: string, args?: string) => {
    const r = (await agentRef.current.stub.runCustomCommand(name, args ?? '')) as { note?: string }
    return r?.note ?? 'Done.'
  }, [])
  const runShell = useCallback(async (command: string) => {
    // No optimistic echo: the DO writes both the '!command' user turn and the terminal part, so
    // a local one would duplicate. The round trip is a single RPC, not a model call.
    const r = (await agentRef.current.stub.runShell(command)) as { note?: string }
    return r?.note ?? 'Done.'
  }, [])
  const bridgeCommand = useCallback(async (name: string) => {
    const r = (await agentRef.current.stub.bridgeCommand(name)) as { note?: string }
    return r?.note ?? 'Done.'
  }, [])
  const rename = useCallback(async (name: string) => {
    await agentRef.current.stub.rename(name)
  }, [])
  const fork = useCallback(async () => {
    const r = (await agentRef.current.stub.fork()) as { id?: string; note?: string }
    return { id: r.id, note: r.note ?? 'Forked.' }
  }, [])
  const gitStatus = useCallback(async () => {
    return (await agentRef.current.stub.gitStatus()) as { repo: boolean; branch: string; dirty: number; remote: string | null; lastCommit: string | null }
  }, [])
  const gitExport = useCallback(async (input: { message?: string; branch?: string; openPr?: boolean }) => {
    return (await agentRef.current.stub.gitExport(input)) as { ok: boolean; note: string; branchUrl?: string; prUrl?: string }
  }, [])
  const gitChanges = useCallback(async () => {
    return (await agentRef.current.stub.gitChanges()) as { repo: boolean; changes: { path: string; status: 'M' | 'A' | 'D' | 'R' | '?' }[] }
  }, [])
  const gitDiff = useCallback(async (path: string) => {
    return (await agentRef.current.stub.gitDiff(path)) as { diff: string }
  }, [])
  const listFiles = useCallback(async (path?: string) => {
    const r = (await agentRef.current.stub.listFiles(path)) as { files: { name: string; path: string; isDirectory: boolean; size: number }[] }
    return r.files
  }, [])
  const readFile = useCallback(async (path: string) => {
    const r = (await agentRef.current.stub.readFile(path)) as { content: string | null }
    return r.content
  }, [])
  const writeFile = useCallback(async (path: string, content: string) => {
    const r = (await agentRef.current.stub.writeFile(path, content)) as { ok: boolean }
    return r.ok
  }, [])
  const checkPorts = useCallback(async (ports: number[]) => {
    return (await agentRef.current.stub.checkPorts(ports)) as { alive: number[] }
  }, [])
  const exposePort = useCallback(async (port: number, hostname?: string) => {
    return (await agentRef.current.stub.exposePort(port, hostname)) as {
      url: string | null
      reason?: 'nothing-listening' | 'expose-failed' | 'reserved-port' | 'needs-domain'
    }
  }, [])

  return {
    meta: sync.meta,
    status: sync.status,
    mode: sync.mode,
    usage: sync.usage,
    agents: sync.agents ?? [],
    phase: sync.phase,
    turns: transcript.turns,
    todos: transcript.todos,
    permissions: transcript.permissions,
    connected,
    send,
    runShell,
    steer,
    stop,
    setModel,
    setMode,
    respondPermission,
    runCommand,
    bridgeCommand,
    harnessCommands,
    runCustomCommand,
    rename,
    fork,
    gitStatus,
    gitExport,
    gitChanges,
    gitDiff,
    listFiles,
    readFile,
    writeFile,
    checkPorts,
    exposePort,
  }
}
