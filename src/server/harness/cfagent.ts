/**
 * The Cloudflare-native harness: a Vercel AI SDK agent loop that runs INSIDE the SessionAgent
 * Durable Object (which is itself a Cloudflare Agents SDK agent). Tools reach into the sandbox
 * over RPC (exec/readFile/writeFile), and, unlike the container harnesses, text streams to the
 * browser with true token granularity: the LLM fetch streams into the DO, and the DO broadcasts.
 */
import { streamText, generateText, tool, stepCountIs, type ModelMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import type { NormPart, NormUsage } from '~shared/agent'
import type { Connections, Provider, SessionMode } from '~shared/protocol'
import { isMutatingCommand } from '~shared/mutation-guard'

/** Minimal sandbox surface the loop needs (subset of @cloudflare/sandbox's Sandbox stub). */
export interface SandboxLike {
  exec(cmd: string, opts?: { cwd?: string; timeout?: number }): Promise<unknown>
  readFile(path: string): Promise<unknown>
  writeFile(path: string, content: string): Promise<unknown>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<unknown>
}

export interface CfAgentEmit {
  part(part: NormPart): void
  usage(usage: NormUsage): void
}

/** The model id as the provider's API expects it. Cloudflare's /ai/v1 takes Workers AI models
 *  as bare @cf/... ids (no workers-ai/ prefix) and vendor models as vendor/model. */
function wireModel(provider: Provider, model: string): string {
  return provider === 'cloudflare' ? model.replace(/^workers-ai\//, '') : model
}

/** Anthropic models via Cloudflare's unified endpoint REQUIRE max_tokens; OpenAI's gpt-5 family
 *  rejects it. Only set a cap where it's mandatory. */
function maxTokensFor(provider: Provider, model: string): number | undefined {
  return provider === 'cloudflare' && model.startsWith('anthropic/') ? 8192 : undefined
}

function providerBase(provider: Provider, conn: Connections): { url: string; key: string; headers?: Record<string, string> } {
  switch (provider) {
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1', key: conn.openrouterKey ?? '' }
    case 'cloudflare':
      // Cloudflare's unified inference endpoint: Workers AI models (@cf/...) AND vendor models
      // (openai/..., anthropic/...) via unified billing. Auth is the account token (OAuth works);
      // cf-aig-gateway-id attributes the traffic to the user's chosen gateway. NOT the
      // gateway.ai.cloudflare.com compat URL: that one forwards Authorization upstream as the
      // provider key, which is how CF tokens ended up at OpenAI.
      return {
        url: `https://api.cloudflare.com/client/v4/accounts/${conn.cloudflareAccountId}/ai/v1`,
        key: conn.cloudflareApiToken ?? '',
        headers: { 'cf-aig-gateway-id': conn.cloudflareGatewayId ?? '' },
      }
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1', key: conn.anthropicKey ?? '' }
    case 'openai':
      return { url: 'https://api.openai.com/v1', key: conn.openaiKey ?? '' }
  }
}

/** Compact a cfagent conversation: flatten the history to text and summarize it in one LLM call. */
export async function summarizeMessages(opts: {
  provider: Provider
  model: string
  creds: Connections
  messages: ModelMessage[]
}): Promise<string> {
  const { url, key, headers } = providerBase(opts.provider, opts.creds)
  const provider = createOpenAICompatible({ name: opts.provider, baseURL: url, apiKey: key, headers })
  const plain = opts.messages
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 2000)}`)
    .join('\n')
    .slice(-24_000)
  const res = await generateText({
    model: provider.chatModel(wireModel(opts.provider, opts.model)),
    maxOutputTokens: maxTokensFor(opts.provider, opts.model),
    system:
      'Summarize this coding-agent conversation into a compact briefing that preserves: the user goals, key decisions, files touched, current state, and open items. Output only the summary.',
    messages: [{ role: 'user', content: `Conversation so far:\n\n${plain}` }],
  })
  return res.text
}

const SYSTEM = `You are Agents's Cloudflare-native coding agent, working inside an isolated Linux sandbox.
The project root is /workspace. Use the tools to read, search, edit, and run code.
Be concise. Prefer making the change and verifying it over explaining at length.
You run inside Agents (agents.insertcompanywebsite.com), a browser workspace. If you start a dev server, bind 0.0.0.0
and use port 8080 (NEVER 3000, it is reserved by the sandbox). When the server is ready, call the
preview tool with its port - that opens the app right inside Agents for the user. Never link to
localhost and never try to open a browser yourself.`

const out = (v: unknown): string => {
  const o = v as { stdout?: string; exitCode?: number }
  return `exit ${o.exitCode ?? 0}\n${(o.stdout ?? '').slice(0, 20_000)}`
}

export async function runCfAgentLoop(opts: {
  sandbox: SandboxLike
  provider: Provider
  model: string
  creds: Connections
  mode: SessionMode
  messages: ModelMessage[]
  signal: AbortSignal
  emit: CfAgentEmit
  /**
   * Build mode's ask-before-mutate: resolves true (run the tool) or false (skip it). Implemented
   * by the SessionAgent as a permission card + its respondPermission callable; times out to
   * denied there. Absent = never ask (legacy behavior).
   */
  askPermission?: (title: string, metadata?: Record<string, unknown>) => Promise<boolean>
}): Promise<{ text: string; usage: NormUsage }> {
  const { sandbox, mode, emit, signal } = opts
  const { url, key, headers } = providerBase(opts.provider, opts.creds)
  const provider = createOpenAICompatible({ name: opts.provider, baseURL: url, apiKey: key, headers })
  const readonly = mode === 'plan'
  const CWD = '/workspace'
  const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  /** Build gates mutations behind the user's approval; Plan blocked already, Auto never asks. */
  const approved = async (title: string, metadata: Record<string, unknown>) =>
    mode !== 'build' || !opts.askPermission || (await opts.askPermission(title, metadata))

  const sh = async (command: string) => {
    try {
      return out(await sandbox.exec(`sh -lc ${JSON.stringify(`cd ${CWD} && ${command}`)}`, { timeout: 120_000 }))
    } catch (e) {
      return `error: ${(e as Error).message}`
    }
  }
  const abs = (p: string) => (p.startsWith('/') ? p : `${CWD}/${p}`)

  const tools = {
    bash: tool({
      description: 'Run a shell command in the project root (/workspace).',
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        // One shared detector (mutation-guard.ts) for what counts as mutating; Plan blocks it,
        // Build asks first, Auto and read-only commands run straight through.
        if (isMutatingCommand(command)) {
          if (readonly) return 'blocked in plan mode (read-only)'
          if (!(await approved(`Run: ${clip(command)}`, { tool: 'bash', command }))) return 'denied by user'
        }
        return sh(command)
      },
    }),
    read_file: tool({
      description: 'Read a file (path relative to /workspace or absolute).',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        try {
          const r = (await sandbox.readFile(abs(path))) as { content?: string }
          return (r.content ?? '').slice(0, 40_000) || '(empty file)'
        } catch (e) {
          return `error: ${(e as Error).message}`
        }
      },
    }),
    list_files: tool({
      description: 'List a directory.',
      inputSchema: z.object({ path: z.string().default('.') }),
      execute: async ({ path }) => sh(`ls -la ${path || '.'}`),
    }),
    grep: tool({
      description: 'Search file contents with ripgrep.',
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async ({ pattern, path }) => sh(`rg -n --no-heading ${JSON.stringify(pattern)} ${path ?? '.'} | head -100`),
    }),
    preview: tool({
      description:
        'Show the user a live preview of a web server you started, right inside Agents. Call this once the server is ready, with the port it listens on.',
      inputSchema: z.object({ port: z.number().int().min(1).max(65535) }),
      execute: async ({ port }) => {
        if (port === 3000)
          return 'error: port 3000 is reserved by the sandbox and cannot be previewed. Restart the server on another port (e.g. 8080), then call preview again.'
        // The agent declaring "this is the thing to look at" IS the preview signal; the part
        // auto-opens the preview pane client-side.
        emit.part({ kind: 'preview', id: `preview-${port}`, port })
        return `preview opened on port ${port}`
      },
    }),
    ...(readonly
      ? {}
      : {
          write_file: tool({
            description: 'Write (create/overwrite) a file with content.',
            inputSchema: z.object({ path: z.string(), content: z.string() }),
            execute: async ({ path, content }) => {
              if (!(await approved(`Write ${clip(path)}`, { tool: 'write_file', path }))) return 'denied by user'
              try {
                const target = abs(path)
                const dir = target.slice(0, target.lastIndexOf('/'))
                if (dir) await sandbox.mkdir(dir, { recursive: true }).catch(() => null)
                await sandbox.writeFile(target, content)
                return `wrote ${path}`
              } catch (e) {
                return `error: ${(e as Error).message}`
              }
            },
          }),
          edit_file: tool({
            description: 'Replace an exact string in a file with a new string.',
            inputSchema: z.object({ path: z.string(), old: z.string(), new: z.string() }),
            execute: async ({ path, old, new: nw }) => {
              if (!(await approved(`Edit ${clip(path)}`, { tool: 'edit_file', path }))) return 'denied by user'
              try {
                const r = (await sandbox.readFile(abs(path))) as { content?: string }
                const cur = r.content ?? ''
                if (!cur.includes(old)) return 'error: old string not found'
                await sandbox.writeFile(abs(path), cur.replace(old, nw))
                return `edited ${path}`
              } catch (e) {
                return `error: ${(e as Error).message}`
              }
            },
          }),
        }),
  }

  const textPartId = `t-${Date.now()}`
  let textAcc = ''
  let lastFlush = 0
  const flushText = (final = false) => {
    const now = Date.now()
    if (!final && now - lastFlush < 120) return
    lastFlush = now
    if (textAcc) emit.part({ kind: 'text', id: textPartId, text: textAcc, streaming: !final })
  }
  // Reasoning accumulates per stream id (one id per reasoning block in AI SDK v7 fullStream),
  // throttled like text so the DO does not broadcast every token.
  const reasoningAccs = new Map<string, string>()
  let lastReasoningFlush = 0
  const flushReasoning = (id: string, final = false) => {
    const now = Date.now()
    if (!final && now - lastReasoningFlush < 120) return
    lastReasoningFlush = now
    const acc = reasoningAccs.get(id)
    if (acc) emit.part({ kind: 'reasoning', id: `r-${id}`, text: acc, streaming: !final })
  }
  const toolNames = new Map<string, { name: string; input?: Record<string, unknown> }>()
  let streamError: string | null = null

  const result = streamText({
    model: provider.chatModel(wireModel(opts.provider, opts.model)),
    maxOutputTokens: maxTokensFor(opts.provider, opts.model),
    system: SYSTEM,
    messages: opts.messages,
    tools,
    stopWhen: stepCountIs(readonly ? 12 : 40),
    abortSignal: signal,
  })

  for await (const ev of result.fullStream) {
    if (ev.type === 'error') {
      const raw = (ev as { error?: unknown }).error
      const body = (raw as { responseBody?: string } | undefined)?.responseBody
      streamError =
        (raw instanceof Error ? raw.message : JSON.stringify(raw).slice(0, 600)) +
        (body ? ` :: ${String(body).slice(0, 400)}` : '')
    } else if (ev.type === 'text-delta') {
      textAcc += ev.text
      flushText()
    } else if (ev.type === 'reasoning-delta') {
      reasoningAccs.set(ev.id, (reasoningAccs.get(ev.id) ?? '') + ev.text)
      flushReasoning(ev.id)
    } else if (ev.type === 'reasoning-end') {
      flushReasoning(ev.id, true)
    } else if (ev.type === 'tool-call') {
      toolNames.set(ev.toolCallId, { name: ev.toolName, input: ev.input as Record<string, unknown> })
      emit.part({
        kind: 'tool',
        id: `tc-${ev.toolCallId}`,
        callId: ev.toolCallId,
        name: ev.toolName,
        state: { status: 'running', input: ev.input as Record<string, unknown> },
      })
    } else if (ev.type === 'tool-result') {
      const meta = toolNames.get(ev.toolCallId)
      emit.part({
        kind: 'tool',
        id: `tc-${ev.toolCallId}`,
        callId: ev.toolCallId,
        name: meta?.name ?? 'tool',
        state: { status: 'completed', input: meta?.input, output: String(ev.output).slice(0, 20_000) },
      })
    }
  }
  if (streamError) throw new Error(streamError)

  // Turn is over: finalize any reasoning block the stream never closed (aborted providers).
  for (const id of reasoningAccs.keys()) flushReasoning(id, true)
  const finalText = (await result.text) || textAcc
  textAcc = finalText
  flushText(true)
  const u = await result.usage
  const usage: NormUsage = { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0 }
  emit.usage(usage)
  return { text: finalText, usage }
}
