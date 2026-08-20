import { describe, expect, it } from 'vitest'
import { shellResult } from '../src/server/harness/opencode-map'

/**
 * session.shell answers with { info: Message, parts: Part[] } (types.gen.d.ts:8785). OpenCode
 * runs the command through its bash tool, so the payload is a ToolPart whose state is one of
 * ToolStatePending/Running/Completed/Error (types.gen.d.ts:337-388).
 */
const toolPart = (state: Record<string, unknown>) => ({
  id: 'prt_1',
  type: 'tool',
  callID: 'call_1',
  tool: 'bash',
  state,
})

describe('shellResult', () => {
  it('reads output and a zero exit from a completed bash tool part', () => {
    expect(
      shellResult([
        toolPart({
          status: 'completed',
          input: { command: 'echo hi' },
          output: 'hi\n',
          title: 'echo hi',
          metadata: {},
          time: { start: 1, end: 2 },
        }),
      ]),
    ).toEqual({ output: 'hi', exitCode: 0, done: true })
  })

  it('picks the exit code out of the metadata bag whatever it is called', () => {
    for (const key of ['exit', 'exitCode', 'exit_code', 'code', 'status']) {
      const r = shellResult([
        toolPart({ status: 'completed', input: {}, output: 'boom', metadata: { [key]: 2 }, time: {} }),
      ])
      expect(r.exitCode, key).toBe(2)
    }
  })

  it('surfaces an errored tool as failing output', () => {
    const r = shellResult([
      toolPart({ status: 'error', input: {}, error: 'command not found: frobnicate', time: {} }),
    ])
    expect(r).toEqual({ output: 'command not found: frobnicate', exitCode: 1, done: true })
  })

  it('reports not-done while the command is still running, so the caller polls', () => {
    expect(shellResult([toolPart({ status: 'running', input: {}, time: { start: 1 } })]).done).toBe(false)
    expect(shellResult([toolPart({ status: 'pending', input: {}, raw: '' })]).done).toBe(false)
  })

  it('falls back to text parts when a server answers without a tool part', () => {
    expect(shellResult([{ type: 'text', text: 'plain output' }])).toEqual({
      output: 'plain output',
      exitCode: undefined,
      done: true,
    })
  })

  it('joins several parts and trims the trailing blank lines', () => {
    const r = shellResult([
      { type: 'text', text: 'note' },
      toolPart({ status: 'completed', input: {}, output: 'line1\nline2\n\n', metadata: {}, time: {} }),
    ])
    expect(r.output).toBe('note\nline1\nline2')
  })

  it('survives an empty or junk parts list', () => {
    expect(shellResult([])).toEqual({ output: '', exitCode: undefined, done: true })
    expect(shellResult([null, 42, { type: 'text' }] as unknown[])).toEqual({
      output: '',
      exitCode: undefined,
      done: true,
    })
  })
})
