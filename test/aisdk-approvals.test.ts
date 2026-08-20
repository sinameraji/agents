import { describe, expect, it } from 'vitest'
import { BridgeSession } from '../bridge/src/session'
import { gateMutation } from '../bridge/src/adapters/aisdk'
import { ApprovalBroker } from '../src/shared/approvals'
import { isMutatingCommand } from '../src/shared/mutation-guard'
import type { HarnessAdapter, StartConfig } from '../bridge/src/adapters/types'

/**
 * Build-mode ask-before-mutate roundtrip for the aisdk harness: a fake adapter whose prompt()
 * runs ONE aisdk-style gated bash tool — the REAL gateMutation + ApprovalBroker the adapter
 * uses — driven through the REAL BridgeSession permission plumbing (sink.permission →
 * session.permissions → resolvePermission, the endpoint the DO's respondPermission hits).
 */
function gatedHarness(command: string, mode: StartConfig['mode'], timeoutMs = 60_000) {
  const broker = new ApprovalBroker(timeoutMs)
  const results: string[] = []
  const adapter: HarnessAdapter = {
    async start() {},
    async prompt(_text, sink) {
      const gated = await gateMutation({
        mode,
        mutating: isMutatingCommand(command),
        broker,
        sink,
        tool: 'bash',
        title: `Run: ${command}`,
        input: { command },
      })
      results.push(gated ?? `ran: ${command}`)
      sink.done()
    },
    async abort() {
      broker.denyAll()
    },
    async resolvePermission(id, reply) {
      broker.resolve(id, reply)
    },
    async dispose() {},
  }
  const session = new BridgeSession()
  ;(session as unknown as { adapter: HarnessAdapter }).adapter = adapter
  return { session, results }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe('aisdk Build-mode approvals (bridge roundtrip)', () => {
  it('grant: the ask surfaces as a permission, and "once" lets the tool run', async () => {
    const { session, results } = gatedHarness('rm -rf dist', 'build')
    session.prompt('clean up')
    await tick()

    expect(results).toEqual([]) // tool is parked on the ask
    expect(session.permissions).toHaveLength(1)
    const perm = session.permissions[0]
    expect(perm.title).toBe('Run: rm -rf dist')
    expect(perm.input).toEqual({ command: 'rm -rf dist' })

    await session.resolvePermission(perm.id, 'once')
    await tick()
    expect(results).toEqual(['ran: rm -rf dist'])
    expect(session.permissions).toEqual([]) // card cleared
    expect(session.status).toBe('idle')
  })

  it('deny: "reject" makes the tool return denied by user', async () => {
    const { session, results } = gatedHarness('git push origin main', 'build')
    session.prompt('ship it')
    await tick()

    const perm = session.permissions[0]
    await session.resolvePermission(perm.id, 'reject')
    await tick()
    expect(results).toEqual(['denied by user'])
    expect(session.status).toBe('idle')
  })

  it('an unanswered ask times out to denied (the turn never hangs forever)', async () => {
    const { session, results } = gatedHarness('rm -rf dist', 'build', 20)
    session.prompt('clean up')
    await tick(60)
    expect(results).toEqual(['denied by user'])
    expect(session.status).toBe('idle')
  })

  it('read-only commands run in Build without asking', async () => {
    const { session, results } = gatedHarness('git status', 'build')
    session.prompt('check')
    await tick()
    expect(session.permissions).toEqual([])
    expect(results).toEqual(['ran: git status'])
  })

  it('Auto never asks, even for mutations', async () => {
    const { session, results } = gatedHarness('rm -rf dist', 'auto')
    session.prompt('clean up')
    await tick()
    expect(session.permissions).toEqual([])
    expect(results).toEqual(['ran: rm -rf dist'])
  })

  it('Plan keeps the hard block (no ask, no run)', async () => {
    const { session, results } = gatedHarness('rm -rf dist', 'plan')
    session.prompt('clean up')
    await tick()
    expect(session.permissions).toEqual([])
    expect(results).toEqual(['blocked in plan mode (read-only)'])
  })

  it('abort denies a parked ask so the turn can settle', async () => {
    const { session, results } = gatedHarness('rm -rf dist', 'build')
    session.prompt('clean up')
    await tick()
    expect(session.permissions).toHaveLength(1)
    await session.abort()
    await tick()
    expect(results).toEqual(['denied by user'])
  })
})
