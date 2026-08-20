/**
 * KimiFlare over ACP (Agent Client Protocol) — the v2-adapter-architecture PILOT.
 *
 * Ships DARK: nothing reaches it unless `KIMIFLARE_VIA_ACP` in session.ts is flipped on. The
 * bespoke `kimiflare.ts` RPC adapter stays the shipping path.
 *
 * PROTOCOL FACTS (all verified against @agentclientprotocol/sdk@0.21.1 — the same minor the peer
 * compiles against — and the peer itself at kimiflare/acp/src/{index,agent,tools}.ts):
 *
 *  - Transport is LF-delimited NDJSON JSON-RPC 2.0 over the child's stdio (SDK `ndJsonStream`),
 *    which is exactly what JsonlProcess already speaks. The peer redirects console.* to stderr so
 *    stdout is pure protocol.
 *  - Spawn: `kimiflare-acp` (bin of the UNPUBLISHED `kimiflare-acp` package that lives in the
 *    kimiflare repo under acp/). Note npm `kimiflare@0.99.0` exposes only `bin.kimiflare` — there
 *    is no `--mode acp`, so the sandbox image must install this second package for this adapter
 *    to have anything to talk to.
 *  - Client → agent: `initialize`, `session/new`, `session/load` (only if the agent advertises
 *    `agentCapabilities.loadSession`), `session/set_mode`, `session/prompt`, `session/close`, plus
 *    the `session/cancel` NOTIFICATION. Names are the AGENT_METHODS constants of the SDK.
 *  - Agent → client: the `session/update` notification (agent_message_chunk / agent_thought_chunk /
 *    tool_call / tool_call_update / plan / usage_update / current_mode_update / …) and the
 *    `session/request_permission` REQUEST, which we must answer or the agent's turn hangs forever.
 *  - A turn is over when the `session/prompt` REQUEST RESOLVES, carrying `stopReason` and an
 *    (experimental) `usage`. No separate "turn done" event exists — the request/response pairing
 *    IS the lifecycle, which is the single biggest ergonomic win over the bespoke RPC.
 *
 * Model + credentials do NOT travel over ACP: `session/new` has no model field, and this peer
 * returns no `models` state (so `session/set_model` is unavailable). Both ride env vars exactly
 * like the RPC adapter does — see start().
 */
import type {
  AgentCapabilities,
  ContentBlock,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PermissionOption,
  PlanEntry,
  PromptResponse,
  RequestPermissionRequest,
  SessionMode,
  SessionModeState,
  SessionNotification,
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
} from '@agentclientprotocol/sdk'
import type { NormToolState, NormTodo } from '../normalize'
import type { AdapterSink, HarnessAdapter, PromptImage, StartConfig } from './types'
import { JsonlProcess } from './jsonl'
import { kimiflareModel } from './kimiflare'

/** The bin the unpublished `kimiflare-acp` package installs. */
const ACP_BIN = 'kimiflare-acp'

/** The ACP major this adapter was written against (InitializeRequest.protocolVersion). */
const PROTOCOL_VERSION = 1

type Json = Record<string, unknown>

/**
 * The seam JsonlProcess sits behind. A real run spawns `kimiflare-acp`; tests hand in a scripted
 * peer so the whole mapping is exercised without a child process (and without re-implementing the
 * '\n'-only framing JsonlProcess already owns).
 */
export interface AcpPeer {
  send(obj: unknown): void
  kill(): void
}

export type SpawnAcpPeer = (
  opts: { cwd: string; env: Record<string, string | undefined> },
  onMessage: (msg: Json) => void,
  onFatal: (message: string) => void,
) => AcpPeer

const spawnKimiflareAcp: SpawnAcpPeer = (opts, onMessage, onFatal) => new JsonlProcess(ACP_BIN, [], opts, onMessage, onFatal)

/**
 * Dreamweav mode → candidate ACP mode ids, best match first. ACP does not standardize mode ids
 * (SessionMode.id is a free string the agent invents), so the only portable move is to match
 * against what `session/new` actually advertised. KimiFlare's ACP peer offers edit/plan/auto.
 */
const MODE_CANDIDATES: Record<StartConfig['mode'], string[]> = {
  plan: ['plan', 'ask', 'readonly'],
  build: ['edit', 'build', 'default', 'code'],
  auto: ['auto', 'bypasspermissions', 'acceptedits', 'yolo'],
}

const TOOL_STATUS: Record<ToolCallStatus, NormToolState['status']> = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'completed',
  failed: 'error',
}

/** `data:image/png;base64,AAA` → the two halves ACP's ImageContent block wants. */
function splitDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const m = /^data:([^;,]+)(?:;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return { mimeType: 'application/octet-stream', data: dataUrl }
  return { mimeType: m[1], data: m[2] }
}

/** Flatten a tool call's ACP content blocks into our flat `output` string + structured leftovers. */
function readToolContent(content: ToolCallContent[] | null | undefined) {
  let output = ''
  const diffs: Array<{ path: string; oldText: string | null; newText: string }> = []
  const terminals: string[] = []
  for (const block of content ?? []) {
    if (block.type === 'content') {
      if (block.content.type === 'text') output += block.content.text
    } else if (block.type === 'diff') {
      diffs.push({ path: block.path, oldText: block.oldText ?? null, newText: block.newText })
    } else if (block.type === 'terminal') {
      terminals.push(block.terminalId)
    }
  }
  return { output, diffs, terminals }
}

export function createKimiflareAcpAdapter(spawn: SpawnAcpPeer = spawnKimiflareAcp): HarnessAdapter {
  let peer: AcpPeer | null = null
  let sink: AdapterSink | null = null
  let sessionId = ''
  let caps: AgentCapabilities = {}
  let availableModes: SessionMode[] = []
  let currentModeId = ''
  let dead: string | null = null

  // --- JSON-RPC request correlation (client → agent) ---
  let nextRpcId = 0
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }>()

  // --- per-turn accumulators ---
  let turnSeq = 0
  let live = false
  const texts = new Map<string, string>()
  const thoughts = new Map<string, string>()
  const tools = new Map<string, { name: string; state: NormToolState }>()
  let turnCost: number | undefined

  // --- outstanding `session/request_permission` requests, keyed by OUR NormPermission id ---
  const perms = new Map<string, { rpcId: number; options: PermissionOption[] }>()

  const send = (obj: Json) => peer?.send({ jsonrpc: '2.0', ...obj })

  const request = (method: string, params: Json, timeoutMs = 30_000): Promise<Json> => {
    if (dead) return Promise.reject(new Error(dead))
    const id = ++nextRpcId
    return new Promise<Json>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs) : undefined
      pending.set(id, { resolve, reject, timer })
      send({ id, method, params })
    })
  }

  const respond = (id: number, result: Json) => send({ id, result })

  /** Answer a request we deliberately do not implement, so the agent never blocks on us. */
  const respondUnsupported = (id: number, method: string) => send({ id, error: { code: -32601, message: `Method not supported by this client: ${method}` } })

  const fatal = (message: string) => {
    dead = message
    for (const [, p] of pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new Error(message))
    }
    pending.clear()
    if (live) {
      live = false
      sink?.done({ name: 'harness', message })
    }
  }

  // -------------------------------------------------------------------------
  // session/update → normalized parts
  // -------------------------------------------------------------------------

  const upsertTool = (toolCallId: string, patch: Partial<NormToolState> & { name?: string }) => {
    const prev = tools.get(toolCallId) ?? { name: 'other', state: { status: 'pending' as const } }
    const { name, ...rest } = patch
    // ToolCallUpdate is a genuine PATCH: everything but toolCallId is optional and an omitted
    // field means "unchanged". A plain spread would let those absent fields (which arrive here as
    // `undefined`) erase the title/kind/rawInput the initial tool_call established.
    const state: NormToolState = { ...prev.state }
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) Object.assign(state, { [k]: v })
    }
    const next = { name: name ?? prev.name, state }
    tools.set(toolCallId, next)
    sink?.part({ kind: 'tool', id: `tc-${toolCallId}`, callId: toolCallId, name: next.name, state: next.state })
  }

  const applyUpdate = (u: SessionUpdate) => {
    if (!sink) return
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        if (u.content.type !== 'text') return
        // ACP streams *chunks*, never a running total, and `messageId` (experimental) is the only
        // thing separating two assistant messages inside one turn — the peer re-rolls it on every
        // assistant step. Without it every chunk would land in one undifferentiated blob.
        const key = `${turnSeq}-${u.messageId ?? 'm'}`
        const text = (texts.get(key) ?? '') + u.content.text
        texts.set(key, text)
        sink.part({ kind: 'text', id: `t-${key}`, text, streaming: true })
        return
      }
      case 'agent_thought_chunk': {
        if (u.content.type !== 'text') return
        const key = `${turnSeq}-${u.messageId ?? 'm'}`
        const text = (thoughts.get(key) ?? '') + u.content.text
        thoughts.set(key, text)
        sink.part({ kind: 'reasoning', id: `r-${key}`, text, streaming: true })
        return
      }
      case 'tool_call': {
        const { output, diffs, terminals } = readToolContent(u.content)
        upsertTool(u.toolCallId, {
          // ACP carries NO tool name — only a human `title` ("$ npm test") and a coarse `kind`.
          // `kind` is the machine-ish half, and our tool-card icon lookup matches on substrings
          // (read/edit/exec/search/fetch), so kind maps cleanly; the title rides in state.title.
          name: u.kind ?? 'other',
          status: TOOL_STATUS[u.status ?? 'pending'],
          title: u.title,
          input: (u.rawInput ?? undefined) as Record<string, unknown> | undefined,
          output: output || undefined,
          startedAt: Date.now(),
          metadata: diffs.length || terminals.length ? { diffs, terminals } : undefined,
        })
        return
      }
      case 'tool_call_update': {
        const { output, diffs, terminals } = readToolContent(u.content)
        const status = u.status ? TOOL_STATUS[u.status] : undefined
        const done = status === 'completed' || status === 'error'
        const text = output || (typeof u.rawOutput === 'string' ? u.rawOutput : undefined)
        upsertTool(u.toolCallId, {
          name: u.kind ?? undefined,
          status,
          title: u.title ?? undefined,
          input: (u.rawInput ?? undefined) as Record<string, unknown> | undefined,
          output: status === 'error' ? undefined : text,
          error: status === 'error' ? (text ?? 'tool failed') : undefined,
          endedAt: done ? Date.now() : undefined,
          metadata: diffs.length || terminals.length ? { diffs, terminals } : undefined,
        })
        return
      }
      case 'plan': {
        sink.todos(u.entries.map(planEntryToTodo))
        return
      }
      case 'usage_update': {
        // NOT token accounting — ACP's UsageUpdate is a CONTEXT-WINDOW meter (`used` of `size`).
        // Only the optional `cost` is something our NormUsage can honestly hold; real input/output
        // counts arrive once, in the session/prompt response.
        if (u.cost) {
          turnCost = u.cost.amount
          sink.usage({ input: 0, output: 0, cost: turnCost })
        }
        return
      }
      case 'current_mode_update': {
        currentModeId = u.currentModeId
        return
      }
      default:
        // user_message_chunk / available_commands_update / config_option_update /
        // session_info_update — nothing in our normalized model wants them yet.
        return
    }
  }

  const handle = (msg: Json) => {
    const id = typeof msg.id === 'number' ? msg.id : null
    const method = typeof msg.method === 'string' ? msg.method : null

    // A response to one of OUR requests.
    if (id !== null && method === null) {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (p.timer) clearTimeout(p.timer)
      if (msg.error) {
        const e = msg.error as { message?: string; code?: number }
        p.reject(new Error(e.message ?? `JSON-RPC error ${e.code ?? ''}`.trim()))
      } else {
        p.resolve((msg.result ?? {}) as Json)
      }
      return
    }

    // A REQUEST from the agent — every one must be answered.
    if (id !== null && method !== null) {
      if (method === 'session/request_permission') {
        const params = msg.params as unknown as RequestPermissionRequest
        // ACP gives permission requests no identity of their own; the JSON-RPC id IS the handle,
        // and it is what we must echo back to unblock the agent.
        const permId = `perm-${id}`
        perms.set(permId, { rpcId: id, options: params.options ?? [] })
        sink?.permission({
          id: permId,
          title: params.toolCall?.title ?? 'Allow this tool call?',
          toolCallId: params.toolCall?.toolCallId,
          input: (params.toolCall?.rawInput ?? undefined) as Record<string, unknown> | undefined,
        })
        return
      }
      // fs/* and terminal/* are gated by clientCapabilities we deliberately leave off.
      respondUnsupported(id, method)
      return
    }

    // A notification.
    if (method === 'session/update') {
      const params = msg.params as unknown as SessionNotification
      if (params?.update) applyUpdate(params.update)
    }
  }

  // -------------------------------------------------------------------------

  const applyModes = (modes: SessionModeState | null | undefined) => {
    availableModes = modes?.availableModes ?? []
    currentModeId = modes?.currentModeId ?? ''
  }

  const modeIdFor = (want: StartConfig['mode']): string | undefined => {
    const ids = availableModes.map((m) => m.id)
    for (const candidate of MODE_CANDIDATES[want]) {
      const hit = ids.find((id) => id.toLowerCase() === candidate)
      if (hit) return hit
    }
    return undefined
  }

  const setMode = async (want: StartConfig['mode']) => {
    const id = modeIdFor(want)
    if (!id || id === currentModeId) return
    // AGENT_METHODS.session_set_mode — note kimiflare's own acp/src/integration.test.ts sends
    // "session/setMode", which the SDK router does not know; the constant is the source of truth.
    await request('session/set_mode', { sessionId, modeId: id }).catch(() => {})
    currentModeId = id
  }

  return {
    async start(c: StartConfig) {
      const env: Record<string, string> = {}
      if (c.proxy) {
        // Same brokered path as the RPC adapter: the CLI's custom OpenAI-compatible endpoint
        // (KIMIFLARE_BASE_URL + KIMIFLARE_API_KEY) is a complete setup on its own, so no
        // Cloudflare credentials enter the container.
        env.KIMIFLARE_BASE_URL = `${c.proxy.baseURL}/compat`
        env.KIMIFLARE_API_KEY = c.proxy.token
      } else {
        if (c.creds.cloudflareAccountId) env.CLOUDFLARE_ACCOUNT_ID = c.creds.cloudflareAccountId
        if (c.creds.cloudflareApiToken) env.CLOUDFLARE_API_TOKEN = c.creds.cloudflareApiToken
        if (c.creds.cloudflareGatewayId) env.KIMIFLARE_AI_GATEWAY_ID = c.creds.cloudflareGatewayId
      }
      // ACP has no model channel here (session/new takes none, and this peer advertises no
      // `models` state so session/set_model is off the table) — KIMI_MODEL is the only lever.
      const model = c.proxy ? c.model || undefined : kimiflareModel(c.model)
      if (model) env.KIMI_MODEL = model
      // Best-effort initial mode, so the very first turn is not briefly in the peer's default.
      const initialMode = MODE_CANDIDATES[c.mode][0]
      if (initialMode) env.ACP_PERMISSION_MODE = initialMode

      peer = spawn({ cwd: c.cwd, env }, handle, fatal)

      const init = (await request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'agents-bridge', version: '1' },
        // We are a headless client behind a sandbox: the agent must use its OWN fs and shell.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      })) as unknown as InitializeResponse
      caps = init.agentCapabilities ?? {}

      // Resume across bridge restarts when the agent says it can. KimiFlare's ACP peer does NOT
      // advertise loadSession today, so this always falls through to session/new — the branch is
      // the protocol-correct path, not dead weight.
      const resumeId = c.sessionId ? `dw-${c.sessionId}` : ''
      if (caps.loadSession && resumeId) {
        try {
          const loaded = (await request('session/load', { sessionId: resumeId, cwd: c.cwd, mcpServers: [] })) as unknown as LoadSessionResponse
          sessionId = resumeId
          applyModes(loaded.modes)
        } catch {
          /* no such session — fall through to a fresh one */
        }
      }
      if (!sessionId) {
        const created = (await request('session/new', { cwd: c.cwd, mcpServers: [] })) as unknown as NewSessionResponse
        sessionId = created.sessionId
        applyModes(created.modes)
      }
      await setMode(c.mode)
    },

    async prompt(text: string, s: AdapterSink, promptMode?: StartConfig['mode'], images?: PromptImage[]) {
      sink = s
      turnSeq += 1
      texts.clear()
      thoughts.clear()
      tools.clear()
      turnCost = undefined
      live = true

      if (promptMode) await setMode(promptMode)

      const prompt: ContentBlock[] = [{ type: 'text', text }]
      // Only sent when the caps manifest lets images through; the peer advertises
      // promptCapabilities.image === true.
      if (caps.promptCapabilities?.image) {
        for (const img of images ?? []) {
          const { mimeType, data } = splitDataUrl(img.dataUrl)
          prompt.push({ type: 'image', mimeType, data })
        }
      }

      try {
        // No timeout: the response IS the end of the turn, and turns are unbounded.
        const res = (await request('session/prompt', { sessionId, prompt }, 0)) as unknown as PromptResponse
        if (res.usage) {
          sink.usage({
            input: res.usage.inputTokens ?? 0,
            output: res.usage.outputTokens ?? 0,
            reasoning: res.usage.thoughtTokens ?? undefined,
            cacheRead: res.usage.cachedReadTokens ?? undefined,
            cacheWrite: res.usage.cachedWriteTokens ?? undefined,
            cost: turnCost,
          })
        }
        live = false
        sink.done(stopReasonError(res.stopReason))
      } catch (e) {
        live = false
        sink.done({ name: 'kimiflare-acp', message: (e as Error).message })
      }
    },

    async abort() {
      // A notification, not a request: the agent acknowledges by RESOLVING the in-flight
      // session/prompt with stopReason "cancelled", which is what settles the turn.
      send({ method: 'session/cancel', params: { sessionId } })
      // The spec requires the client to answer every outstanding permission request; an
      // unanswered one would leave the agent's tool loop parked forever.
      for (const [, p] of perms) respond(p.rpcId, { outcome: { outcome: 'cancelled' } })
      perms.clear()
    },

    async resolvePermission(id: string, reply: 'once' | 'always' | 'reject') {
      const p = perms.get(id)
      if (!p) return
      perms.delete(id)
      const wanted: PermissionOption['kind'] = reply === 'reject' ? 'reject_once' : reply === 'always' ? 'allow_always' : 'allow_once'
      // Option ids are agent-chosen strings; only `kind` is portable, so match on kind and
      // degrade to the nearest same-polarity option rather than guessing an id.
      const fallback: PermissionOption['kind'] = reply === 'reject' ? 'reject_always' : 'allow_once'
      const option = p.options.find((o) => o.kind === wanted) ?? p.options.find((o) => o.kind === fallback)
      respond(p.rpcId, option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } })
    },

    async dispose() {
      if (sessionId && caps.sessionCapabilities?.close) {
        await request('session/close', { sessionId }, 5_000).catch(() => {})
      }
      peer?.kill()
      peer = null
    },
  }
}

function planEntryToTodo(entry: PlanEntry): NormTodo {
  return {
    content: entry.content,
    status: entry.status === 'in_progress' ? 'in_progress' : entry.status === 'completed' ? 'completed' : 'pending',
    priority: entry.priority === 'high' || entry.priority === 'low' ? entry.priority : 'medium',
  }
}

/** `end_turn` and `cancelled` are clean endings; the rest truncated the turn and must say so. */
function stopReasonError(reason: PromptResponse['stopReason']): { name: string; message: string } | undefined {
  switch (reason) {
    case 'max_tokens':
      return { name: 'max_tokens', message: 'The model hit its output token limit before finishing.' }
    case 'max_turn_requests':
      return { name: 'max_turn_requests', message: 'The agent hit its per-turn request limit before finishing.' }
    case 'refusal':
      return { name: 'refusal', message: 'The agent refused to continue this turn.' }
    default:
      return undefined
  }
}
