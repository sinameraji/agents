import { describe, expect, it } from 'vitest'
import { createKimiflareAcpAdapter, type AcpPeer, type SpawnAcpPeer } from '../bridge/src/adapters/kimiflare-acp'
import type { AdapterSink, StartConfig } from '../bridge/src/adapters/types'
import type { NormPart, NormPermission, NormTodo, NormUsage } from '../src/shared/agent'

type Json = Record<string, unknown>

/**
 * A scripted ACP peer standing in for the `kimiflare-acp` child process. It plugs into the
 * adapter's SpawnAcpPeer seam — the same seam JsonlProcess fills in production — so the whole
 * JSON-RPC mapping is exercised without spawning anything. Replies land on a microtask, like a
 * real peer's would.
 */
class FakePeer implements AcpPeer {
  sent: Json[] = []
  killed = 0
  /** Auto-replies for client→agent requests; anything unlisted is left pending for the test. */
  replies: Record<string, (params: Json) => Json> = {}
  /** Methods the agent rejects, answered as JSON-RPC error responses. */
  errors: Record<string, { code: number; message: string }> = {}

  constructor(
    readonly opts: { cwd: string; env: Record<string, string | undefined> },
    private readonly onMessage: (msg: Json) => void,
    readonly onFatal: (message: string) => void,
  ) {}

  send(obj: unknown) {
    const msg = obj as Json
    this.sent.push(msg)
    const method = typeof msg.method === 'string' ? msg.method : null
    if (!method || typeof msg.id !== 'number') return
    const id = msg.id
    const error = this.errors[method]
    if (error) {
      queueMicrotask(() => this.onMessage({ jsonrpc: '2.0', id, error }))
      return
    }
    const reply = this.replies[method]
    if (reply) {
      const params = (msg.params ?? {}) as Json
      queueMicrotask(() => this.onMessage({ jsonrpc: '2.0', id, result: reply(params) }))
    }
  }

  kill() {
    this.killed += 1
  }

  /** Agent → client traffic (notifications, requests, and late responses). */
  emit(msg: Json) {
    this.onMessage({ jsonrpc: '2.0', ...msg })
  }

  update(update: Json, sessionId = 'sess-1') {
    this.emit({ method: 'session/update', params: { sessionId, update } })
  }

  /** Resolve a request the test deliberately left pending (e.g. session/prompt). */
  resolve(method: string, result: Json) {
    const req = this.requests(method).at(-1)
    if (!req) throw new Error(`no pending ${method} request was sent`)
    this.emit({ id: req.id as number, result })
  }

  requests(method: string): Json[] {
    return this.sent.filter((m) => m.method === method)
  }

  last(method: string): Json {
    const m = this.requests(method).at(-1)
    if (!m) throw new Error(`${method} was never sent`)
    return m
  }

  paramsOf(method: string): Json {
    return (this.last(method).params ?? {}) as Json
  }

  /** Responses we sent back to the AGENT's requests (permission answers, unsupported errors). */
  responses(): Json[] {
    return this.sent.filter((m) => m.method === undefined && m.id !== undefined)
  }
}

/** Sink that mirrors BridgeSession's semantics: parts are upserted by stable id. */
function makeSink() {
  const parts: NormPart[] = []
  const rec = {
    parts,
    usages: [] as NormUsage[],
    todos: [] as NormTodo[],
    permissions: [] as NormPermission[],
    dones: [] as Array<{ name: string; message: string } | undefined>,
    part: (id: string) => parts.find((p) => p.id === id),
    kinds: (kind: NormPart['kind']) => parts.filter((p) => p.kind === kind),
  }
  const sink: AdapterSink = {
    part: (p) => {
      const i = parts.findIndex((x) => x.id === p.id)
      if (i >= 0) parts[i] = p
      else parts.push(p)
    },
    usage: (u) => void rec.usages.push(u),
    todos: (t) => void (rec.todos = t),
    permission: (p) => void rec.permissions.push(p),
    done: (e) => void rec.dones.push(e),
  }
  return { sink, rec }
}

const MODES = {
  currentModeId: 'edit',
  availableModes: [
    { id: 'edit', name: 'Edit' },
    { id: 'plan', name: 'Plan' },
    { id: 'auto', name: 'Auto' },
  ],
}

/** The handshake KimiFlare's ACP peer actually performs (acp/src/agent.ts initialize/newSession). */
function kimiflareHandshake(peer: FakePeer, over: { loadSession?: boolean } = {}) {
  peer.replies['initialize'] = () => ({
    protocolVersion: 1,
    agentInfo: { name: 'kimiflare', version: '0.1.0' },
    agentCapabilities: {
      loadSession: over.loadSession ?? false,
      promptCapabilities: { image: true },
      sessionCapabilities: { close: {}, list: {} },
    },
  })
  peer.replies['session/new'] = () => ({ sessionId: 'sess-1', modes: MODES })
  peer.replies['session/set_mode'] = () => ({})
  peer.replies['session/close'] = () => ({})
  // KimiFlare's ACP peer implements no loadSession; a spec-compliant agent that advertises the
  // capability but has forgotten the session answers with an error, which we must survive.
  peer.errors['session/load'] = { code: -32602, message: 'Unknown session' }
}

function baseCfg(over: Partial<StartConfig> = {}): StartConfig {
  return {
    provider: 'cloudflare',
    model: '@cf/moonshotai/kimi-k2.7-code',
    cwd: '/workspace',
    sessionId: 'abc',
    mode: 'build',
    creds: {},
    ...over,
  }
}

/** Build an adapter + the peer its seam produced. */
function harness(over: { loadSession?: boolean } = {}) {
  let peer!: FakePeer
  const spawn: SpawnAcpPeer = (opts, onMessage, onFatal) => {
    peer = new FakePeer(opts, onMessage, onFatal)
    kimiflareHandshake(peer, over)
    return peer
  }
  const adapter = createKimiflareAcpAdapter(spawn)
  return { adapter, peer: () => peer }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('kimiflare-acp adapter — handshake', () => {
  it('initializes, opens a session, and sets the mode from StartConfig', async () => {
    const h = harness()
    await h.adapter.start(baseCfg({ mode: 'plan' }))
    const peer = h.peer()

    const init = peer.paramsOf('initialize')
    expect(init.protocolVersion).toBe(1)
    // We are headless behind a sandbox: the agent must use its own fs/shell, never call back.
    expect(init.clientCapabilities).toEqual({ fs: { readTextFile: false, writeTextFile: false }, terminal: false })

    expect(peer.paramsOf('session/new')).toEqual({ cwd: '/workspace', mcpServers: [] })
    // AGENT_METHODS.session_set_mode is `session/set_mode` (snake), not `session/setMode`.
    expect(peer.paramsOf('session/set_mode')).toEqual({ sessionId: 'sess-1', modeId: 'plan' })
  })

  it('skips session/set_mode when the agent already starts in the wanted mode', async () => {
    const h = harness()
    await h.adapter.start(baseCfg({ mode: 'build' })) // build → "edit", which is already current
    expect(h.peer().requests('session/set_mode')).toHaveLength(0)
  })

  it('carries model + broker credentials on env, since ACP has no channel for them', async () => {
    const h = harness()
    await h.adapter.start(baseCfg({ proxy: { baseURL: 'https://x.dev/aig', token: 'tok' } }))
    expect(h.peer().opts.env).toEqual({
      KIMIFLARE_BASE_URL: 'https://x.dev/aig/compat',
      KIMIFLARE_API_KEY: 'tok',
      KIMI_MODEL: '@cf/moonshotai/kimi-k2.7-code',
      ACP_PERMISSION_MODE: 'edit',
    })
  })

  it('does not attempt session/load unless the agent advertises loadSession', async () => {
    const off = harness()
    await off.adapter.start(baseCfg())
    expect(off.peer().requests('session/load')).toHaveLength(0)

    const on = harness({ loadSession: true })
    await on.adapter.start(baseCfg())
    expect(on.peer().paramsOf('session/load')).toEqual({ sessionId: 'dw-abc', cwd: '/workspace', mcpServers: [] })
    // The peer rejected it (no such session) → we fall through to a fresh session/new.
    expect(on.peer().requests('session/new')).toHaveLength(1)
  })

  it('answers agent requests it does not implement so the agent never blocks', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    h.peer().emit({ id: 99, method: 'fs/read_text_file', params: { path: '/etc/hosts' } })
    expect(h.peer().responses().at(-1)).toMatchObject({ id: 99, error: { code: -32601 } })
  })
})

describe('kimiflare-acp adapter — streamed turn', () => {
  it('maps thought + message chunks to reasoning/text parts and finishes on the prompt response', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    const peer = h.peer()
    const { sink, rec } = makeSink()

    const turn = h.adapter.prompt('ship it', sink)
    await flush()

    expect(peer.paramsOf('session/prompt')).toEqual({ sessionId: 'sess-1', prompt: [{ type: 'text', text: 'ship it' }] })
    expect(rec.dones).toHaveLength(0) // the request is still open → the turn is still running

    peer.update({ sessionUpdate: 'agent_thought_chunk', messageId: 'm1', content: { type: 'text', text: 'weigh' } })
    peer.update({ sessionUpdate: 'agent_thought_chunk', messageId: 'm1', content: { type: 'text', text: 'ing…' } })
    peer.update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Hello' } })
    peer.update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: ', world' } })
    // A second assistant message in the same turn must not append to the first.
    peer.update({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: 'Done.' } })
    peer.update({ sessionUpdate: 'plan', entries: [{ content: 'wire it', status: 'in_progress', priority: 'high' }] })

    const reasoning = rec.kinds('reasoning')
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0]).toMatchObject({ text: 'weighing…', streaming: true })

    const texts = rec.kinds('text')
    expect(texts.map((p) => (p.kind === 'text' ? p.text : ''))).toEqual(['Hello, world', 'Done.'])
    expect(rec.todos).toEqual([{ content: 'wire it', status: 'in_progress', priority: 'high' }])

    peer.resolve('session/prompt', {
      stopReason: 'end_turn',
      usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160, cachedReadTokens: 100 },
    })
    await turn

    expect(rec.usages.at(-1)).toEqual({ input: 120, output: 40, reasoning: undefined, cacheRead: 100, cacheWrite: undefined, cost: undefined })
    expect(rec.dones).toEqual([undefined])
  })

  it('reports a truncating stopReason as a turn error', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    const { sink, rec } = makeSink()
    const turn = h.adapter.prompt('go', sink)
    await flush()
    h.peer().resolve('session/prompt', { stopReason: 'max_tokens' })
    await turn
    expect(rec.dones.at(-1)).toMatchObject({ name: 'max_tokens' })
  })
})

describe('kimiflare-acp adapter — tool call with permission grant', () => {
  it('surfaces the permission request, answers it by option KIND, and completes the tool part', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    const peer = h.peer()
    const { sink, rec } = makeSink()

    const turn = h.adapter.prompt('run the tests', sink)
    await flush()

    peer.update({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-7',
      title: '$ npm test',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'npm test' },
    })

    const running = rec.part('tc-call-7')
    expect(running).toMatchObject({ kind: 'tool', callId: 'call-7', name: 'execute' })
    expect(running?.kind === 'tool' && running.state).toMatchObject({ status: 'running', title: '$ npm test', input: { command: 'npm test' } })

    // The agent asks permission as a JSON-RPC REQUEST; that id is the only handle it has.
    peer.emit({
      id: 42,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'call-7', title: '$ npm test', status: 'in_progress', rawInput: { command: 'npm test' } },
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'allow_session', name: 'Allow for this session', kind: 'allow_always' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      },
    })

    expect(rec.permissions).toEqual([
      { id: 'perm-42', title: '$ npm test', toolCallId: 'call-7', input: { command: 'npm test' } },
    ])

    // 'always' must resolve to the allow_always OPTION ID the agent chose ("allow_session"),
    // which is why the match is on kind rather than on a hard-coded id.
    await h.adapter.resolvePermission('perm-42', 'always')
    expect(peer.responses().at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 42,
      result: { outcome: { outcome: 'selected', optionId: 'allow_session' } },
    })

    peer.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-7',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '187 passed' } }],
    })

    const done = rec.part('tc-call-7')
    // The update omitted kind/title/rawInput — they must survive the merge.
    expect(done).toMatchObject({ kind: 'tool', name: 'execute' })
    expect(done?.kind === 'tool' && done.state).toMatchObject({ status: 'completed', title: '$ npm test', output: '187 passed', input: { command: 'npm test' } })

    peer.resolve('session/prompt', { stopReason: 'end_turn' })
    await turn
    expect(rec.dones).toEqual([undefined])
  })

  it('maps a failed tool_call_update to an error state', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    const peer = h.peer()
    const { sink, rec } = makeSink()
    const turn = h.adapter.prompt('break it', sink)
    await flush()

    peer.update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Edit a.ts', kind: 'edit', status: 'in_progress' })
    peer.update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed', rawOutput: 'no such file' })

    const part = rec.part('tc-c1')
    expect(part?.kind === 'tool' && part.state).toMatchObject({ status: 'error', error: 'no such file' })
    expect(part?.kind === 'tool' && part.state.output).toBeUndefined()

    peer.resolve('session/prompt', { stopReason: 'end_turn' })
    await turn
  })
})

describe('kimiflare-acp adapter — abort', () => {
  it('cancels the session, releases outstanding permissions, and settles the turn cleanly', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    const peer = h.peer()
    const { sink, rec } = makeSink()

    const turn = h.adapter.prompt('long job', sink)
    await flush()

    peer.emit({
      id: 7,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess-1',
        toolCall: { toolCallId: 'c9', title: 'rm -rf /' },
        options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }],
      },
    })
    expect(rec.permissions).toHaveLength(1)

    await h.adapter.abort()

    // session/cancel is a NOTIFICATION — no id, no response expected.
    const cancel = peer.sent.filter((m) => m.method === 'session/cancel')
    expect(cancel).toEqual([{ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'sess-1' } }])
    expect(cancel[0].id).toBeUndefined()
    // An unanswered permission request would park the agent's tool loop forever.
    expect(peer.responses().at(-1)).toEqual({ jsonrpc: '2.0', id: 7, result: { outcome: { outcome: 'cancelled' } } })
    expect(rec.dones).toHaveLength(0) // still open: the agent settles the turn, not us

    // The agent acknowledges by RESOLVING the in-flight session/prompt.
    peer.resolve('session/prompt', { stopReason: 'cancelled' })
    await turn
    expect(rec.dones).toEqual([undefined]) // a user-initiated stop is not an error

    // A second permission answer for the same id is a no-op, not a duplicate response.
    const before = peer.responses().length
    await h.adapter.resolvePermission('perm-7', 'once')
    expect(peer.responses()).toHaveLength(before)
  })

  it('closes the session and kills the peer on dispose', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    await h.adapter.dispose()
    expect(h.peer().paramsOf('session/close')).toEqual({ sessionId: 'sess-1' })
    expect(h.peer().killed).toBe(1)
  })

  it('ends the turn with an error when the peer dies mid-turn', async () => {
    const h = harness()
    await h.adapter.start(baseCfg())
    const { sink, rec } = makeSink()
    const turn = h.adapter.prompt('hello', sink)
    await flush()
    h.peer().onFatal('kimiflare-acp exited with code 1')
    await turn
    expect(rec.dones.at(-1)).toMatchObject({ message: 'kimiflare-acp exited with code 1' })
  })
})
