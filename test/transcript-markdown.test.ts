import { describe, expect, it } from 'vitest'
import type { NormTurn } from '../src/shared/agent'
import { transcriptToMarkdown, truncateOutput } from '../src/shared/transcript-markdown'

const DATE = new Date(Date.UTC(2026, 7, 20, 12, 0, 0))

const user = (id: string, text: string): NormTurn => ({
  id,
  role: 'user',
  createdAt: 1,
  status: 'complete',
  parts: [{ kind: 'text', id: `${id}:t`, text }],
})

describe('transcriptToMarkdown', () => {
  it('renders title, harness, model, and export date in the header', () => {
    const md = transcriptToMarkdown({ title: 'Fix login bug', harness: 'opencode', model: 'openai/gpt-5.6-luna', date: DATE, turns: [] })
    expect(md).toContain('# Fix login bug')
    expect(md).toContain('- Harness: opencode')
    expect(md).toContain('- Model: openai/gpt-5.6-luna')
    expect(md).toContain('- Exported: 2026-08-20')
  })

  it('omits harness/model lines when unknown', () => {
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns: [] })
    expect(md).not.toContain('- Harness:')
    expect(md).not.toContain('- Model:')
  })

  it('renders user and agent turns in order with role headings', () => {
    const turns: NormTurn[] = [
      user('u1', 'add a test'),
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'complete',
        parts: [{ kind: 'text', id: 'a1:t', text: 'Done, added one test.' }],
      },
    ]
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns })
    const userIdx = md.indexOf('## User')
    const agentIdx = md.indexOf('## Agent')
    expect(userIdx).toBeGreaterThan(-1)
    expect(agentIdx).toBeGreaterThan(userIdx)
    expect(md).toContain('add a test')
    expect(md).toContain('Done, added one test.')
  })

  it('omits reasoning parts entirely', () => {
    const turns: NormTurn[] = [
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'complete',
        parts: [
          { kind: 'reasoning', id: 'r1', text: 'SECRET-CHAIN-OF-THOUGHT' },
          { kind: 'text', id: 't1', text: 'visible answer' },
        ],
      },
    ]
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns })
    expect(md).not.toContain('SECRET-CHAIN-OF-THOUGHT')
    expect(md).toContain('visible answer')
  })

  it('renders tool calls as fenced blocks with the command and truncated output', () => {
    const longOutput = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const turns: NormTurn[] = [
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'complete',
        parts: [
          {
            kind: 'tool',
            id: 'p1',
            callId: 'c1',
            name: 'bash',
            state: { status: 'completed', input: { command: 'npm test' }, output: longOutput },
          },
        ],
      },
    ]
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns })
    expect(md).toContain('**Tool: bash**')
    expect(md).toContain('$ npm test')
    expect(md).toContain('line 29')
    expect(md).not.toContain('line 30\n') // capped at 30 lines
    expect(md).toContain('... (output truncated)')
  })

  it('grows the fence beyond any backtick run inside tool output', () => {
    const turns: NormTurn[] = [
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'complete',
        parts: [
          {
            kind: 'tool',
            id: 'p1',
            callId: 'c1',
            name: 'read',
            state: { status: 'completed', input: { command: 'cat x.md' }, output: '```js\ncode\n```' },
          },
        ],
      },
    ]
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns })
    expect(md).toContain('````\n$ cat x.md')
    expect(md).toContain('```\n````')
  })

  it('renders tool errors inside the fence', () => {
    const turns: NormTurn[] = [
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'error',
        parts: [
          { kind: 'tool', id: 'p1', callId: 'c1', name: 'bash', state: { status: 'error', input: { command: 'boom' }, error: 'exit 1' } },
          { kind: 'error', id: 'p2', name: 'error', message: 'the turn failed' },
        ],
      },
    ]
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns })
    expect(md).toContain('error: exit 1')
    expect(md).toContain('> Error (error): the turn failed')
  })

  it('sums per-turn usage into a totals footer (reasoning tokens count as output)', () => {
    const turns: NormTurn[] = [
      user('u1', 'hi'),
      {
        id: 'a1',
        role: 'assistant',
        createdAt: 2,
        status: 'complete',
        usage: { input: 100, output: 40, reasoning: 10, cost: 0.5 },
        parts: [{ kind: 'text', id: 't1', text: 'one' }],
      },
      {
        id: 'a2',
        role: 'assistant',
        createdAt: 3,
        status: 'complete',
        usage: { input: 200, output: 60, cost: 0.25 },
        parts: [{ kind: 'text', id: 't2', text: 'two' }],
      },
    ]
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns })
    expect(md).toContain('Totals: 3 turns, 300 tokens in, 110 tokens out, $0.75')
  })

  it('skips turns whose parts render to nothing (a reasoning-only turn leaves no empty heading)', () => {
    const turns: NormTurn[] = [
      { id: 'a1', role: 'assistant', createdAt: 2, status: 'complete', parts: [{ kind: 'reasoning', id: 'r', text: 'x' }] },
    ]
    const md = transcriptToMarkdown({ title: 'T', date: DATE, turns })
    expect(md).not.toContain('## Agent')
  })

  it('renders an empty transcript as a valid document with a footer', () => {
    const md = transcriptToMarkdown({ title: 'Empty', date: DATE, turns: [] })
    expect(md.startsWith('# Empty')).toBe(true)
    expect(md).toContain('Totals: 0 turns, 0 tokens in, 0 tokens out, $0.00')
  })
})

describe('truncateOutput', () => {
  it('returns short text unchanged', () => {
    expect(truncateOutput('ok')).toBe('ok')
  })

  it('caps by characters as well as lines', () => {
    const out = truncateOutput('x'.repeat(5000))
    expect(out.length).toBeLessThan(2100)
    expect(out).toContain('... (output truncated)')
  })
})
