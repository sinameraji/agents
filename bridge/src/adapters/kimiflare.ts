/**
 * KimiFlare harness (npm `kimiflare`). Speaks the REAL RPC protocol (from src/sdk/rpc.ts +
 * types.ts in the kimiflare repo): commands new_session{cwd,config}/prompt{message}/abort/
 * resolve_permission{requestId,decision}; events session.start/end, message.start/delta/
 * reasoning/end, tool.start/result, usage, permission.request, tasks.update, status.
 * A prompt is finished when the `ok` ack carrying our command id arrives (prompt is awaited
 * server-side) or on session.end.
 */
import type { AdapterSink, HarnessAdapter, StartConfig } from './types'
import { JsonlProcess } from './jsonl'

/** Per-turn usage accumulator (reset on each prompt). */
let turnUsage: { input: number; output: number; cost?: number } = { input: 0, output: 0 }

/** The registry ids KimiFlare actually serves (kimiflare src/models/registry.ts). */
const KIMIFLARE_IDS = new Set([
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/moonshotai/kimi-k2.6',
  '@cf/moonshotai/kimi-k2.5',
  'moonshotai/kimi-k3',
  '@cf/zai-org/glm-5.2',
])

/** Map a Dreamweav model id to a KimiFlare registry id, or undefined to use KimiFlare's default. */
function kimiflareModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const id = model.replace(/^workers-ai\//, '')
  return KIMIFLARE_IDS.has(id) ? id : undefined
}

export function createKimiflareAdapter(): HarnessAdapter {
  let proc: JsonlProcess | null = null
  let mode: 'plan' | 'build' | 'auto' = 'build'
  let sink: AdapterSink | null = null
  let resolveDone: (() => void) | null = null
  let finished = false
  const PROMPT_ID = 'dw-prompt'
  let textId = ''
  let reasoningId = ''
  let textAcc = ''
  let reasoningAcc = ''
  const toolNames = new Map<string, string>()

  const finish = (error?: { name: string; message: string }) => {
    if (finished) return
    finished = true
    sink?.done(error)
    resolveDone?.()
  }

  const handle = (ev: Record<string, unknown>) => {
    if (!sink) return
    const type = ev.type as string
    if (type === 'message.delta' && typeof ev.text === 'string') {
      textAcc += ev.text
      sink.part({ kind: 'text', id: textId, text: textAcc, streaming: true })
    } else if (type === 'message.reasoning' && typeof ev.text === 'string') {
      reasoningAcc += ev.text
      sink.part({ kind: 'reasoning', id: reasoningId, text: reasoningAcc, streaming: true })
    } else if (type === 'tool.start') {
      const id = String(ev.toolCallId ?? '')
      const name = String(ev.toolName ?? 'tool')
      toolNames.set(id, name)
      sink.part({ kind: 'tool', id: `tc-${id}`, callId: id, name, state: { status: 'running', input: (ev.args ?? {}) as Record<string, unknown> } })
    } else if (type === 'tool.result') {
      const id = String(ev.toolCallId ?? '')
      const name = toolNames.get(id) ?? String(ev.toolName ?? 'tool')
      const result = String(ev.result ?? '')
      sink.part({
        kind: 'tool',
        id: `tc-${id}`,
        callId: id,
        name,
        state: ev.isError ? { status: 'error', error: result } : { status: 'completed', output: result },
      })
    } else if (type === 'usage') {
      // Multiple usage events fire per turn (one per API call); the turn total is input=max
      // (full context of the last call) + output summed — overwriting showed only the last call.
      turnUsage.input = Math.max(turnUsage.input, Number(ev.inputTokens ?? 0))
      turnUsage.output += Number(ev.outputTokens ?? 0) + Number(ev.reasoningTokens ?? 0)
      if (typeof ev.cost === 'number') turnUsage.cost = (turnUsage.cost ?? 0) + ev.cost
      sink.usage({ ...turnUsage })
    } else if (type === 'tasks.update') {
      const tasks = (Array.isArray(ev.tasks) ? ev.tasks : []) as Array<Record<string, unknown>>
      sink.todos(
        tasks.map((t) => ({
          content: String(t.title ?? t.content ?? t.description ?? ''),
          status: (() => {
            const s = String(t.status ?? 'pending')
            if (s === 'in_progress' || s === 'active') return 'in_progress' as const
            if (s === 'done' || s === 'completed') return 'completed' as const
            if (s === 'cancelled') return 'cancelled' as const
            return 'pending' as const
          })(),
        })),
      )
    } else if (type === 'permission.request') {
      sink.permission({
        id: String(ev.requestId ?? ''),
        title: `Allow ${String(ev.toolName ?? 'tool')}?`,
        input: (ev.args ?? {}) as Record<string, unknown>,
      })
    } else if (type === 'session.end') {
      const reason = String(ev.reason ?? 'complete')
      finish(reason === 'error' ? { name: 'kimiflare', message: String(ev.error ?? 'session error') } : undefined)
    } else if (type === 'ok' && ev.id === PROMPT_ID) {
      finish()
    } else if (type === 'error' && (ev.id === PROMPT_ID || ev.id === undefined)) {
      finish({ name: 'kimiflare', message: String(ev.error ?? 'error') })
    }
  }

  return {
    async start(c: StartConfig) {
      mode = c.mode
      // Brokered mode (kimiflare >= 0.99): the CLI's custom-endpoint env routes ALL model calls
      // through the host's /aig broker with a per-session bearer — no Cloudflare credentials in
      // the container. The broker path ends in /compat because the CLI appends /chat/completions.
      const env: Record<string, string> = c.proxy
        ? { KIMIFLARE_BASE_URL: `${c.proxy.baseURL}/compat`, KIMIFLARE_API_KEY: c.proxy.token }
        : {}
      proc = new JsonlProcess('kimiflare', ['--mode', 'rpc'], { cwd: c.cwd, env }, handle, (message) => {
        finish({ name: 'harness', message })
      })
      proc.send({
        type: 'new_session',
        // Resume across container/bridge restarts on CLIs >= the rpc fix; older CLIs ignore it.
        sessionId: `dw-${c.sessionId ?? 'default'}`,
        cwd: c.cwd,
        config: {
          accountId: c.proxy ? undefined : c.creds.cloudflareAccountId,
          apiToken: c.proxy ? undefined : c.creds.cloudflareApiToken,
          aiGatewayId: c.proxy ? undefined : c.creds.cloudflareGatewayId || undefined,
          // Direct path: KimiFlare takes a registry id (@cf/moonshotai/kimi-k2.7-code), so the
          // workers-ai/ prefix is stripped and only recognized Kimi/GLM ids pass. Brokered path:
          // the /aig broker fronts the gateway compat endpoint, whose catalog wants the FULL id
          // verbatim (workers-ai/@cf/...) — custom-endpoint mode passes model ids through
          // unchanged, so hand it the stored id as-is (a bare @cf/... id parses as provider
          // "@cf" at the gateway: "Invalid provider").
          model: c.proxy ? c.model || undefined : kimiflareModel(c.model),
        },
      })
    },
    async prompt(text, s, promptMode) {
      // The CURRENT mode rides each /prompt; without it a mid-session switch would keep sending
      // the stale boot-time mode forever. Dreamweav 'build' is KimiFlare's 'edit'.
      if (promptMode) mode = promptMode
      turnUsage = { input: 0, output: 0 }
      sink = s
      finished = false
      textId = `t-${Date.now()}`
      reasoningId = `r-${Date.now()}`
      textAcc = ''
      reasoningAcc = ''
      await new Promise<void>((res) => {
        resolveDone = res
        proc?.send({ id: PROMPT_ID, type: 'prompt', message: text, options: { mode: mode === 'build' ? 'edit' : mode } })
      })
    },
    async abort() {
      proc?.send({ type: 'abort' })
    },
    async resolvePermission(id, reply) {
      proc?.send({
        type: 'resolve_permission',
        requestId: id,
        decision: reply === 'reject' ? 'deny' : reply === 'always' ? 'allow_session' : 'allow',
      })
    },
    async dispose() {
      proc?.send({ type: 'dispose' })
      proc?.kill()
    },
  }
}
