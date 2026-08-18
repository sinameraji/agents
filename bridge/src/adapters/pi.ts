/**
 * pi harness (@earendil-works/pi-coding-agent). Runs `pi --mode rpc` and speaks LF-JSONL.
 * Docs: prompt/steer/abort commands; events message_update(text_delta), tool_execution_start/end,
 * agent_end. pi has no permission prompts — the sandbox is the boundary.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AdapterSink, HarnessAdapter, StartConfig } from './types'
import { JsonlProcess } from './jsonl'

const PI_PROVIDER: Record<StartConfig['provider'], string> = {
  openrouter: 'openrouter',
  anthropic: 'anthropic',
  openai: 'openai',
  cloudflare: 'openrouter',
}

export function createPiAdapter(): HarnessAdapter {
  let cfg: StartConfig
  let proc: JsonlProcess | null = null
  let sink: AdapterSink | null = null
  let resolveDone: (() => void) | null = null
  let textId = ''
  let textAcc = ''

  const handle = (ev: Record<string, unknown>) => {
    if (!sink) return
    const type = ev.type as string
    if (type === 'message_update') {
      const ame = ev.assistantMessageEvent as { type?: string; delta?: string } | undefined
      if (ame?.type === 'text_delta' && typeof ame.delta === 'string') {
        textAcc += ame.delta
        sink.part({ kind: 'text', id: textId, text: textAcc, streaming: true })
      }
      const usage = ev.usage as { input?: number; output?: number; cost?: { total?: number } } | undefined
      if (usage) sink.usage({ input: usage.input ?? 0, output: usage.output ?? 0, cost: usage.cost?.total })
    } else if (type === 'tool_execution_start') {
      const id = String(ev.toolCallId ?? '')
      sink.part({ kind: 'tool', id: `tc-${id}`, callId: id, name: String(ev.toolName ?? 'tool'), state: { status: 'running', input: ev.args as Record<string, unknown> } })
    } else if (type === 'tool_execution_end') {
      const id = String(ev.toolCallId ?? '')
      const res = ev.result as { content?: Array<{ text?: string }> } | undefined
      const out = res?.content?.map((c) => c.text ?? '').join('') ?? ''
      sink.part({ kind: 'tool', id: `tc-${id}`, callId: id, name: String(ev.toolName ?? 'tool'), state: { status: ev.isError ? 'error' : 'completed', output: out, error: ev.isError ? out : undefined } })
    } else if (type === 'extension_ui_request') {
      const id = String(ev.id ?? '')
      sink.permission({ id, title: String(ev.title ?? ev.message ?? 'Allow?'), metadata: ev })
    } else if (type === 'agent_end' || type === 'agent_settled') {
      sink.done()
      resolveDone?.()
    }
  }

  return {
    async start(c) {
      cfg = c
      const dir = path.join(os.homedir(), '.pi', 'agent')
      await fs.mkdir(dir, { recursive: true })
      const auth: Record<string, unknown> = {}
      if (c.creds.openrouterKey) auth.openrouter = { type: 'api_key', key: c.creds.openrouterKey }
      if (c.creds.anthropicKey) auth.anthropic = { type: 'api_key', key: c.creds.anthropicKey }
      if (c.creds.openaiKey) auth.openai = { type: 'api_key', key: c.creds.openaiKey }
      await fs.writeFile(path.join(dir, 'auth.json'), JSON.stringify(auth, null, 2), { mode: 0o600 })
      proc = new JsonlProcess('pi', ['--mode', 'rpc', '--provider', PI_PROVIDER[c.provider], '--model', c.model, '--no-approve'], { cwd: c.cwd, env: {} }, handle)
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
      proc?.send({ type: 'extension_ui_response', id, confirmed: reply !== 'reject' })
    },
    async dispose() {
      proc?.kill()
    },
  }
}
