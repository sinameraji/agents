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

/**
 * Request/response correlation for pi's RPC mode: requests go out as `{id, type, ...}` and the
 * matching reply comes back as `{id, type: 'response', command, success, ...}` interleaved with the
 * event stream. Exported for tests (no pi process needed).
 */
export function createPiRpc(send: (obj: Record<string, unknown>) => void, timeoutMs = 30_000) {
  let counter = 0
  const pending = new Map<string, { resolve: (ev: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }>()
  return {
    /** True when `ev` answered a pending request (so it must NOT be treated as a stream event). */
    handle(ev: Record<string, unknown>): boolean {
      const id = typeof ev.id === 'string' ? ev.id : ''
      const entry = pending.get(id)
      if (!entry || ev.type !== 'response') return false
      pending.delete(id)
      clearTimeout(entry.timer)
      entry.resolve(ev)
      return true
    },
    request(req: Record<string, unknown>): Promise<Record<string, unknown>> {
      const id = `cmd-${++counter}`
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('timeout'))
        }, timeoutMs)
        pending.set(id, { resolve, timer })
        send({ id, ...req })
      })
    },
  }
}

/** Compact one-line summary of pi's get_session_stats response (shape is version-dependent). */
function formatStats(resp: Record<string, unknown>): string {
  const stats = resp.stats && typeof resp.stats === 'object' && !Array.isArray(resp.stats) ? (resp.stats as Record<string, unknown>) : resp
  const skip = new Set(['id', 'type', 'command', 'success'])
  const pairs: string[] = []
  for (const [k, v] of Object.entries(stats)) {
    if (skip.has(k)) continue
    if (typeof v === 'number') pairs.push(`${k}: ${v}`)
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (typeof v2 === 'number') pairs.push(`${k}.${k2}: ${v2}`)
    }
  }
  return pairs.length ? pairs.join(' · ') : 'No stats returned.'
}

/** get_commands carries an array of {name, description?, source} — field name varies, so take the first array-valued field. */
function firstArrayField(resp: Record<string, unknown>): unknown[] {
  if (Array.isArray(resp.commands)) return resp.commands
  for (const v of Object.values(resp)) if (Array.isArray(v)) return v
  return []
}

export function createPiAdapter(): HarnessAdapter {
  let cfg: StartConfig
  let proc: JsonlProcess | null = null
  let sink: AdapterSink | null = null
  let resolveDone: (() => void) | null = null
  let textId = ''
  let textAcc = ''
  const rpc = createPiRpc((obj) => proc?.send(obj))

  const handle = (ev: Record<string, unknown>) => {
    if (rpc.handle(ev)) return
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
      // Durable sessions: pi defaults to ~/.pi, which dies with the container (and is not in the
      // R2 workspace snapshot). Keep sessions in the workspace and resume the newest one so a
      // container recycle no longer silently wipes the model's memory.
      const sessDir = path.join(c.cwd, '.pi-sessions')
      await fs.mkdir(sessDir, { recursive: true })
      let resume: string[] = []
      try {
        const files = await fs.readdir(sessDir)
        const stamped = await Promise.all(
          files.map(async (f) => ({ f, m: (await fs.stat(path.join(sessDir, f))).mtimeMs })),
        )
        const newest = stamped.sort((a, b) => b.m - a.m)[0]
        if (newest) resume = ['--session', path.join(sessDir, newest.f)]
      } catch { /* fresh workspace */ }
      proc = new JsonlProcess('pi', ['--mode', 'rpc', '--provider', PI_PROVIDER[c.provider], '--model', c.model, '--no-approve', '--session-dir', sessDir, ...resume], { cwd: c.cwd, env: {} }, handle, (message) => {
        sink?.done({ name: 'harness', message })
        resolveDone?.()
      })
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
    async command(name) {
      try {
        if (name === 'compact') {
          const resp = await rpc.request({ type: 'compact' })
          if (resp.success === false) return { ok: false, note: String(resp.error ?? 'Command failed.') }
          return { ok: true, note: 'Context compacted.' }
        }
        if (name === 'stats') {
          const resp = await rpc.request({ type: 'get_session_stats' })
          if (resp.success === false) return { ok: false, note: String(resp.error ?? 'Command failed.') }
          return { ok: true, note: formatStats(resp) }
        }
        if (name === 'export') {
          const resp = await rpc.request({ type: 'export_html', outputPath: '/workspace/session-export.html' })
          if (resp.success === false) return { ok: false, note: String(resp.error ?? 'Command failed.') }
          return { ok: true, note: 'Exported to session-export.html — open it from the Files panel.' }
        }
        if (name === 'commands') {
          const resp = await rpc.request({ type: 'get_commands' })
          if (resp.success === false) return { ok: false, note: String(resp.error ?? 'Command failed.') }
          return { ok: true, data: firstArrayField(resp) }
        }
        return { ok: false, note: 'Not supported by pi.' }
      } catch {
        return { ok: false, note: 'Command timed out.' }
      }
    },
    async dispose() {
      proc?.kill()
    },
  }
}
