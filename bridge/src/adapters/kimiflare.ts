/**
 * KimiFlare harness (npm `kimiflare`, by the project owner). Runs `kimiflare --mode rpc` (LF-JSONL).
 * Uses the user's Cloudflare account (Workers AI / AI Gateway). Events: text_delta, tool_call,
 * tool_result, task_update, usage, done.
 */
import type { AdapterSink, HarnessAdapter, StartConfig } from './types'
import { JsonlProcess } from './jsonl'

export function createKimiflareAdapter(): HarnessAdapter {
  let proc: JsonlProcess | null = null
  let sink: AdapterSink | null = null
  let resolveDone: (() => void) | null = null
  let textId = ''
  let textAcc = ''

  const handle = (ev: Record<string, unknown>) => {
    if (!sink) return
    const type = ev.type as string
    if (type === 'text_delta') {
      textAcc += String(ev.delta ?? ev.text ?? '')
      sink.part({ kind: 'text', id: textId, text: textAcc, streaming: true })
    } else if (type === 'tool_call') {
      const id = String(ev.id ?? ev.toolCallId ?? '')
      sink.part({ kind: 'tool', id: `tc-${id}`, callId: id, name: String(ev.tool ?? ev.name ?? 'tool'), state: { status: 'running', input: ev.args as Record<string, unknown> } })
    } else if (type === 'tool_result') {
      const id = String(ev.id ?? ev.toolCallId ?? '')
      sink.part({ kind: 'tool', id: `tc-${id}`, callId: id, name: String(ev.tool ?? ev.name ?? 'tool'), state: { status: ev.isError ? 'error' : 'completed', output: String(ev.result ?? ev.output ?? '') } })
    } else if (type === 'task_update') {
      const tasks = (ev.tasks ?? ev.todos ?? []) as Array<Record<string, unknown>>
      sink.todos(tasks.map((t) => ({ content: String(t.content ?? t.title ?? ''), status: (String(t.status ?? 'pending') as 'pending' | 'in_progress' | 'completed' | 'cancelled') })))
    } else if (type === 'usage') {
      sink.usage({ input: Number(ev.promptTokens ?? ev.input ?? 0), output: Number(ev.completionTokens ?? ev.output ?? 0), cost: typeof ev.cost === 'number' ? ev.cost : undefined })
    } else if (type === 'permission' || type === 'resolve_permission') {
      sink.permission({ id: String(ev.requestId ?? ev.id ?? ''), title: String(ev.title ?? 'Allow this tool?'), metadata: ev })
    } else if (type === 'done' || type === 'error') {
      sink.done(type === 'error' ? { name: 'error', message: String(ev.message ?? 'error') } : undefined)
      resolveDone?.()
    }
  }

  return {
    async start(c: StartConfig) {
      proc = new JsonlProcess('kimiflare', ['--mode', 'rpc'], {
        cwd: c.cwd,
        env: {
          CLOUDFLARE_ACCOUNT_ID: c.creds.cloudflareAccountId,
          CLOUDFLARE_API_TOKEN: c.creds.cloudflareApiToken,
          CLOUDFLARE_AI_GATEWAY_ID: c.creds.cloudflareGatewayId,
        },
      }, handle)
      proc.send({ type: 'new_session' })
    },
    async prompt(text, s) {
      sink = s
      textId = `t-${Date.now()}`
      textAcc = ''
      await new Promise<void>((res) => {
        resolveDone = res
        proc?.send({ type: 'prompt', message: text })
      })
    },
    async abort() {
      proc?.send({ type: 'abort' })
    },
    async resolvePermission(id, reply) {
      proc?.send({ type: 'resolve_permission', requestId: id, decision: reply === 'reject' ? 'deny' : 'allow' })
    },
    async dispose() {
      proc?.kill()
    },
  }
}
