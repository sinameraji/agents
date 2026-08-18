import type { NormPart, NormTurn, NormTodo, NormPermission, NormUsage, SessionStatus } from './normalize'
import type { AdapterSink, HarnessAdapter, StartConfig } from './adapters/types'
import { createAiSdkAdapter } from './adapters/aisdk'
import { createPiAdapter } from './adapters/pi'
import { createKimiflareAdapter } from './adapters/kimiflare'

export type Harness = 'aisdk' | 'pi' | 'kimiflare'

function makeAdapter(h: Harness): HarnessAdapter {
  if (h === 'pi') return createPiAdapter()
  if (h === 'kimiflare') return createKimiflareAdapter()
  return createAiSdkAdapter()
}

/** One session per bridge process (one container per Dreamweav session). */
export class BridgeSession {
  status: SessionStatus = 'idle'
  turns: NormTurn[] = []
  todos: NormTodo[] = []
  permissions: NormPermission[] = []
  private adapter: HarnessAdapter | null = null
  private current: NormTurn | null = null

  async start(harness: Harness, cfg: StartConfig) {
    this.adapter = makeAdapter(harness)
    await this.adapter.start(cfg)
    this.status = 'idle'
  }

  prompt(text: string) {
    if (!this.adapter) throw new Error('not started')
    const userTurn: NormTurn = { id: `u-${Date.now()}`, role: 'user', createdAt: Date.now(), status: 'complete', parts: [{ kind: 'text', id: `u-${Date.now()}-t`, text }] }
    this.turns.push(userTurn)
    const turn: NormTurn = { id: `a-${Date.now()}`, role: 'assistant', createdAt: Date.now(), status: 'streaming', parts: [] }
    this.turns.push(turn)
    this.current = turn
    this.status = 'busy'

    const sink: AdapterSink = {
      part: (p: NormPart) => {
        const i = turn.parts.findIndex((x) => x.id === p.id)
        if (i >= 0) turn.parts[i] = p
        else turn.parts.push(p)
      },
      usage: (u: NormUsage) => {
        turn.usage = u
      },
      todos: (t: NormTodo[]) => {
        this.todos = t
      },
      permission: (perm: NormPermission) => {
        if (!this.permissions.some((x) => x.id === perm.id)) this.permissions.push(perm)
      },
      done: (error) => {
        turn.status = error ? 'error' : 'complete'
        turn.completedAt = Date.now()
        if (error) turn.error = error
        for (const p of turn.parts) if ((p.kind === 'text' || p.kind === 'reasoning') && p.streaming) p.streaming = false
        this.status = 'idle'
      },
    }

    void this.adapter.prompt(text, sink).catch((e) => {
      turn.status = 'error'
      turn.error = { name: 'error', message: (e as Error).message }
      this.status = 'idle'
    })
  }

  async abort() {
    await this.adapter?.abort()
    this.status = 'idle'
  }

  async resolvePermission(id: string, reply: 'once' | 'always' | 'reject', note?: string) {
    this.permissions = this.permissions.filter((p) => p.id !== id)
    await this.adapter?.resolvePermission(id, reply, note)
  }

  state() {
    return { status: this.status, turns: this.turns, todos: this.todos, permissions: this.permissions }
  }
}
