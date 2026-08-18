export type SessionStatus = 'provisioning' | 'running' | 'idle' | 'review' | 'error'

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
}

// ---------------------------------------------------------------------------
// Dreamweav live types (extend the ported prototype types above).
// ---------------------------------------------------------------------------

/** Coding harness that runs inside the sandbox for a session. */
export type Harness = 'pi' | 'opencode' | 'kimiflare' | 'aisdk'

export const HARNESSES: { id: Harness; label: string; blurb: string; enabled: boolean }[] = [
  { id: 'pi', label: 'pi', blurb: 'Minimal, fast agent by Mario Zechner', enabled: true },
  { id: 'opencode', label: 'OpenCode', blurb: 'Sub-agents, permissions, LSP (by Anomaly)', enabled: false },
  { id: 'kimiflare', label: 'KimiFlare', blurb: 'Kimi K2 on your Cloudflare account', enabled: false },
  { id: 'aisdk', label: 'Built-in', blurb: 'Vercel AI SDK loop — zero extra deps', enabled: false },
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

export const DEFAULT_SETTINGS: UserSettings = {
  defaultHarness: 'pi',
  defaultProvider: 'openrouter',
  defaultModel: 'anthropic/claude-sonnet-4.5',
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
