import { describe, expect, it } from 'vitest'
import { applyEvents, emptyTranscript } from '~shared/agent-reduce'
import type { AgentEvent } from '~shared/agent'

describe('agent reducer', () => {
  it('starts a turn and accumulates a streaming text part', () => {
    const events: AgentEvent[] = [
      { t: 'turn.start', turn: { id: 't1', role: 'assistant', createdAt: 0, status: 'streaming', parts: [] } },
      { t: 'part.upsert', turnId: 't1', part: { kind: 'text', id: 'p1', text: 'Hel', streaming: true } },
      { t: 'part.upsert', turnId: 't1', part: { kind: 'text', id: 'p1', text: 'Hello', streaming: true } },
    ]
    const s = applyEvents(emptyTranscript(), events)
    expect(s.turns).toHaveLength(1)
    expect(s.turns[0].parts).toHaveLength(1)
    const p = s.turns[0].parts[0]
    expect(p.kind).toBe('text')
    if (p.kind === 'text') expect(p.text).toBe('Hello')
  })

  it('accumulates via part.delta then finalizes', () => {
    const events: AgentEvent[] = [
      { t: 'turn.start', turn: { id: 't1', role: 'assistant', createdAt: 0, status: 'streaming', parts: [] } },
      { t: 'part.delta', turnId: 't1', partId: 'p1', field: 'text', delta: 'a' },
      { t: 'part.delta', turnId: 't1', partId: 'p1', field: 'text', delta: 'b' },
      { t: 'part.upsert', turnId: 't1', part: { kind: 'text', id: 'p1', text: 'ab', streaming: false } },
    ]
    const s = applyEvents(emptyTranscript(), events)
    const p = s.turns[0].parts[0]
    if (p.kind === 'text') {
      expect(p.text).toBe('ab')
      expect(p.streaming).toBe(false)
    }
  })

  it('a terminal turn.update clears dangling streaming flags on text and reasoning parts', () => {
    const events: AgentEvent[] = [
      { t: 'turn.start', turn: { id: 't1', role: 'assistant', createdAt: 0, status: 'streaming', parts: [] } },
      { t: 'part.upsert', turnId: 't1', part: { kind: 'reasoning', id: 'r1', text: 'hmm', streaming: true } },
      { t: 'part.upsert', turnId: 't1', part: { kind: 'text', id: 'p1', text: 'Hello', streaming: true } },
      { t: 'turn.update', id: 't1', patch: { status: 'complete', completedAt: 1 } },
    ]
    const s = applyEvents(emptyTranscript(), events)
    expect(s.turns[0].status).toBe('complete')
    for (const p of s.turns[0].parts) {
      if (p.kind === 'text' || p.kind === 'reasoning') expect(p.streaming).toBe(false)
    }
  })

  it('keeps tool parts keyed by id with monotonic state', () => {
    const events: AgentEvent[] = [
      { t: 'turn.start', turn: { id: 't1', role: 'assistant', createdAt: 0, status: 'streaming', parts: [] } },
      { t: 'part.upsert', turnId: 't1', part: { kind: 'tool', id: 'tp1', callId: 'c1', name: 'bash', state: { status: 'running', input: { command: 'ls' } } } },
      { t: 'part.upsert', turnId: 't1', part: { kind: 'tool', id: 'tp1', callId: 'c1', name: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'file.txt' } } },
    ]
    const s = applyEvents(emptyTranscript(), events)
    expect(s.turns[0].parts).toHaveLength(1)
    const p = s.turns[0].parts[0]
    if (p.kind === 'tool') {
      expect(p.state.status).toBe('completed')
      expect(p.state.output).toBe('file.txt')
    }
  })

  it('replaces todos wholesale', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'todos', todos: [{ content: 'a', status: 'pending' }] },
      { t: 'todos', todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] },
    ])
    expect(s.todos).toHaveLength(2)
    expect(s.todos[0].status).toBe('completed')
  })

  it('adds then resolves a permission', () => {
    const s = applyEvents(emptyTranscript(), [
      { t: 'permission.ask', permission: { id: 'perm1', title: 'Allow bash?' } },
    ])
    expect(s.permissions).toHaveLength(1)
    const s2 = applyEvents(s, [{ t: 'permission.resolve', id: 'perm1' }])
    expect(s2.permissions).toHaveLength(0)
  })
})
