import { describe, expect, it } from 'vitest'
import { BridgeSession } from '../bridge/src/session'
import { buildUserContent } from '../bridge/src/adapters/aisdk'
import type { AdapterSink, HarnessAdapter, PromptImage, StartConfig } from '../bridge/src/adapters/types'

/**
 * A controllable in-memory adapter. Tests drive the AdapterSink that BridgeSession hands to
 * `prompt()` and observe the session's normalized turn state — no real harness process involved.
 */
class FakeAdapter implements HarnessAdapter {
  sink: AdapterSink | null = null
  prompts: string[] = []
  modes: Array<StartConfig['mode'] | undefined> = []
  images: Array<PromptImage[] | undefined> = []
  aborts = 0
  resolved: Array<{ id: string; reply: string; note?: string }> = []
  /** What prompt() returns; never settles by default (turn stays open until sink.done). */
  promptResult: Promise<void> = new Promise(() => {})

  async start(_cfg: StartConfig): Promise<void> {}
  prompt(text: string, sink: AdapterSink, mode?: StartConfig['mode'], images?: PromptImage[]): Promise<void> {
    this.prompts.push(text)
    this.modes.push(mode)
    this.images.push(images)
    this.sink = sink
    return this.promptResult
  }
  async abort(): Promise<void> {
    this.aborts += 1
  }
  async resolvePermission(id: string, reply: 'once' | 'always' | 'reject', note?: string): Promise<void> {
    this.resolved.push({ id, reply, note })
  }
  async dispose(): Promise<void> {}
  /** Optional on the interface; attached per-test so its ABSENCE is itself a case under test. */
  steer?(text: string): Promise<void>
}

/** Inject a fake adapter into the session's private field (test-only, src untouched). */
function makeSession(): { session: BridgeSession; adapter: FakeAdapter } {
  const session = new BridgeSession()
  const adapter = new FakeAdapter()
  ;(session as unknown as { adapter: HarnessAdapter }).adapter = adapter
  return { session, adapter }
}

function sinkOf(adapter: FakeAdapter): AdapterSink {
  if (!adapter.sink) throw new Error('prompt() was never called — no sink captured')
  return adapter.sink
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('BridgeSession', () => {
  it('throws when prompted before start', () => {
    const session = new BridgeSession()
    expect(() => session.prompt('hi')).toThrow('not started')
  })

  it('prompt() records a completed user turn and an open assistant turn', () => {
    const { session, adapter } = makeSession()
    session.prompt('build me a thing')

    expect(adapter.prompts).toEqual(['build me a thing'])
    expect(session.status).toBe('busy')
    expect(session.turns).toHaveLength(2)

    const [user, assistant] = session.turns
    expect(user.role).toBe('user')
    expect(user.status).toBe('complete')
    expect(user.parts).toHaveLength(1)
    const up = user.parts[0]
    expect(up.kind).toBe('text')
    if (up.kind === 'text') expect(up.text).toBe('build me a thing')

    expect(assistant.role).toBe('assistant')
    expect(assistant.status).toBe('streaming')
    expect(assistant.parts).toEqual([])
  })

  it('prompt() forwards inline images to the adapter untouched', () => {
    const { session, adapter } = makeSession()
    const images: PromptImage[] = [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AAAA' }]
    session.prompt('what is in this screenshot?', 'build', images)
    expect(adapter.images).toEqual([images])
    // and their absence stays absent (no [] materialized for text-only prompts)
    sinkOf(adapter).done()
    session.prompt('plain text')
    expect(adapter.images).toEqual([images, undefined])
  })

  it('prompt() forwards the per-prompt mode to the adapter (mid-session switches, no restart)', () => {
    const { session, adapter } = makeSession()
    session.prompt('plan it', 'plan')
    expect(adapter.modes).toEqual(['plan'])
    // Without a mode the adapter falls back to its boot-time StartConfig.mode.
    sinkOf(adapter).done()
    session.prompt('now build')
    expect(adapter.modes).toEqual(['plan', undefined])
  })

  it('sink.part upserts by id into the current assistant turn, preserving order', () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    const sink = sinkOf(adapter)

    sink.part({ kind: 'text', id: 'p1', text: 'Wor', streaming: true })
    sink.part({ kind: 'tool', id: 't1', callId: 'c1', name: 'bash', state: { status: 'running', input: { command: 'ls' } } })
    sink.part({ kind: 'text', id: 'p1', text: 'Working…', streaming: true })
    sink.part({ kind: 'tool', id: 't1', callId: 'c1', name: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'a.txt' } })

    const assistant = session.turns[1]
    expect(assistant.parts.map((p) => p.id)).toEqual(['p1', 't1'])
    const text = assistant.parts[0]
    if (text.kind === 'text') expect(text.text).toBe('Working…')
    const tool = assistant.parts[1]
    if (tool.kind === 'tool') {
      expect(tool.state.status).toBe('completed')
      expect(tool.state.output).toBe('a.txt')
    }
  })

  it('sink.usage is last-writer-wins on the current turn', () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    const sink = sinkOf(adapter)

    sink.usage({ input: 10, output: 2 })
    sink.usage({ input: 100, output: 40, cost: 0.01 })
    expect(session.turns[1].usage).toEqual({ input: 100, output: 40, cost: 0.01 })
  })

  it('sink.todos replaces the whole list; sink.permission dedupes by id', () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    const sink = sinkOf(adapter)

    sink.todos([{ content: 'a', status: 'pending' }])
    sink.todos([{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }])
    expect(session.todos).toEqual([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ])

    sink.permission({ id: 'perm1', title: 'Allow?' })
    sink.permission({ id: 'perm1', title: 'Allow?' })
    sink.permission({ id: 'perm2', title: 'Also allow?' })
    expect(session.permissions.map((p) => p.id)).toEqual(['perm1', 'perm2'])
  })

  it('sink.done() completes the turn, clears streaming flags, and idles the session', () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    const sink = sinkOf(adapter)

    sink.part({ kind: 'text', id: 'p1', text: 'answer', streaming: true })
    sink.part({ kind: 'reasoning', id: 'r1', text: 'thought', streaming: true })
    sink.done()

    const assistant = session.turns[1]
    expect(assistant.status).toBe('complete')
    expect(typeof assistant.completedAt).toBe('number')
    expect(assistant.error).toBeUndefined()
    for (const p of assistant.parts) {
      if (p.kind === 'text' || p.kind === 'reasoning') expect(p.streaming).toBe(false)
    }
    expect(session.status).toBe('idle')
  })

  it('sink.done(error) marks the turn errored and records the error', () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    sinkOf(adapter).done({ name: 'ProviderError', message: 'rate limited' })

    const assistant = session.turns[1]
    expect(assistant.status).toBe('error')
    expect(assistant.error).toEqual({ name: 'ProviderError', message: 'rate limited' })
    expect(session.status).toBe('idle')
  })

  it('a rejected adapter.prompt marks the turn errored and idles the session', async () => {
    const { session, adapter } = makeSession()
    adapter.promptResult = Promise.reject(new Error('connection refused'))
    session.prompt('go')
    await flush()

    const assistant = session.turns[1]
    expect(assistant.status).toBe('error')
    expect(assistant.error).toEqual({ name: 'error', message: 'connection refused' })
    expect(session.status).toBe('idle')
  })

  it('abort() delegates to the adapter and idles the session', async () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    expect(session.status).toBe('busy')
    await session.abort()
    expect(adapter.aborts).toBe(1)
    expect(session.status).toBe('idle')
  })

  it('abort() before start is a safe no-op', async () => {
    const session = new BridgeSession()
    await expect(session.abort()).resolves.toBeUndefined()
    expect(session.status).toBe('idle')
  })

  it('resolvePermission removes the permission and forwards reply + note', async () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    const sink = sinkOf(adapter)
    sink.permission({ id: 'perm1', title: 'Allow bash?' })
    sink.permission({ id: 'perm2', title: 'Allow edit?' })

    await session.resolvePermission('perm1', 'always', 'trusted command')
    expect(session.permissions.map((p) => p.id)).toEqual(['perm2'])
    expect(adapter.resolved).toEqual([{ id: 'perm1', reply: 'always', note: 'trusted command' }])
  })

  it('state() snapshots status, turns, todos and permissions', () => {
    const { session, adapter } = makeSession()
    session.prompt('go')
    const sink = sinkOf(adapter)
    sink.todos([{ content: 'x', status: 'pending' }])
    sink.permission({ id: 'perm1', title: 'Allow?' })
    sink.done()

    const s = session.state()
    expect(s.status).toBe('idle')
    expect(s.turns).toHaveLength(2)
    expect(s.todos).toEqual([{ content: 'x', status: 'pending' }])
    expect(s.permissions.map((p) => p.id)).toEqual(['perm1'])
  })

  it('supports multiple sequential prompts, each with its own assistant turn', async () => {
    const { session, adapter } = makeSession()
    adapter.promptResult = Promise.resolve()

    session.prompt('first')
    sinkOf(adapter).part({ kind: 'text', id: 'a', text: 'one' })
    sinkOf(adapter).done()
    await flush() // let the ids' Date.now() tick and the resolved prompt settle

    session.prompt('second')
    sinkOf(adapter).part({ kind: 'text', id: 'b', text: 'two' })
    sinkOf(adapter).done()

    expect(adapter.prompts).toEqual(['first', 'second'])
    expect(session.turns).toHaveLength(4)
    expect(session.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(session.turns[1].status).toBe('complete')
    expect(session.turns[3].status).toBe('complete')
    const second = session.turns[3].parts[0]
    if (second.kind === 'text') expect(second.text).toBe('two')
  })
})

describe('aisdk buildUserContent', () => {
  it('stays a plain string without images (identical wire shape to before)', () => {
    expect(buildUserContent('fix the bug')).toBe('fix the bug')
    expect(buildUserContent('fix the bug', [])).toBe('fix the bug')
  })

  it('builds a multimodal part array: text first, then file parts with data URLs', () => {
    const content = buildUserContent('describe this', [
      { name: 'shot.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
      { name: 'photo.jpg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' },
    ])
    expect(content).toEqual([
      { type: 'text', text: 'describe this' },
      // AI SDK v7 FilePart: bare data-URL string as `data`, mediaType from the URL header
      // (verified against ai@7 convertToLanguageModelV4FilePart, which splits data: URLs).
      { type: 'file', data: 'data:image/png;base64,iVBORw0KGgo=', mediaType: 'image/png', filename: 'shot.png' },
      { type: 'file', data: 'data:image/jpeg;base64,/9j/4AAQ', mediaType: 'image/jpeg', filename: 'photo.jpg' },
    ])
  })
})

describe('BridgeSession.steer', () => {
  it('answers not-started before start (no adapter yet)', async () => {
    const session = new BridgeSession()
    expect(await session.steer('go left')).toEqual({ ok: false, reason: 'not started' })
  })

  it('answers unsupported when the adapter has no steer method, even mid-turn', async () => {
    const { session } = makeSession()
    session.prompt('go')
    expect(await session.steer('go left')).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('answers idle when no turn is running, so callers fall back to a normal prompt', async () => {
    const { session, adapter } = makeSession()
    adapter.steer = async () => {}
    expect(await session.steer('go left')).toEqual({ ok: false, reason: 'idle' })
  })

  it('delegates mid-turn to the adapter and records the steering message as a user turn', async () => {
    const { session, adapter } = makeSession()
    const steered: string[] = []
    adapter.steer = async (text) => {
      steered.push(text)
    }
    session.prompt('go')

    expect(await session.steer('actually, use tabs')).toEqual({ ok: true })
    expect(steered).toEqual(['actually, use tabs'])

    // The in-flight assistant turn keeps streaming; the steer lands after it, chronologically true.
    expect(session.status).toBe('busy')
    expect(session.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user'])
    expect(session.turns[1].status).toBe('streaming')
    const steerPart = session.turns[2].parts[0]
    expect(steerPart.kind).toBe('text')
    if (steerPart.kind === 'text') expect(steerPart.text).toBe('actually, use tabs')
  })

  it('a rejecting adapter.steer surfaces the reason and records no user turn', async () => {
    const { session, adapter } = makeSession()
    adapter.steer = async () => {
      throw new Error('steer rejected')
    }
    session.prompt('go')

    expect(await session.steer('nope')).toEqual({ ok: false, reason: 'steer rejected' })
    expect(session.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
  })
})

describe('mid-session model switch (restart-with-resume)', () => {
  it('restarts the adapter when the prompted model differs, and not when it matches', async () => {
    const { BridgeSession } = await import('../bridge/src/session')
    const session = new BridgeSession()
    const starts: string[] = []
    let disposed = 0
    // Swap the adapter factory via start(), then spy through the adapter contract itself:
    await session.start('aisdk', {
      provider: 'openrouter', model: 'm1', cwd: '/tmp', mode: 'build',
      creds: { openrouterKey: 'x' },
    } as never)
    // Monkey-patch the live adapter with a recorder that satisfies HarnessAdapter.
    const rec = (model: string) => ({
      start: async (c: { model: string }) => { starts.push(c.model) },
      prompt: async (_t: unknown, sink: { done: (e?: unknown) => void }) => { sink.done() },
      abort: async () => {},
      dispose: async () => { disposed++ },
    })
    ;(session as never as { adapter: unknown }).adapter = rec('m1')
    ;(session as never as { cfg: { model: string } }).cfg.model = 'm1'
    // same model: no restart, prompt starts synchronously
    session.prompt('hello', 'build', undefined, 'm1')
    expect(disposed).toBe(0)
    // new model: dispose + fresh adapter on m2 (async detour; flush it)
    session.prompt('hello', 'build', undefined, 'm2')
    await new Promise((r) => setTimeout(r, 25))
    expect(disposed).toBe(1)
    expect((session as never as { cfg: { model: string } }).cfg.model).toBe('m2')
  })
})
