import { describe, expect, it } from 'vitest'
import { BridgeSession } from '../bridge/src/session'
import { createPiRpc } from '../bridge/src/adapters/pi'
import type { AdapterSink, HarnessAdapter, StartConfig } from '../bridge/src/adapters/types'

/** Minimal fake harness; `command` is attached per-test (its absence is itself a case under test). */
class FakeAdapter implements HarnessAdapter {
  commands: Array<{ name: string; args?: Record<string, unknown> }> = []
  async start(_cfg: StartConfig): Promise<void> {}
  async prompt(_text: string, _sink: AdapterSink): Promise<void> {}
  async abort(): Promise<void> {}
  async resolvePermission(): Promise<void> {}
  async dispose(): Promise<void> {}
  command?(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; note?: string; data?: unknown }>
}

function makeSession(adapter: HarnessAdapter): BridgeSession {
  const session = new BridgeSession()
  ;(session as unknown as { adapter: HarnessAdapter }).adapter = adapter
  return session
}

describe('BridgeSession.command', () => {
  it('delegates to the adapter and returns its result', async () => {
    const adapter = new FakeAdapter()
    adapter.command = async (name, args) => {
      adapter.commands.push({ name, args })
      return { ok: true, note: 'done', data: [1, 2] }
    }
    const session = makeSession(adapter)

    const result = await session.command('stats', { verbose: true })
    expect(result).toEqual({ ok: true, note: 'done', data: [1, 2] })
    expect(adapter.commands).toEqual([{ name: 'stats', args: { verbose: true } }])
  })

  it('answers not-supported when the adapter has no command method', async () => {
    const session = makeSession(new FakeAdapter())
    expect(await session.command('compact')).toEqual({ ok: false, note: 'Not supported by this harness.' })
  })

  it('answers not-supported before start (no adapter yet)', async () => {
    const session = new BridgeSession()
    expect(await session.command('compact')).toEqual({ ok: false, note: 'Not supported by this harness.' })
  })
})

describe('createPiRpc (pi RPC request/response correlation)', () => {
  it('a {id, type:"response"} line resolves the pending request and is consumed (not an event)', async () => {
    const sent: Array<Record<string, unknown>> = []
    const rpc = createPiRpc((obj) => sent.push(obj))

    const p = rpc.request({ type: 'compact' })
    expect(sent).toEqual([{ id: 'cmd-1', type: 'compact' }])

    const line = { id: 'cmd-1', type: 'response', command: 'compact', success: true }
    expect(rpc.handle(line)).toBe(true) // consumed → adapter must not treat it as a stream event
    await expect(p).resolves.toEqual(line)

    // A second identical line no longer matches anything.
    expect(rpc.handle(line)).toBe(false)
  })

  it('ignores stream events and responses for unknown ids', () => {
    const rpc = createPiRpc(() => {})
    void rpc.request({ type: 'get_commands' }).catch(() => {})
    expect(rpc.handle({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } })).toBe(false)
    expect(rpc.handle({ id: 'cmd-999', type: 'response', success: true })).toBe(false)
    expect(rpc.handle({ id: 'cmd-1', type: 'agent_end' })).toBe(false) // right id, wrong type
  })

  it('rejects after the timeout and cleans up the pending entry', async () => {
    const rpc = createPiRpc(() => {}, 5)
    await expect(rpc.request({ type: 'compact' })).rejects.toThrow('timeout')
    // The entry is gone: a late response is no longer consumed.
    expect(rpc.handle({ id: 'cmd-1', type: 'response', success: true })).toBe(false)
  })

  it('correlates interleaved responses by id', async () => {
    const rpc = createPiRpc(() => {})
    const a = rpc.request({ type: 'get_session_stats' })
    const b = rpc.request({ type: 'get_commands' })
    expect(rpc.handle({ id: 'cmd-2', type: 'response', command: 'get_commands', success: true, commands: [] })).toBe(true)
    expect(rpc.handle({ id: 'cmd-1', type: 'response', command: 'get_session_stats', success: true, stats: { messages: 3 } })).toBe(true)
    await expect(a).resolves.toMatchObject({ command: 'get_session_stats' })
    await expect(b).resolves.toMatchObject({ command: 'get_commands' })
  })
})
