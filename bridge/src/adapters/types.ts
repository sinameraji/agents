import type { NormPart, NormTodo, NormPermission, NormUsage } from '../normalize'

export interface StartConfig {
  provider: 'openrouter' | 'cloudflare' | 'anthropic' | 'openai'
  model: string
  cwd: string
  /** Stable Dreamweav session id — adapters use it to resume harness-side sessions across restarts. */
  sessionId?: string
  mode: 'plan' | 'build' | 'auto'
  creds: {
    openrouterKey?: string
    anthropicKey?: string
    openaiKey?: string
    cloudflareAccountId?: string
    cloudflareApiToken?: string
    cloudflareGatewayId?: string
  }
}

/** The adapter reports normalized activity to the host via these callbacks. */
export interface AdapterSink {
  /** Add or replace a part on the current assistant turn (keyed by part.id). */
  part(part: NormPart): void
  usage(usage: NormUsage): void
  todos(todos: NormTodo[]): void
  permission(p: NormPermission): void
  /** Mark the current turn finished (or errored). */
  done(error?: { name: string; message: string }): void
}

export interface HarnessAdapter {
  start(cfg: StartConfig): Promise<void>
  /**
   * Begin a new assistant turn for `text`. Resolves when the turn is fully done.
   * `mode` is the session's CURRENT mode (mid-session switches arrive per prompt);
   * adapters fall back to StartConfig.mode when it is absent, and pi ignores it entirely.
   */
  prompt(text: string, sink: AdapterSink, mode?: StartConfig['mode']): Promise<void>
  /**
   * Inject guidance into the RUNNING turn without aborting it (pi's `steer` RPC command).
   * Optional — leaving it undefined is the honest signal that the harness can only
   * stop-and-reprompt; callers must fall back to abort + prompt.
   */
  steer?(text: string): Promise<void>
  abort(): Promise<void>
  resolvePermission(id: string, reply: 'once' | 'always' | 'reject', note?: string): Promise<void>
  dispose(): Promise<void>
  /**
   * Run a harness-level slash command (compact / stats / export / commands / …). Optional —
   * leaving it undefined is the honest signal that the harness has no such surface.
   */
  command?(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; note?: string; data?: unknown }>
}
