/**
 * The single reducer that turns an AgentEvent stream into transcript state. Runs identically on the
 * server (SessionAgent persistence) and the client (rendering), so both stay consistent.
 *
 * Invariants:
 *  - Parts are keyed by `id`; tool parts additionally track `callId`. `part.upsert` replaces by id.
 *  - `text`/`reasoning` accumulate via `part.delta`, then a final `part.upsert` clears `streaming`.
 *  - Todos are whole-list replace.
 *  - Usage is last-writer-wins on the active (last) turn.
 */
import type { AgentEvent, NormPart, NormTurn, TranscriptState } from './agent'
import { emptyTranscript } from './agent'

function upsertPart(parts: NormPart[], part: NormPart): NormPart[] {
  const i = parts.findIndex((p) => p.id === part.id)
  if (i >= 0) {
    const next = parts.slice()
    next[i] = part
    return next
  }
  return [...parts, part]
}

function patchActiveTurn(
  turns: NormTurn[],
  turnId: string,
  fn: (t: NormTurn) => NormTurn,
): NormTurn[] {
  const i = turns.findIndex((t) => t.id === turnId)
  if (i < 0) return turns
  const next = turns.slice()
  next[i] = fn(next[i])
  return next
}

/** A turn in a terminal status finalizes its dangling parts: a harness that died or was stopped
 *  mid-call never sends tool_execution_end (or a final non-streaming text/reasoning upsert), and
 *  a persisted "running" spinner or pulsing "Thinking" label on an idle session reads as a live
 *  process that isn't there. Streaming turns pass through. */
export function sweepDanglingTools(turn: NormTurn): NormTurn {
  if (turn.status === 'streaming') return turn
  const danglingTool = (p: NormTurn['parts'][number]) =>
    p.kind === 'tool' && (p.state.status === 'running' || p.state.status === 'pending')
  const danglingStream = (p: NormTurn['parts'][number]) => (p.kind === 'text' || p.kind === 'reasoning') && p.streaming === true
  if (!turn.parts.some((p) => danglingTool(p) || danglingStream(p))) return turn
  return {
    ...turn,
    parts: turn.parts.map((p) => {
      if (danglingTool(p) && p.kind === 'tool')
        return { ...p, state: { ...p.state, status: 'error' as const, error: 'Interrupted — the turn ended before this call finished.' } }
      if (danglingStream(p) && (p.kind === 'text' || p.kind === 'reasoning')) return { ...p, streaming: false }
      return p
    }),
  }
}

export function applyEvent(state: TranscriptState, ev: AgentEvent): TranscriptState {
  switch (ev.t) {
    case 'turn.start': {
      if (state.turns.some((t) => t.id === ev.turn.id)) {
        return { ...state, turns: patchActiveTurn(state.turns, ev.turn.id, () => ev.turn) }
      }
      return { ...state, turns: [...state.turns, ev.turn] }
    }
    case 'turn.update':
      return {
        ...state,
        turns: patchActiveTurn(state.turns, ev.id, (t) =>
          sweepDanglingTools({ ...t, ...ev.patch }),
        ),
      }
    case 'part.upsert':
      return {
        ...state,
        turns: patchActiveTurn(state.turns, ev.turnId, (t) => ({
          ...t,
          parts: upsertPart(t.parts, ev.part),
        })),
      }
    case 'part.delta':
      return {
        ...state,
        turns: patchActiveTurn(state.turns, ev.turnId, (t) => {
          const i = t.parts.findIndex((p) => p.id === ev.partId)
          if (i < 0) {
            // Open a new streaming part on first delta.
            const opened: NormPart =
              ev.field === 'reasoning'
                ? { kind: 'reasoning', id: ev.partId, text: ev.delta, streaming: true }
                : { kind: 'text', id: ev.partId, text: ev.delta, streaming: true }
            return { ...t, parts: [...t.parts, opened] }
          }
          const part = t.parts[i]
          if (part.kind !== 'text' && part.kind !== 'reasoning') return t
          const next = t.parts.slice()
          next[i] = { ...part, text: part.text + ev.delta, streaming: true }
          return { ...t, parts: next }
        }),
      }
    case 'part.remove':
      return {
        ...state,
        turns: patchActiveTurn(state.turns, ev.turnId, (t) => ({
          ...t,
          parts: t.parts.filter((p) => p.id !== ev.partId),
        })),
      }
    case 'todos':
      return { ...state, todos: ev.todos }
    case 'permission.ask':
      return {
        ...state,
        permissions: state.permissions.some((p) => p.id === ev.permission.id)
          ? state.permissions
          : [...state.permissions, ev.permission],
      }
    case 'permission.resolve':
      return { ...state, permissions: state.permissions.filter((p) => p.id !== ev.id) }
    case 'usage': {
      const last = state.turns[state.turns.length - 1]
      if (!last) return state
      return {
        ...state,
        turns: patchActiveTurn(state.turns, last.id, (t) => ({ ...t, usage: ev.usage })),
      }
    }
    default:
      return state
  }
}

export function applyEvents(state: TranscriptState, events: AgentEvent[]): TranscriptState {
  return events.reduce(applyEvent, state)
}

export { emptyTranscript }
