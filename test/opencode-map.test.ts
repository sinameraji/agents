import { describe, expect, it } from 'vitest'
import { OpencodeMapper, isSessionIdle } from '../src/server/harness/opencode-map'

describe('OpencodeMapper', () => {
  it('emits turn.start once and maps a text part', () => {
    const m = new OpencodeMapper()
    const a = m.map({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', messageID: 'm1', text: 'hi' } } })
    expect(a.map((e) => e.t)).toEqual(['turn.start', 'part.upsert'])
    const b = m.map({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', messageID: 'm1', text: 'hi there' } } })
    // second time: no new turn.start
    expect(b.map((e) => e.t)).toEqual(['part.upsert'])
  })

  it('maps a tool part with state', () => {
    const m = new OpencodeMapper()
    const events = m.map({
      type: 'message.part.updated',
      properties: { part: { type: 'tool', id: 'tp', messageID: 'm1', callID: 'c1', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'x', title: 'ls' } } },
    })
    const tool = events.find((e) => e.t === 'part.upsert')
    expect(tool && 'part' in tool && tool.part.kind).toBe('tool')
    if (tool && tool.t === 'part.upsert' && tool.part.kind === 'tool') {
      expect(tool.part.name).toBe('bash')
      expect(tool.part.state.status).toBe('completed')
      expect(tool.part.state.output).toBe('x')
    }
  })

  it('maps todo.updated', () => {
    const m = new OpencodeMapper()
    const [ev] = m.map({ type: 'todo.updated', properties: { todos: [{ content: 'do', status: 'in_progress', priority: 'high' }] } })
    expect(ev.t).toBe('todos')
    if (ev.t === 'todos') expect(ev.todos[0].content).toBe('do')
  })

  it('detects session idle', () => {
    expect(isSessionIdle({ type: 'session.idle', properties: { sessionID: 's1' } }, 's1')).toBe(true)
    expect(isSessionIdle({ type: 'session.idle', properties: { sessionID: 's2' } }, 's1')).toBe(false)
    expect(isSessionIdle({ type: 'message.updated' }, 's1')).toBe(false)
  })
})
