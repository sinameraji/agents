import type { AgentEvent, PermissionReply } from '~shared/agent'

/**
 * A coding harness running inside the sandbox, normalized to Agents's AgentEvent stream.
 * OpenCode is the first implementation; pi / KimiFlare / the built-in AI-SDK loop implement the
 * same interface later (the stdio ones via the `bridge/` process).
 */
export interface HarnessAdapter {
  /** Send a user prompt; returns after the prompt is accepted (events stream via onEvent). */
  prompt(text: string): Promise<void>
  /** Interrupt the current turn. */
  abort(): Promise<void>
  /** Answer a pending permission request. */
  respondPermission(id: string, reply: PermissionReply, note?: string): Promise<void>
  /** Drive the event loop until the current turn is idle or the signal aborts. */
  run(onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<void>
  dispose(): Promise<void>
}
