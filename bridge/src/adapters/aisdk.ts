/**
 * Built-in harness: an in-process Vercel AI SDK (v7) agent loop with filesystem + shell tools.
 * Zero extra runtimes — just the model API. Works with any OpenAI-compatible provider (OpenRouter,
 * Cloudflare AI Gateway compat endpoint, direct OpenAI). Anthropic direct also via its compat path.
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { streamText, tool, stepCountIs, type ModelMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import type { AdapterSink, HarnessAdapter, StartConfig } from './types'
import type { NormToolState } from '../normalize'

function baseURL(cfg: StartConfig): { url: string; key: string; model: string } {
  switch (cfg.provider) {
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1', key: cfg.creds.openrouterKey ?? '', model: cfg.model }
    case 'cloudflare':
      return {
        url: `https://gateway.ai.cloudflare.com/v1/${cfg.creds.cloudflareAccountId}/${cfg.creds.cloudflareGatewayId}/compat`,
        key: cfg.creds.cloudflareApiToken ?? '',
        model: cfg.model,
      }
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1', key: cfg.creds.anthropicKey ?? '', model: cfg.model }
    case 'openai':
      return { url: 'https://api.openai.com/v1', key: cfg.creds.openaiKey ?? '', model: cfg.model }
  }
}

const SYSTEM = `You are Dreamweav's built-in coding agent, working inside an isolated Linux sandbox.
The working directory is the project root. Use the tools to read, search, edit, and run code.
Be concise. Prefer making the change and verifying it over explaining at length.`

export function createAiSdkAdapter(): HarnessAdapter {
  let cfg: StartConfig
  let messages: ModelMessage[] = []
  let controller: AbortController | null = null

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

  return {
    async start(c) {
      cfg = c
      messages = [{ role: 'system', content: SYSTEM }]
    },
    async prompt(text, sink: AdapterSink) {
      const { url, key, model } = baseURL(cfg)
      const provider = createOpenAICompatible({ name: cfg.provider, baseURL: url, apiKey: key })
      messages.push({ role: 'user', content: text })
      controller = new AbortController()

      const readonly = cfg.mode === 'plan'
      const tools = {
        bash: tool({
          description: 'Run a shell command in the project root.',
          inputSchema: z.object({ command: z.string() }),
          execute: async ({ command }) => {
            if (readonly && /\b(rm|mv|>|>>|tee|sed -i|git (commit|push)|npm i|pip install)\b/.test(command))
              return 'blocked in plan mode'
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
        ...(readonly
          ? {}
          : {
              write_file: tool({
                description: 'Write (create/overwrite) a file with content.',
                inputSchema: z.object({ path: z.string(), content: z.string() }),
                execute: async ({ path: p, content }) => {
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
      const toolStates = new Map<string, NormToolState & { name: string }>()

      try {
        const result = streamText({
          model: provider(model),
          messages,
          tools,
          stopWhen: stepCountIs(readonly ? 12 : 40),
          abortSignal: controller.signal,
        })
        for await (const ev of result.fullStream) {
          if (ev.type === 'text-delta') {
            textAcc += ev.text
            sink.part({ kind: 'text', id: textPartId, text: textAcc, streaming: true })
          } else if (ev.type === 'tool-call') {
            toolStates.set(ev.toolCallId, { name: ev.toolName, status: 'running', input: ev.input as Record<string, unknown> })
            sink.part({ kind: 'tool', id: `tc-${ev.toolCallId}`, callId: ev.toolCallId, name: ev.toolName, state: { status: 'running', input: ev.input as Record<string, unknown> } })
          } else if (ev.type === 'tool-result') {
            const prev = toolStates.get(ev.toolCallId)
            sink.part({ kind: 'tool', id: `tc-${ev.toolCallId}`, callId: ev.toolCallId, name: prev?.name ?? 'tool', state: { status: 'completed', input: prev?.input, output: String(ev.output).slice(0, 20_000) } })
          }
        }
        const finalText = await result.text
        if (finalText) sink.part({ kind: 'text', id: textPartId, text: finalText, streaming: false })
        const usage = await result.usage
        sink.usage({ input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 })
        messages.push({ role: 'assistant', content: finalText || textAcc })
        sink.done()
      } catch (e) {
        sink.done({ name: 'error', message: (e as Error).message })
      }
    },
    async abort() {
      controller?.abort()
    },
    async resolvePermission() {
      /* AI-SDK harness has no interactive approvals (plan mode gates writes instead). */
    },
    async dispose() {
      controller?.abort()
    },
  }
}
