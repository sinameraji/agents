import { describe, expect, it } from 'vitest'
import { mapPart, usageFromInfo, isAssistantComplete } from '../src/server/harness/opencode-map'

describe('mapPart', () => {
  describe('text and reasoning', () => {
    it('maps a text part', () => {
      const p = mapPart({ type: 'text', id: 'p1', messageID: 'm1', text: 'hello' })
      expect(p).toEqual({ kind: 'text', id: 'p1', text: 'hello' })
    })

    it('maps a reasoning part', () => {
      const p = mapPart({ type: 'reasoning', id: 'p2', messageID: 'm1', text: 'thinking…' })
      expect(p).toEqual({ kind: 'reasoning', id: 'p2', text: 'thinking…' })
    })

    it('returns null for text/reasoning parts without string text', () => {
      expect(mapPart({ type: 'text', id: 'p1', messageID: 'm1' })).toBeNull()
      expect(mapPart({ type: 'text', id: 'p1', text: 42 })).toBeNull()
      expect(mapPart({ type: 'reasoning', id: 'p2' })).toBeNull()
    })

    it('preserves an empty string as valid text', () => {
      const p = mapPart({ type: 'text', id: 'p1', text: '' })
      expect(p).toEqual({ kind: 'text', id: 'p1', text: '' })
    })
  })

  describe('id fallback', () => {
    it('derives id from messageID and type when part.id is missing', () => {
      const p = mapPart({ type: 'text', messageID: 'm7', text: 'x' })
      expect(p?.id).toBe('m7:text')
    })

    it('falls back to "m:<type>" when both id and messageID are missing', () => {
      const p = mapPart({ type: 'reasoning', text: 'y' })
      expect(p?.id).toBe('m:reasoning')
    })
  })

  describe('tool parts', () => {
    it('maps a pending tool with defaults for missing fields', () => {
      const p = mapPart({ type: 'tool', id: 'tp1', callID: 'c1', tool: 'read', state: { status: 'pending' } })
      expect(p).toEqual({
        kind: 'tool',
        id: 'tp1',
        callId: 'c1',
        name: 'read',
        state: {
          status: 'pending',
          input: {},
          title: undefined,
          output: undefined,
          error: undefined,
          startedAt: undefined,
          endedAt: undefined,
        },
      })
    })

    it('defaults status to pending when state.status is missing', () => {
      const p = mapPart({ type: 'tool', id: 'tp1', state: {} })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state.status).toBe('pending')
    })

    it('maps a running tool with input, title and start time', () => {
      const p = mapPart({
        type: 'tool',
        id: 'tp2',
        callID: 'c2',
        tool: 'bash',
        state: { status: 'running', input: { command: 'ls -la' }, title: 'List files', time: { start: 111 } },
      })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state.status).toBe('running')
      expect(p.state.input).toEqual({ command: 'ls -la' })
      expect(p.state.title).toBe('List files')
      expect(p.state.startedAt).toBe(111)
      expect(p.state.endedAt).toBeUndefined()
      // output/error are only surfaced in their terminal statuses
      expect(p.state.output).toBeUndefined()
      expect(p.state.error).toBeUndefined()
    })

    it('maps a completed tool: output + title + time.start/end', () => {
      const p = mapPart({
        type: 'tool',
        id: 'tp3',
        callID: 'c3',
        tool: 'bash',
        state: {
          status: 'completed',
          input: { command: 'echo hi' },
          output: 'hi\n',
          title: 'echo hi',
          time: { start: 100, end: 250 },
        },
      })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state).toEqual({
        status: 'completed',
        input: { command: 'echo hi' },
        title: 'echo hi',
        output: 'hi\n',
        error: undefined,
        startedAt: 100,
        endedAt: 250,
      })
    })

    it('drops output on completed tools when it is not a string', () => {
      const p = mapPart({ type: 'tool', id: 'tp3', state: { status: 'completed', output: { rich: true } } })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state.output).toBeUndefined()
    })

    it('maps an error tool: error message surfaced, output suppressed', () => {
      const p = mapPart({
        type: 'tool',
        id: 'tp4',
        callID: 'c4',
        tool: 'edit',
        state: { status: 'error', error: 'file not found', output: 'stale partial output', time: { start: 5, end: 9 } },
      })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state.status).toBe('error')
      expect(p.state.error).toBe('file not found')
      expect(p.state.output).toBeUndefined()
      expect(p.state.startedAt).toBe(5)
      expect(p.state.endedAt).toBe(9)
    })

    it('suppresses error text outside the error status', () => {
      const p = mapPart({ type: 'tool', id: 'tp5', state: { status: 'completed', output: 'ok', error: 'ignored' } })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state.error).toBeUndefined()
      expect(p.state.output).toBe('ok')
    })

    it('treats zero timestamps as absent', () => {
      const p = mapPart({ type: 'tool', id: 'tp6', state: { status: 'running', time: { start: 0, end: 0 } } })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state.startedAt).toBeUndefined()
      expect(p.state.endedAt).toBeUndefined()
    })

    it('falls back callId → id and name → "tool"', () => {
      const p = mapPart({ type: 'tool', id: 'tp7', state: { status: 'pending' } })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.callId).toBe('tp7')
      expect(p.name).toBe('tool')
    })

    it('maps a tool with no state object at all', () => {
      const p = mapPart({ type: 'tool', id: 'tp8', callID: 'c8', tool: 'grep' })
      if (p?.kind !== 'tool') throw new Error('expected tool part')
      expect(p.state.status).toBe('pending')
      expect(p.state.input).toEqual({})
    })
  })

  describe('step-finish parts', () => {
    it('maps tokens and cost to usage', () => {
      const p = mapPart({
        type: 'step-finish',
        id: 'sf1',
        tokens: { input: 120, output: 45, reasoning: 7, cache: { read: 300, write: 12 } },
        cost: 0.0042,
      })
      expect(p).toEqual({
        kind: 'step',
        id: 'sf1',
        usage: { input: 120, output: 45, reasoning: 7, cacheRead: 300, cacheWrite: 12, cost: 0.0042 },
      })
    })

    it('maps missing tokens to zeroes with optional fields absent', () => {
      const p = mapPart({ type: 'step-finish', id: 'sf2' })
      expect(p).toEqual({
        kind: 'step',
        id: 'sf2',
        usage: { input: 0, output: 0, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined, cost: undefined },
      })
    })

    it('ignores a non-numeric cost', () => {
      const p = mapPart({ type: 'step-finish', id: 'sf3', tokens: { input: 1, output: 2 }, cost: '0.01' })
      if (p?.kind !== 'step') throw new Error('expected step part')
      expect(p.usage?.cost).toBeUndefined()
      expect(p.usage?.input).toBe(1)
      expect(p.usage?.output).toBe(2)
    })

    it('treats zero reasoning/cache counters as absent', () => {
      const p = mapPart({ type: 'step-finish', id: 'sf4', tokens: { input: 5, output: 6, reasoning: 0, cache: { read: 0, write: 0 } } })
      if (p?.kind !== 'step') throw new Error('expected step part')
      expect(p.usage).toEqual({ input: 5, output: 6, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined, cost: undefined })
    })
  })

  describe('patch parts', () => {
    it('maps files to diff entries', () => {
      const p = mapPart({ type: 'patch', id: 'd1', files: ['src/a.ts', 'src/b.ts'] })
      expect(p).toEqual({ kind: 'diff', id: 'd1', files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] })
    })

    it('coerces non-string file entries to strings', () => {
      const p = mapPart({ type: 'patch', id: 'd2', files: [42] })
      if (p?.kind !== 'diff') throw new Error('expected diff part')
      expect(p.files).toEqual([{ path: '42' }])
    })

    it('maps a missing/non-array files field to an empty list', () => {
      expect(mapPart({ type: 'patch', id: 'd3' })).toEqual({ kind: 'diff', id: 'd3', files: [] })
      expect(mapPart({ type: 'patch', id: 'd4', files: 'oops' })).toEqual({ kind: 'diff', id: 'd4', files: [] })
    })
  })

  describe('subtask / agent parts', () => {
    it('maps a subtask with agent + description', () => {
      const p = mapPart({ type: 'subtask', id: 's1', agent: 'explorer', description: 'find the bug' })
      expect(p).toEqual({ kind: 'subtask', id: 's1', agent: 'explorer', description: 'find the bug' })
    })

    it('maps an agent part, falling back to part.name', () => {
      const p = mapPart({ type: 'agent', id: 's2', name: 'reviewer' })
      expect(p).toEqual({ kind: 'subtask', id: 's2', agent: 'reviewer', description: undefined })
    })

    it('falls back to the literal "agent" when neither agent nor name is present', () => {
      const p = mapPart({ type: 'subtask', id: 's3' })
      if (p?.kind !== 'subtask') throw new Error('expected subtask part')
      expect(p.agent).toBe('agent')
    })
  })

  describe('unmapped part types', () => {
    it.each(['file', 'snapshot', 'retry', 'step-start'])('returns null for %s', (type) => {
      expect(mapPart({ type, id: 'x1', messageID: 'm1' })).toBeNull()
    })

    it('returns null for unknown or missing type', () => {
      expect(mapPart({ type: 'holodeck', id: 'x2' })).toBeNull()
      expect(mapPart({ id: 'x3' })).toBeNull()
      expect(mapPart({})).toBeNull()
    })
  })
})

describe('usageFromInfo', () => {
  it('maps a full assistant info tokens block', () => {
    const u = usageFromInfo({
      tokens: { input: 1000, output: 200, reasoning: 50, cache: { read: 900, write: 40 } },
      cost: 0.05,
    })
    expect(u).toEqual({ input: 1000, output: 200, reasoning: 50, cacheRead: 900, cacheWrite: 40, cost: 0.05 })
  })

  it('handles missing tokens entirely', () => {
    const u = usageFromInfo({})
    expect(u).toEqual({ input: 0, output: 0, reasoning: undefined, cacheRead: undefined, cacheWrite: undefined, cost: undefined })
  })

  it('maps cache read/write independently', () => {
    expect(usageFromInfo({ tokens: { input: 1, output: 1, cache: { read: 10 } } }).cacheRead).toBe(10)
    expect(usageFromInfo({ tokens: { input: 1, output: 1, cache: { read: 10 } } }).cacheWrite).toBeUndefined()
    expect(usageFromInfo({ tokens: { input: 1, output: 1, cache: { write: 3 } } }).cacheWrite).toBe(3)
    expect(usageFromInfo({ tokens: { input: 1, output: 1, cache: { write: 3 } } }).cacheRead).toBeUndefined()
  })

  it('ignores non-numeric token fields', () => {
    const u = usageFromInfo({ tokens: { input: '12', output: null }, cost: 'free' })
    expect(u.input).toBe(0)
    expect(u.output).toBe(0)
    expect(u.cost).toBeUndefined()
  })
})

describe('isAssistantComplete', () => {
  it('is true when time.completed is set', () => {
    expect(isAssistantComplete({ time: { completed: 1700000000000 } })).toBe(true)
  })

  it('is true on error alone (no completion time)', () => {
    expect(isAssistantComplete({ error: { name: 'ProviderError' } })).toBe(true)
  })

  it('is false while streaming (no completion, no error)', () => {
    expect(isAssistantComplete({ time: { created: 1 } })).toBe(false)
    expect(isAssistantComplete({})).toBe(false)
  })

  it('is false when time is not an object', () => {
    expect(isAssistantComplete({ time: 'later' })).toBe(false)
  })
})
