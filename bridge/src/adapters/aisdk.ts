/**
 * Built-in harness: an in-process Vercel AI SDK (v7) agent loop with filesystem + shell tools.
 * Zero extra runtimes — just the model API. Works with any OpenAI-compatible provider (OpenRouter,
 * Cloudflare AI Gateway compat endpoint, direct OpenAI). Anthropic direct also via its compat path.
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { generateText, streamText, tool, stepCountIs, type ModelMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import type { AdapterSink, HarnessAdapter, StartConfig } from './types'
import type { NormToolState } from '../normalize'
import { ApprovalBroker } from '~shared/approvals'
import { isMutatingCommand } from '~shared/mutation-guard'

/**
 * The mode gate every mutating tool runs first. Returns null when the tool may proceed, else the
 * string to hand back as the tool result: Plan hard-blocks, Auto never asks, Build parks the call
 * on a permission ask (surfaced as a card via sink.permission, answered through /permission →
 * resolvePermission, timed out to denied by the broker). Exported for tests.
 */
export async function gateMutation(opts: {
  mode: StartConfig['mode']
  /** bash is gated only when the command can mutate; write/edit tools always pass true. */
  mutating: boolean
  broker: ApprovalBroker
  sink: AdapterSink
  tool: string
  title: string
  input?: Record<string, unknown>
}): Promise<string | null> {
  if (!opts.mutating || opts.mode === 'auto') return null
  if (opts.mode === 'plan') return 'blocked in plan mode (read-only)'
  const allowed = await opts.broker.ask({
    tool: opts.tool,
    announce: (id) => opts.sink.permission({ id, title: opts.title, input: opts.input }),
  })
  return allowed ? null : 'denied by user'
}

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function baseURL(cfg: StartConfig): { url: string; key: string; model: string; headers?: Record<string, string> } {
  switch (cfg.provider) {
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1', key: cfg.creds.openrouterKey ?? '', model: cfg.model }
    case 'cloudflare':
      // Brokered: the host's /aig route swaps the per-session bearer for a fresh
      // cf-aig-authorization on every request, so no CF credential lives in the container. The
      // broker fronts the gateway compat endpoint, which takes catalog ids verbatim
      // (workers-ai/@cf/... included) — no prefix stripping.
      if (cfg.proxy) {
        return { url: `${cfg.proxy.baseURL}/compat`, key: cfg.proxy.token, model: cfg.model }
      }
      // Direct: Cloudflare's unified inference endpoint: Workers AI models as bare @cf/... ids
      // plus vendor models via unified billing. Account-token auth; cf-aig-gateway-id attributes
      // the traffic to the user's gateway. (The RAW gateway compat URL forwards Authorization
      // upstream as the provider key — never use it here with a CF token.)
      return {
        url: `https://api.cloudflare.com/client/v4/accounts/${cfg.creds.cloudflareAccountId}/ai/v1`,
        key: cfg.creds.cloudflareApiToken ?? '',
        model: cfg.model.replace(/^workers-ai\//, ''),
        headers: { 'cf-aig-gateway-id': cfg.creds.cloudflareGatewayId ?? '' },
      }
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1', key: cfg.creds.anthropicKey ?? '', model: cfg.model }
    case 'openai':
      return { url: 'https://api.openai.com/v1', key: cfg.creds.openaiKey ?? '', model: cfg.model }
  }
}

const SYSTEM = `You are Dreamweav's built-in coding agent, working inside an isolated Linux sandbox.
The working directory is the project root. Use the tools to read, search, edit, and run code.
Be concise. Prefer making the change and verifying it over explaining at length.
If you start a dev server, bind 0.0.0.0 and use port 8080 (NEVER 3000, it is reserved by the
sandbox). When the server is ready, call the preview tool with its port - that opens the app right
inside Dreamweav for the user. Never link to localhost and never try to open a browser yourself.`

export function createAiSdkAdapter(): HarnessAdapter {
  let cfg: StartConfig
  let messages: ModelMessage[] = []
  let controller: AbortController | null = null
  const broker = new ApprovalBroker()

  const sh = (cmd: string, cwd: string, timeoutMs = 60_000) =>
    new Promise<{ stdout: string; exitCode: number }>((resolve) => {
      const p = spawn('bash', ['-lc', cmd], { cwd })
      let out = ''
      const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs)
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (out += d))
      p.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout: out.slice(0, 20_000), exitCode: code ?? 0 })
      })
    })

  const resolveIn = (rel: string) => path.resolve(cfg.cwd, rel)
  const saveHistory = () => fs.writeFile(resolveIn('.agents-history.json'), JSON.stringify(messages.slice(-80)), 'utf8').catch(() => null)

  return {
    async start(c) {
      cfg = c
      // Durable history: a bridge restart (container sleep, deploy) used to silently wipe the
      // conversation while the UI transcript looked continuous. The file lives in the workspace,
      // so it also rides the R2 snapshots.
      messages = []
      try {
        const raw = await fs.readFile(path.resolve(c.cwd, '.agents-history.json'), 'utf8')
        const parsed = JSON.parse(raw) as ModelMessage[]
        if (Array.isArray(parsed)) messages = parsed.slice(-80)
      } catch { /* fresh session */ }
    },
    async prompt(text, sink: AdapterSink, promptMode) {
      const { url, key, model, headers } = baseURL(cfg)
      const provider = createOpenAICompatible({ name: cfg.provider, baseURL: url, apiKey: key, headers })
      messages.push({ role: 'user', content: text })
      controller = new AbortController()

      // Mid-session mode switches arrive per prompt; StartConfig.mode is only the boot-time value.
      const mode = promptMode ?? cfg.mode
      const readonly = mode === 'plan'
      const tools = {
        bash: tool({
          description: 'Run a shell command in the project root.',
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            const gated = await gateMutation({
              mode,
              mutating: isMutatingCommand(command),
              broker,
              sink,
              tool: 'bash',
              title: `Run: ${clip(command)}`,
              input: { command },
            })
            if (gated) return gated
            const r = await sh(command, cfg.cwd)
            return `exit ${r.exitCode}\n${r.stdout}`
          },
        }),
        read_file: tool({
          description: 'Read a file (relative to project root).',
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path: p }) => {
            try {
              return (await fs.readFile(resolveIn(p), 'utf8')).slice(0, 40_000)
            } catch (e) {
              return `error: ${(e as Error).message}`
            }
          },
        }),
        list_files: tool({
          description: 'List a directory (relative to project root).',
          inputSchema: z.object({ path: z.string().default('.') }),
          execute: async ({ path: p }) => {
            const r = await sh(`ls -la ${p || '.'}`, cfg.cwd)
            return r.stdout
          },
        }),
        grep: tool({
          description: 'Search file contents with ripgrep.',
          inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
          execute: async ({ pattern, path: p }) => {
            const r = await sh(`rg -n --no-heading ${JSON.stringify(pattern)} ${p ?? '.'} | head -100`, cfg.cwd)
            return r.stdout || 'no matches'
          },
        }),
        preview: tool({
          description:
            'Show the user a live preview of a web server you started, right inside Dreamweav. Call this once the server is ready, with the port it listens on.',
          inputSchema: z.object({ port: z.number().int().min(1).max(65535) }),
          execute: async ({ port }) => {
            if (port === 3000)
              return 'error: port 3000 is reserved by the sandbox and cannot be previewed. Restart the server on another port (e.g. 8080), then call preview again.'
            sink.part({ kind: 'preview', id: `preview-${port}`, port })
            return `preview opened on port ${port}`
          },
        }),
        ...(readonly
          ? {}
          : {
              write_file: tool({
                description: 'Write (create/overwrite) a file with content.',
                inputSchema: z.object({ path: z.string(), content: z.string() }),
                execute: async ({ path: p, content }) => {
                  const gated = await gateMutation({ mode, mutating: true, broker, sink, tool: 'write_file', title: `Write ${clip(p)}`, input: { path: p } })
                  if (gated) return gated
                  const abs = resolveIn(p)
                  await fs.mkdir(path.dirname(abs), { recursive: true })
                  await fs.writeFile(abs, content)
                  return `wrote ${p}`
                },
              }),
              edit_file: tool({
                description: 'Replace an exact string in a file with a new string.',
                inputSchema: z.object({ path: z.string(), old: z.string(), new: z.string() }),
                execute: async ({ path: p, old, new: nw }) => {
                  const gated = await gateMutation({ mode, mutating: true, broker, sink, tool: 'edit_file', title: `Edit ${clip(p)}`, input: { path: p } })
                  if (gated) return gated
                  const abs = resolveIn(p)
                  const cur = await fs.readFile(abs, 'utf8')
                  if (!cur.includes(old)) return 'error: old string not found'
                  await fs.writeFile(abs, cur.replace(old, nw))
                  return `edited ${p}`
                },
              }),
            }),
      }

      const textPartId = `t-${Date.now()}`
      let textAcc = ''
      // Reasoning accumulates per stream id (one id per reasoning block in AI SDK v7 fullStream).
      const reasoningAccs = new Map<string, string>()
      const toolStates = new Map<string, NormToolState & { name: string }>()

      try {
        const result = streamText({
          model: provider.chatModel(model),
          system: SYSTEM,
          messages,
          tools,
          stopWhen: stepCountIs(readonly ? 12 : 40),
          abortSignal: controller.signal,
        })
        let streamError: string | null = null
        for await (const ev of result.fullStream) {
          if (ev.type === 'error') {
            const raw = (ev as { error?: unknown }).error
            streamError = raw instanceof Error ? raw.message : JSON.stringify(raw).slice(0, 500)
          } else if (ev.type === 'text-delta') {
            textAcc += ev.text
            sink.part({ kind: 'text', id: textPartId, text: textAcc, streaming: true })
          } else if (ev.type === 'reasoning-delta') {
            const acc = (reasoningAccs.get(ev.id) ?? '') + ev.text
            reasoningAccs.set(ev.id, acc)
            sink.part({ kind: 'reasoning', id: `r-${ev.id}`, text: acc, streaming: true })
          } else if (ev.type === 'reasoning-end') {
            const acc = reasoningAccs.get(ev.id)
            if (acc) sink.part({ kind: 'reasoning', id: `r-${ev.id}`, text: acc, streaming: false })
          } else if (ev.type === 'tool-call') {
            toolStates.set(ev.toolCallId, { name: ev.toolName, status: 'running', input: ev.input as Record<string, unknown> })
            sink.part({ kind: 'tool', id: `tc-${ev.toolCallId}`, callId: ev.toolCallId, name: ev.toolName, state: { status: 'running', input: ev.input as Record<string, unknown> } })
          } else if (ev.type === 'tool-result') {
            const prev = toolStates.get(ev.toolCallId)
            sink.part({ kind: 'tool', id: `tc-${ev.toolCallId}`, callId: ev.toolCallId, name: prev?.name ?? 'tool', state: { status: 'completed', input: prev?.input, output: String(ev.output).slice(0, 20_000) } })
          }
        }
        if (streamError) throw new Error(streamError)
        const finalText = await result.text
        if (finalText) sink.part({ kind: 'text', id: textPartId, text: finalText, streaming: false })
        const usage = await result.usage
        sink.usage({ input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 })
        messages.push({ role: 'assistant', content: finalText || textAcc })
        void saveHistory()
        sink.done()
      } catch (e) {
        sink.done({ name: 'error', message: (e as Error).message })
      }
    },
    async abort() {
      controller?.abort()
      broker.denyAll() // a tool parked on an ask must not hold the aborted turn open
    },
    async resolvePermission(id, reply) {
      broker.resolve(id, reply)
    },
    async command(name) {
      if (name !== 'compact') return { ok: false, note: 'Not supported.' }
      if (messages.length === 0) return { ok: true, note: 'Nothing to compact.' }
      try {
        const { url, key, model, headers } = baseURL(cfg)
        const provider = createOpenAICompatible({ name: cfg.provider, baseURL: url, apiKey: key, headers })
        const { text } = await generateText({
          model: provider.chatModel(model),
          system:
            'Summarize the conversation so far into ONE compact briefing that preserves the goals, key decisions, file paths, code changes, and outstanding work. Reply with the briefing only.',
          messages: [...messages, { role: 'user', content: 'Summarize the conversation so far into a single compact briefing.' }],
        })
        messages = [{ role: 'user', content: `Context summary of the conversation so far:\n${text}` }]
        void saveHistory()
        return { ok: true, note: 'Context compacted.' }
      } catch (e) {
        return { ok: false, note: `Compaction failed: ${(e as Error).message}` }
      }
    },
    async dispose() {
      controller?.abort()
      broker.denyAll()
    },
  }
}
