/**
 * Pure mapping: OpenCode SSE events → Agents AgentEvents.
 *
 * OpenCode event shapes (from @opencode-ai/sdk/dist/v2/gen/types.gen.d.ts):
 *  - message.part.updated → properties.part (Part; :5319). part.type ∈ text|reasoning|tool|
 *    step-finish|patch|file|subtask|agent|… ; ToolState at part.state (:337-388).
 *  - message.updated → properties.info (Message; :5303), assistant carries tokens/cost/error.
 *  - todo.updated → properties.todos (:5869). session.idle/session.error → :5958/:5728.
 *  - permission.asked (:5884) / permission.v2.asked (:5764).
 * The mapper is stateful only to emit `turn.start` once per assistant message id.
 */
import type {
  AgentEvent,
  NormPart,
  NormToolState,
  NormTodo,
  NormUsage,
  TurnStatus,
} from '~shared/agent'

type Any = Record<string, unknown>
const obj = (v: unknown): Any => (v && typeof v === 'object' ? (v as Any) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

function mapUsage(tokens: Any, cost: unknown): NormUsage {
  const cache = obj(tokens.cache)
  return {
    input: num(tokens.input),
    output: num(tokens.output),
    reasoning: num(tokens.reasoning) || undefined,
    cacheRead: num(cache.read) || undefined,
    cacheWrite: num(cache.write) || undefined,
    cost: typeof cost === 'number' ? cost : undefined,
  }
}

function mapToolState(state: Any): NormToolState {
  const status = (str(state.status) ?? 'pending') as NormToolState['status']
  const time = obj(state.time)
  return {
    status,
    input: obj(state.input),
    title: str(state.title),
    output: status === 'completed' ? str(state.output) : undefined,
    error: status === 'error' ? str(state.error) : undefined,
    startedAt: num(time.start) || undefined,
    endedAt: num(time.end) || undefined,
  }
}

function mapAssistantStatus(info: Any): TurnStatus {
  if (info.error) {
    const name = str(obj(info.error).name)
    return name === 'MessageAbortedError' ? 'aborted' : 'error'
  }
  return obj(info.time).completed ? 'complete' : 'streaming'
}

/** Map a raw OpenCode Part (from session.messages) → a NormPart, or null if not renderable. */
export function mapPart(part: Any): NormPart | null {
  const pt = str(part.type)
  const id = str(part.id) ?? `${str(part.messageID) ?? 'm'}:${pt}`
  if (pt === 'text' && typeof part.text === 'string') {
    return { kind: 'text', id, text: part.text }
  }
  if (pt === 'reasoning' && typeof part.text === 'string') {
    return { kind: 'reasoning', id, text: part.text }
  }
  if (pt === 'tool') {
    return { kind: 'tool', id, callId: str(part.callID) ?? id, name: str(part.tool) ?? 'tool', state: mapToolState(obj(part.state)) }
  }
  if (pt === 'step-finish') {
    return { kind: 'step', id, usage: mapUsage(obj(part.tokens), part.cost) }
  }
  if (pt === 'patch') {
    const files = (Array.isArray(part.files) ? part.files : []).map((f) => ({ path: String(f) }))
    return { kind: 'diff', id, files }
  }
  if (pt === 'subtask' || pt === 'agent') {
    return { kind: 'subtask', id, agent: str(part.agent) ?? str(part.name) ?? 'agent', description: str(part.description) }
  }
  return null
}

/** Usage from an assistant message info (session.messages). */
export function usageFromInfo(info: Any): NormUsage {
  return mapUsage(obj(info.tokens), info.cost)
}

/** Is an assistant message finished (has a completion time or an error)? */
export function isAssistantComplete(info: Any): boolean {
  return !!obj(info.time).completed || !!info.error
}

export class OpencodeMapper {
  private started = new Set<string>()

  /** Ensure a `turn.start` is emitted before any part for that assistant message. */
  private ensureTurn(out: AgentEvent[], turnId: string, model?: { providerId?: string; modelId?: string }) {
    if (this.started.has(turnId)) return
    this.started.add(turnId)
    out.push({
      t: 'turn.start',
      turn: {
        id: turnId,
        role: 'assistant',
        createdAt: Date.now(),
        status: 'streaming',
        model,
        parts: [],
      },
    })
  }

  map(ev: Any): AgentEvent[] {
    const out: AgentEvent[] = []
    const type = str(ev.type)
    const props = obj(ev.properties)

    if (type === 'message.updated') {
      const info = obj(props.info)
      if (str(info.role) !== 'assistant') return out
      const turnId = str(info.id)
      if (!turnId) return out
      const model = { providerId: str(info.providerID), modelId: str(info.modelID) }
      this.ensureTurn(out, turnId, model)
      const usage = mapUsage(obj(info.tokens), info.cost)
      const status = mapAssistantStatus(info)
      out.push({
        t: 'turn.update',
        id: turnId,
        patch: {
          status,
          usage,
          model,
          completedAt: obj(info.time).completed ? num(obj(info.time).completed) : undefined,
          error: info.error
            ? { name: str(obj(info.error).name) ?? 'error', message: str(obj(obj(info.error).data).message) ?? 'Agent error' }
            : undefined,
        },
      })
      out.push({ t: 'usage', usage })
      return out
    }

    if (type === 'message.part.updated') {
      const part = obj(props.part)
      const turnId = str(part.messageID)
      if (!turnId) return out
      this.ensureTurn(out, turnId)
      const pt = str(part.type)
      const id = str(part.id) ?? `${turnId}:${pt}`

      if (pt === 'text' && typeof part.text === 'string') {
        out.push({ t: 'part.upsert', turnId, part: { kind: 'text', id, text: part.text, streaming: true } })
      } else if (pt === 'reasoning' && typeof part.text === 'string') {
        out.push({ t: 'part.upsert', turnId, part: { kind: 'reasoning', id, text: part.text, streaming: true } })
      } else if (pt === 'tool') {
        const p: NormPart = {
          kind: 'tool',
          id,
          callId: str(part.callID) ?? id,
          name: str(part.tool) ?? 'tool',
          state: mapToolState(obj(part.state)),
        }
        out.push({ t: 'part.upsert', turnId, part: p })
      } else if (pt === 'step-finish') {
        const usage = mapUsage(obj(part.tokens), part.cost)
        out.push({ t: 'part.upsert', turnId, part: { kind: 'step', id, usage } })
        out.push({ t: 'usage', usage })
      } else if (pt === 'patch') {
        const files = (Array.isArray(part.files) ? part.files : []).map((f) => ({ path: String(f) }))
        out.push({ t: 'part.upsert', turnId, part: { kind: 'diff', id, files } })
      } else if (pt === 'subtask' || pt === 'agent') {
        out.push({
          t: 'part.upsert',
          turnId,
          part: { kind: 'subtask', id, agent: str(part.agent) ?? str(part.name) ?? 'agent', description: str(part.description) },
        })
      }
      return out
    }

    if (type === 'todo.updated') {
      const todos: NormTodo[] = (Array.isArray(props.todos) ? props.todos : []).map((t) => {
        const td = obj(t)
        return {
          content: str(td.content) ?? '',
          status: (str(td.status) ?? 'pending') as NormTodo['status'],
          priority: str(td.priority) as NormTodo['priority'],
        }
      })
      out.push({ t: 'todos', todos })
      return out
    }

    if (type === 'permission.asked' || type === 'permission.v2.asked') {
      const source = obj(props.tool ?? props.source)
      out.push({
        t: 'permission.ask',
        permission: {
          id: str(props.id) ?? crypto.randomUUID(),
          title: str(props.permission) ?? str(props.action) ?? 'Allow this action?',
          toolCallId: str(source.callID),
          metadata: obj(props.metadata),
        },
      })
      return out
    }

    if (type === 'session.error') {
      const error = obj(props.error)
      out.push({ t: 'error', message: str(obj(error.data).message) ?? str(error.name) ?? 'Agent error' })
      return out
    }

    return out
  }

  /** Reset per-turn state (called at the start of each user turn). */
  reset() {
    this.started.clear()
  }
}

/** Is this OpenCode event the "turn is done" signal for the given session? */
export function isSessionIdle(ev: Any, sessionId: string): boolean {
  if (str(ev.type) !== 'session.idle') return false
  const props = obj(ev.properties)
  const sid = str(props.sessionID)
  return !sid || sid === sessionId
}
