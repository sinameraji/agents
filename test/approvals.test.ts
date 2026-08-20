import { describe, expect, it } from 'vitest'
import { ApprovalBroker } from '../src/shared/approvals'
import { isMutatingCommand } from '../src/shared/mutation-guard'

describe('isMutatingCommand', () => {
  it.each([
    'rm -rf dist',
    'echo hi > out.txt',
    'cat a >> b',
    'sed -i s/a/b/ file.ts',
    'git push origin main',
    'npm install left-pad',
    'python3 -c "open(\'x\',\'w\')"',
    'mkdir -p src/new',
  ])('flags %j as mutating', (cmd) => {
    expect(isMutatingCommand(cmd)).toBe(true)
  })

  it.each(['ls -la', 'cat package.json', 'git status', 'git log --oneline', 'rg -n pattern src', 'npm test'])(
    'lets %j through as read-only',
    (cmd) => {
      expect(isMutatingCommand(cmd)).toBe(false)
    },
  )
})

describe('ApprovalBroker', () => {
  it('grant: announce fires with the id, and the ask resolves true on "once"', async () => {
    const broker = new ApprovalBroker()
    let askedId = ''
    const p = broker.ask({ tool: 'bash', announce: (id) => (askedId = id) })
    expect(askedId).toMatch(/^perm-/)
    expect(broker.resolve(askedId, 'once')).toBe(true)
    await expect(p).resolves.toBe(true)
  })

  it('deny: "reject" resolves the ask false', async () => {
    const broker = new ApprovalBroker()
    let askedId = ''
    const p = broker.ask({ tool: 'bash', announce: (id) => (askedId = id) })
    expect(broker.resolve(askedId, 'reject')).toBe(true)
    await expect(p).resolves.toBe(false)
  })

  it('"always" grants this ask AND auto-allows later asks for the same tool (no new card)', async () => {
    const broker = new ApprovalBroker()
    let askedId = ''
    const first = broker.ask({ tool: 'write_file', announce: (id) => (askedId = id) })
    broker.resolve(askedId, 'always')
    await expect(first).resolves.toBe(true)

    let announced = 0
    await expect(broker.ask({ tool: 'write_file', announce: () => announced++ })).resolves.toBe(true)
    expect(announced).toBe(0)
    // A different tool still asks.
    let otherId = ''
    const other = broker.ask({ tool: 'bash', announce: (id) => (otherId = id) })
    expect(otherId).not.toBe('')
    broker.resolve(otherId, 'reject')
    await expect(other).resolves.toBe(false)
  })

  it('an unknown id is not ours (returns false) and settles nothing', () => {
    const broker = new ApprovalBroker()
    expect(broker.resolve('perm-nope', 'once')).toBe(false)
  })

  it('times out to denied and reports the expiry so the card can be cleared', async () => {
    const broker = new ApprovalBroker(15)
    let expired = ''
    const p = broker.ask({ tool: 'bash', announce: () => {}, expire: (id) => (expired = id) })
    await expect(p).resolves.toBe(false)
    expect(expired).toMatch(/^perm-/)
    // A reply landing after the timeout is a harmless no-op.
    expect(broker.resolve(expired, 'once')).toBe(false)
  })

  it('denyAll settles every pending ask false and returns their ids', async () => {
    const broker = new ApprovalBroker()
    const ids: string[] = []
    const a = broker.ask({ tool: 'bash', announce: (id) => ids.push(id) })
    const b = broker.ask({ tool: 'edit_file', announce: (id) => ids.push(id) })
    expect(broker.denyAll().sort()).toEqual([...ids].sort())
    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe(false)
    expect(broker.denyAll()).toEqual([])
  })
})
