export type SessionStatus = 'running' | 'idle' | 'review' | 'error'

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
