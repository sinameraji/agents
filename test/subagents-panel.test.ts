import { describe, expect, it } from 'vitest'
import { collectSubtasks } from '@/components/coding-agent/subagents-panel'
import type { NormTurn } from '~shared/agent'

describe('collectSubtasks', () => {
  it('returns empty for no turns or no subtask parts', () => {
    expect(collectSubtasks([])).toEqual([])
    const turns: NormTurn[] = [
      {
        id: 't1',
        role: 'assistant',
        createdAt: 1,
        status: 'complete',
        parts: [{ kind: 'text', id: 'p1', text: 'hello' }],
      },
    ]
    expect(collectSubtasks(turns)).toEqual([])
  })

  it('extracts only subtask parts from mixed turns, preserving order', () => {
    const turns: NormTurn[] = [
      {
        id: 't1',
        role: 'user',
        createdAt: 100,
        status: 'complete',
        parts: [{ kind: 'text', id: 'u1', text: 'do things' }],
      },
      {
        id: 't2',
        role: 'assistant',
        createdAt: 200,
        status: 'complete',
        parts: [
          { kind: 'text', id: 'p1', text: 'working…' },
          { kind: 'subtask', id: 's1', agent: 'explorer', description: 'scan the repo' },
          {
            kind: 'tool',
            id: 'p2',
            callId: 'c1',
            name: 'bash',
            state: { status: 'completed', output: 'ok' },
          },
          { kind: 'subtask', id: 's2', agent: 'reviewer', childSessionId: 'child-1' },
          { kind: 'todos', id: 'p3', todos: [{ content: 'a', status: 'pending' }] },
        ],
      },
      {
        id: 't3',
        role: 'assistant',
        createdAt: 300,
        status: 'streaming',
        parts: [{ kind: 'subtask', id: 's3', agent: 'fixer', description: 'apply patches' }],
      },
    ]

    const got = collectSubtasks(turns)
    expect(got).toHaveLength(3)
    expect(got.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(got[0]).toEqual({
      id: 's1',
      agent: 'explorer',
      description: 'scan the repo',
      turnId: 't2',
      turnStatus: 'complete',
      createdAt: 200,
    })
    expect(got[1].description).toBeUndefined()
    expect(got[1].turnId).toBe('t2')
  })

  it('carries the parent turn status and createdAt for each subtask', () => {
    const turns: NormTurn[] = [
      {
        id: 'err',
        role: 'assistant',
        createdAt: 10,
        status: 'error',
        parts: [{ kind: 'subtask', id: 'a', agent: 'worker' }],
      },
      {
        id: 'gone',
        role: 'assistant',
        createdAt: 20,
        status: 'aborted',
        parts: [{ kind: 'subtask', id: 'b', agent: 'worker' }],
      },
      {
        id: 'live',
        role: 'assistant',
        createdAt: 30,
        status: 'streaming',
        parts: [{ kind: 'subtask', id: 'c', agent: 'worker' }],
      },
    ]

    const got = collectSubtasks(turns)
    expect(got.map((s) => s.turnStatus)).toEqual(['error', 'aborted', 'streaming'])
    expect(got.map((s) => s.createdAt)).toEqual([10, 20, 30])
  })
})
