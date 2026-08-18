import { describe, expect, it } from 'vitest'
import { applyEvent, applyEvents, emptyTranscript } from '~shared/agent-reduce'
import type { AgentEvent, NormUsage, TranscriptState } from '~shared/agent'

/** Usage snapshots emitted at different points in the turn (last writer must win). */
const stepUsage: NormUsage = { input: 900, output: 120, cacheRead: 400 }
const finalUsage: NormUsage = { input: 1800, output: 350, reasoning: 25, cacheRead: 400, cacheWrite: 60, cost: 0.031 }

/** A realistic full assistant turn: text streams in, two tools run and complete, a step reports
 * usage, todos get replaced, and the turn finishes with authoritative usage on turn.update. */
function fullTurnEvents(): AgentEvent[] {
  return [
    {
      t: 'turn.start',
      turn: {
        id: 'a1',
        role: 'assistant',
        createdAt: 1000,
        status: 'streaming',
        model: { providerId: 'openrouter', modelId: 'some/model' },
        parts: [],
      },
    },
    // Text grows across upserts (same id → replaced in place, position preserved).
    { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p-text', text: 'Let me', streaming: true } },
    { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p-text', text: 'Let me look at the file.', streaming: true } },
    // Tool 1 starts running.
    {
      t: 'part.upsert',
      turnId: 'a1',
      part: { kind: 'tool', id: 'p-tool1', callId: 'c1', name: 'read', state: { status: 'running', input: { path: 'src/a.ts' } } },
    },
    // Tool 2 starts while tool 1 is still running (interleaved).
    {
      t: 'part.upsert',
      turnId: 'a1',
      part: { kind: 'tool', id: 'p-tool2', callId: 'c2', name: 'bash', state: { status: 'running', input: { command: 'ls' } } },
    },
    // Tool 1 completes.
    {
      t: 'part.upsert',
      turnId: 'a1',
      part: {
        kind: 'tool',
        id: 'p-tool1',
        callId: 'c1',
        name: 'read',
        state: { status: 'completed', input: { path: 'src/a.ts' }, output: 'export const a = 1', startedAt: 1010, endedAt: 1040 },
      },
    },
    // Tool 2 completes.
    {
      t: 'part.upsert',
      turnId: 'a1',
      part: {
        kind: 'tool',
        id: 'p-tool2',
        callId: 'c2',
        name: 'bash',
        state: { status: 'completed', input: { command: 'ls' }, output: 'a.ts\n', startedAt: 1020, endedAt: 1050 },
      },
    },
    // A step reports interim usage (part + usage event, as the opencode mapper emits them).
    { t: 'part.upsert', turnId: 'a1', part: { kind: 'step', id: 'p-step', usage: stepUsage } },
    { t: 'usage', usage: stepUsage },
    // Todos are whole-list replaced, twice.
    { t: 'todos', todos: [{ content: 'inspect file', status: 'in_progress' }] },
    {
      t: 'todos',
      todos: [
        { content: 'inspect file', status: 'completed' },
        { content: 'run tests', status: 'pending', priority: 'high' },
      ],
    },
    // Final text upsert clears the streaming flag.
    { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p-text', text: 'Let me look at the file.', streaming: false } },
    // Turn completes with authoritative usage (must overwrite the interim step usage).
    {
      t: 'turn.update',
      id: 'a1',
      patch: { status: 'complete', completedAt: 2000, usage: finalUsage },
    },
  ]
}

describe('agent reducer: full turn replay', () => {
  it('replays a whole turn into the exact final TranscriptState', () => {
    const final = applyEvents(emptyTranscript(), fullTurnEvents())

    const expected: TranscriptState = {
      turns: [
        {
          id: 'a1',
          role: 'assistant',
          createdAt: 1000,
          completedAt: 2000,
          status: 'complete',
          model: { providerId: 'openrouter', modelId: 'some/model' },
          usage: finalUsage,
          parts: [
            { kind: 'text', id: 'p-text', text: 'Let me look at the file.', streaming: false },
            {
              kind: 'tool',
              id: 'p-tool1',
              callId: 'c1',
              name: 'read',
              state: { status: 'completed', input: { path: 'src/a.ts' }, output: 'export const a = 1', startedAt: 1010, endedAt: 1040 },
            },
            {
              kind: 'tool',
              id: 'p-tool2',
              callId: 'c2',
              name: 'bash',
              state: { status: 'completed', input: { command: 'ls' }, output: 'a.ts\n', startedAt: 1020, endedAt: 1050 },
            },
            { kind: 'step', id: 'p-step', usage: stepUsage },
          ],
        },
      ],
      todos: [
        { content: 'inspect file', status: 'completed' },
        { content: 'run tests', status: 'pending', priority: 'high' },
      ],
      permissions: [],
    }

    expect(final).toEqual(expected)
  })

  it('preserves part ordering: first appearance wins, upserts patch in place', () => {
    const final = applyEvents(emptyTranscript(), fullTurnEvents())
    expect(final.turns[0].parts.map((p) => p.id)).toEqual(['p-text', 'p-tool1', 'p-tool2', 'p-step'])
  })

  it('usage is last-writer-wins on the active turn', () => {
    // Stop just before the final turn.update: interim step usage should be on the turn.
    const events = fullTurnEvents()
    const beforeFinal = applyEvents(emptyTranscript(), events.slice(0, -1))
    expect(beforeFinal.turns[0].usage).toEqual(stepUsage)
    // The full replay ends with the authoritative usage from turn.update.
    const final = applyEvent(beforeFinal, events[events.length - 1])
    expect(final.turns[0].usage).toEqual(finalUsage)
  })

  it('applies usage events to the LAST turn when several exist', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'turn.start', turn: { id: 'u1', role: 'user', createdAt: 1, status: 'complete', parts: [] } },
      { t: 'turn.start', turn: { id: 'a1', role: 'assistant', createdAt: 2, status: 'streaming', parts: [] } },
      { t: 'usage', usage: stepUsage },
    ])
    expect(s.turns[0].usage).toBeUndefined()
    expect(s.turns[1].usage).toEqual(stepUsage)
  })

  it('usage with no turns at all is a no-op', () => {
    const s0 = emptyTranscript()
    const s1 = applyEvent(s0, { t: 'usage', usage: stepUsage })
    expect(s1).toBe(s0)
  })

  it('turn.start with an existing id replaces that turn in place', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'turn.start', turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] } },
      { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p1', text: 'x', streaming: true } },
      { t: 'turn.start', turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] } },
    ])
    expect(s.turns).toHaveLength(1)
    expect(s.turns[0].parts).toHaveLength(0)
  })
})

describe('agent reducer: unknown turn ids are no-ops', () => {
  const base = () =>
    applyEvent(emptyTranscript(), {
      t: 'turn.start',
      turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [{ kind: 'text', id: 'p1', text: 'hi' }] },
    })

  it('part.upsert to a missing turn leaves turns untouched', () => {
    const s = base()
    const s2 = applyEvent(s, { t: 'part.upsert', turnId: 'ghost', part: { kind: 'text', id: 'px', text: 'nope' } })
    expect(s2.turns).toBe(s.turns)
  })

  it('part.delta to a missing turn leaves turns untouched', () => {
    const s = base()
    const s2 = applyEvent(s, { t: 'part.delta', turnId: 'ghost', partId: 'p1', field: 'text', delta: 'zzz' })
    expect(s2.turns).toBe(s.turns)
  })

  it('part.remove on a missing turn leaves turns untouched', () => {
    const s = base()
    const s2 = applyEvent(s, { t: 'part.remove', turnId: 'ghost', partId: 'p1' })
    expect(s2.turns).toBe(s.turns)
  })

  it('turn.update on a missing turn leaves turns untouched', () => {
    const s = base()
    const s2 = applyEvent(s, { t: 'turn.update', id: 'ghost', patch: { status: 'complete' } })
    expect(s2.turns).toBe(s.turns)
  })
})

describe('agent reducer: part.delta details', () => {
  it('opens a streaming reasoning part on first reasoning delta', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'turn.start', turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] } },
      { t: 'part.delta', turnId: 'a1', partId: 'r1', field: 'reasoning', delta: 'hmm' },
      { t: 'part.delta', turnId: 'a1', partId: 'r1', field: 'reasoning', delta: '…' },
    ])
    expect(s.turns[0].parts).toEqual([{ kind: 'reasoning', id: 'r1', text: 'hmm…', streaming: true }])
  })

  it('ignores deltas addressed at a non-text/non-reasoning part', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'turn.start', turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] } },
      { t: 'part.upsert', turnId: 'a1', part: { kind: 'tool', id: 't1', callId: 'c1', name: 'bash', state: { status: 'running' } } },
      { t: 'part.delta', turnId: 'a1', partId: 't1', field: 'text', delta: 'zzz' },
    ])
    expect(s.turns[0].parts).toEqual([
      { kind: 'tool', id: 't1', callId: 'c1', name: 'bash', state: { status: 'running' } },
    ])
  })
})

describe('agent reducer: part.remove', () => {
  it('removes a middle part and preserves surrounding order', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'turn.start', turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] } },
      { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p1', text: 'one' } },
      { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p2', text: 'two' } },
      { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p3', text: 'three' } },
      { t: 'part.remove', turnId: 'a1', partId: 'p2' },
    ])
    expect(s.turns[0].parts.map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('removing an unknown part id keeps the parts list intact', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'turn.start', turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] } },
      { t: 'part.upsert', turnId: 'a1', part: { kind: 'text', id: 'p1', text: 'one' } },
      { t: 'part.remove', turnId: 'a1', partId: 'ghost' },
    ])
    expect(s.turns[0].parts.map((p) => p.id)).toEqual(['p1'])
  })
})

describe('agent reducer: permissions', () => {
  it('ask → resolve round-trip, deduping repeated asks', () => {
    const asked = applyEvents(emptyTranscript(), [
      { t: 'permission.ask', permission: { id: 'perm1', title: 'Run bash?', toolCallId: 'c1', input: { command: 'rm -rf x' } } },
      { t: 'permission.ask', permission: { id: 'perm1', title: 'Run bash?' } }, // duplicate id: ignored
      { t: 'permission.ask', permission: { id: 'perm2', title: 'Edit file?' } },
    ])
    expect(asked.permissions.map((p) => p.id)).toEqual(['perm1', 'perm2'])
    expect(asked.permissions[0].input).toEqual({ command: 'rm -rf x' })

    const resolved = applyEvent(asked, { t: 'permission.resolve', id: 'perm1' })
    expect(resolved.permissions.map((p) => p.id)).toEqual(['perm2'])
  })

  it('resolving an unknown permission id is harmless', () => {
    const s = applyEvent(emptyTranscript(), { t: 'permission.resolve', id: 'ghost' })
    expect(s.permissions).toEqual([])
  })
})

describe('agent reducer: unhandled events', () => {
  it('status and error events do not alter the transcript state', () => {
    const s = base()
    expect(applyEvent(s, { t: 'status', status: 'busy' })).toBe(s)
    expect(applyEvent(s, { t: 'error', message: 'boom' })).toBe(s)

    function base(): TranscriptState {
      return applyEvent(emptyTranscript(), {
        t: 'turn.start',
        turn: { id: 'a1', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] },
      })
    }
  })
})
