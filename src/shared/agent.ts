/**
 * Dreamweav's harness-agnostic agent activity model.
 *
 * Real coding agents (OpenCode, Claude Code, Codex, Cursor, Zed…) model a turn as an ORDERED
 * stream of typed "parts" — text, reasoning, tool calls (with live status + result), todos, diffs,
 * terminal output, errors, usage — each with a pending→streaming→complete lifecycle. We normalize
 * every harness onto this one model so the UI is written once.
 *
 * Shapes are derived from the OpenCode SDK types (@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts):
 * Part union :474, ToolState :337-388, StepFinishPart :408, AssistantMessage :213, Todo :490,
 * event union :4, EventMessagePartUpdated :5319, EventTodoUpdated :5869, permissions :5764/:5884.
 */

/** Authoritative session status, driven by the harness — never inferred on the client. */
export type SessionStatus = 'provisioning' | 'idle' | 'booting' | 'busy' | 'error'

export type TurnRole = 'user' | 'assistant'
export type TurnStatus = 'streaming' | 'complete' | 'error' | 'aborted'

export interface NormUsage {
  input: number
  output: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: number
}

export type ToolStatus = 'pending' | 'running' | 'completed' | 'error'

export interface NormToolState {
  status: ToolStatus
  /** Tool arguments (file path, command, pattern, url, …). */
  input?: Record<string, unknown>
  /** Human label the harness assigns (e.g. the file being edited). */
  title?: string
  /** Result text (completed). */
  output?: string
  /** Failure message (error). */
  error?: string
  metadata?: Record<string, unknown>
  startedAt?: number
  endedAt?: number
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export interface NormTodo {
  content: string
  status: TodoStatus
  priority?: 'high' | 'medium' | 'low'
}

export interface NormDiffFile {
  path: string
  additions?: number
  deletions?: number
  patch?: string
}

/** A single renderable unit inside a turn. `id` is stable so streams patch in place. */
export type NormPart =
  | { kind: 'text'; id: string; text: string; streaming?: boolean }
  | { kind: 'reasoning'; id: string; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; callId: string; name: string; state: NormToolState }
  | { kind: 'todos'; id: string; todos: NormTodo[] }
  | { kind: 'diff'; id: string; files: NormDiffFile[] }
  | { kind: 'terminal'; id: string; command?: string; output?: string; exitCode?: number }
  | { kind: 'step'; id: string; usage?: NormUsage }
  | { kind: 'subtask'; id: string; childSessionId?: string; agent: string; description?: string }
  | { kind: 'error'; id: string; name: string; message: string }

export interface NormTurn {
  id: string
  role: TurnRole
  createdAt: number
  completedAt?: number
  status: TurnStatus
  model?: { providerId?: string; modelId?: string }
  usage?: NormUsage
  error?: { name: string; message: string }
  parts: NormPart[]
}

export type PermissionReply = 'once' | 'always' | 'reject'
export interface NormPermission {
  id: string
  title: string
  toolCallId?: string
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/**
 * Wire events broadcast server→browser (and applied by the SessionAgent to its own persisted
 * transcript). The same reducer (`agent-reduce.ts`) runs on both sides.
 */
export type AgentEvent =
  | { t: 'turn.start'; turn: NormTurn }
  | { t: 'turn.update'; id: string; patch: Partial<Omit<NormTurn, 'id' | 'parts'>> }
  | { t: 'part.upsert'; turnId: string; part: NormPart }
  | { t: 'part.delta'; turnId: string; partId: string; field: 'text' | 'reasoning'; delta: string }
  | { t: 'part.remove'; turnId: string; partId: string }
  | { t: 'todos'; todos: NormTodo[] }
  | { t: 'permission.ask'; permission: NormPermission }
  | { t: 'permission.resolve'; id: string }
  | { t: 'status'; status: SessionStatus }
  | { t: 'usage'; usage: NormUsage }
  | { t: 'error'; message: string }

/** What the client keeps in sync from the transcript stream. */
export interface TranscriptState {
  turns: NormTurn[]
  todos: NormTodo[]
  permissions: NormPermission[]
}

export function emptyTranscript(): TranscriptState {
  return { turns: [], todos: [], permissions: [] }
}
