import type { SessionStatus } from './agent'
export type { SessionStatus }
export type SessionMode = 'plan' | 'build' | 'auto'

export type SandboxRegion = 'iad1' | 'sfo1' | 'fra1' | 'hnd1'

export interface Session {
  id: string
  name: string
  repo: string
  branch: string
  status: SessionStatus
  region: SandboxRegion
  model: string
  createdAt: string
  lastActivity: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  unread?: boolean
  messages: Message[]
  subAgents: SubAgent[]
}

export type MessageRole = 'user' | 'agent'

/** A pasted attachment shown collapsed as "[Pasted N lines]" until expanded. */
export interface PastedBlock {
  id: string
  language?: string
  lines: number
  chars: number
  content: string
}

export type AgentStepStatus = 'done' | 'running' | 'pending' | 'error'

/** A discrete action the agent performed, rendered as a progress step. */
export interface AgentStep {
  id: string
  label: string
  detail?: string
  status: AgentStepStatus
}

export interface Message {
  id: string
  role: MessageRole
  createdAt: string
  /** Prose content. */
  text?: string
  /** Collapsed pasted code chunks attached to a user message. */
  pasted?: PastedBlock[]
  /** Structured progress the agent emitted. */
  steps?: AgentStep[]
  /** Diff / file summary for agent messages. */
  diff?: {
    file: string
    added: number
    removed: number
  }[]
}

export type SubAgentStatus = 'running' | 'done' | 'queued' | 'error'

export interface SubAgent {
  id: string
  name: string
  task: string
  status: SubAgentStatus
  progress: number
  model: string
  tokensIn: number
  tokensOut: number
  steps: AgentStep[]
}

/** Rough $ / 1M tokens for the model pickers, used to estimate live cost. */
export interface ModelInfo {
  id: string
  label: string
  provider: string
  inputPerM: number
  outputPerM: number
  /** Live catalog metadata: the model accepts image input (OpenRouter `input_modalities`).
   *  Absent when the catalog doesn't say — callers fall back to the vision.ts heuristic. */
  vision?: boolean
}

// ---------------------------------------------------------------------------
// Dreamweav live types (extend the ported prototype types above).
// ---------------------------------------------------------------------------

/** Coding harness that runs inside the sandbox for a session. */
export type Harness = 'pi' | 'opencode' | 'kimiflare' | 'aisdk' | 'cfagent'

export const HARNESSES: { id: Harness; label: string; blurb: string; repoUrl: string; enabled: boolean }[] = [
  { id: 'cfagent', label: 'Agents SDK', blurb: 'Cloudflare-native: loop runs in the Durable Object, true streaming, tools via sandbox RPC', repoUrl: 'https://github.com/cloudflare/agents', enabled: true },
  { id: 'aisdk', label: 'AI SDK', blurb: 'Vercel AI SDK loop, any OpenAI-compatible model', repoUrl: 'https://github.com/vercel/ai', enabled: true },
  { id: 'kimiflare', label: 'KimiFlare', blurb: 'Kimi Moonshot models on your Cloudflare, open source, by Sina Meraji (creator of Agents)', repoUrl: 'https://github.com/sinameraji/kimiflare', enabled: true },
  { id: 'opencode', label: 'OpenCode', blurb: 'Sub-agents, permissions, LSP (by Anomaly)', repoUrl: 'https://github.com/sst/opencode', enabled: true },
  { id: 'pi', label: 'pi', blurb: 'Minimal, fast agent by Mario Zechner', repoUrl: 'https://github.com/earendil-works/pi', enabled: true },
]

/** Where LLM requests are billed / routed. */
export type Provider = 'openrouter' | 'cloudflare' | 'anthropic' | 'openai'

/** Secrets the user brings. Never leaves the server in plaintext. */
export interface Connections {
  openrouterKey?: string
  cloudflareAccountId?: string
  cloudflareApiToken?: string
  cloudflareGatewayId?: string
  anthropicKey?: string
  openaiKey?: string
  githubPat?: string
}

/** A connection field, masked for display (e.g. "sk-or-…3f9a" or null if unset). */
export type MaskedConnections = Record<keyof Connections, string | null>

export interface UserSettings {
  defaultHarness: Harness
  defaultProvider: Provider
  defaultModel: string
  /** 'auto' = run tools without asking (sandbox is the boundary); 'ask' = confirm mutating tools. */
  approvalMode: 'auto' | 'ask'
}

/** A sane default model for each provider; used when a session's provider doesn't match the
 *  stored default model's shape (e.g. an OpenRouter id on the Cloudflare gateway). */
export const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  openrouter: 'openai/gpt-5.6-luna',
  cloudflare: 'workers-ai/@cf/moonshotai/kimi-k2.7-code',
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-5.1',
}

/** Does this model id make sense for this provider's API? */
export function modelFitsProvider(provider: Provider, model: string): boolean {
  // Only workers-ai/<model> is guaranteed to work on the gateway without extra billing setup;
  // vendor/<model> ids need unified billing, so they are allowed only as an EXPLICIT user pick,
  // never as a default (this function gates defaults in createSession).
  if (provider === 'cloudflare') return model.startsWith('workers-ai/')
  if (provider === 'openrouter') return model.includes('/')
  // Anthropic/OpenAI native APIs use bare model ids, no vendor prefix.
  return !model.includes('/')
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultHarness: 'opencode',
  defaultProvider: 'openrouter',
  defaultModel: 'openai/gpt-5.6-luna',
  approvalMode: 'auto',
}

export type SessionSource =
  | { kind: 'github'; url: string; branch?: string }
  | { kind: 'blank' }
  | { kind: 'upload'; uploadKeys: string[] }

/** A file the user attached to a message (stored in R2). */
export interface Attachment {
  id: string
  name: string
  size: number
  contentType?: string
  key: string
}

/** Compact row for the sidebar; derived from a session's meta + usage. */
export interface SessionSummary {
  id: string
  name: string
  repo: string
  branch: string
  harness: Harness
  status: SessionStatus
  model: string
  region: SandboxRegion
  lastActivity: string
  costUsd: number
  unread?: boolean
}

// --- org access control (roster) -------------------------------------------------------------
export type OrgRole = 'admin' | 'member'
export type MemberStatus = 'active' | 'suspended'

/** One roster row owned by the OrgAgent. Membership only — never usage, cost, or sessions. */
export interface OrgMember {
  email: string
  role: OrgRole
  status: MemberStatus
  /** Optional monthly USD spend cap, enforced at turn start (SessionAgent.budgetGate). */
  capUsd: number | null
  /** Email of the admin who added this member (or 'bootstrap' for OWNER_EMAIL seeds). */
  addedBy: string
  addedAt: string
}
