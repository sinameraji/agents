/**
 * Pending-approval bookkeeping for Build mode's ask-before-mutate, shared by the aisdk bridge
 * adapter (Node, resolved via the bridge's /permission endpoint) and the SessionAgent's cfagent
 * loop (DO, resolved via the respondPermission callable). One instance per session/adapter:
 * `ask()` parks the tool call on a promise, `resolve()` settles it from the user's reply, and an
 * unanswered ask times out to denied so a walked-away-from turn never hangs forever.
 */
import type { PermissionReply } from './agent'

interface PendingAsk {
  tool: string
  timer: ReturnType<typeof setTimeout>
  settle: (allowed: boolean) => void
}

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export class ApprovalBroker {
  private pending = new Map<string, PendingAsk>()
  /** Tools the user granted with "always" — later asks for them auto-allow for this session. */
  private always = new Set<string>()

  constructor(private timeoutMs: number = APPROVAL_TIMEOUT_MS) {}

  /**
   * Ask for approval of one tool call. `announce(id)` surfaces the permission card (sink /
   * emit); `expire(id)` (optional) lets the caller clear that card if the ask times out.
   * Resolves true (allowed) or false (denied / timed out).
   */
  ask(opts: { tool: string; announce: (id: string) => void; expire?: (id: string) => void }): Promise<boolean> {
    if (this.always.has(opts.tool)) return Promise.resolve(true)
    const id = `perm-${crypto.randomUUID()}`
    return new Promise<boolean>((settle) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        opts.expire?.(id)
        settle(false)
      }, this.timeoutMs)
      this.pending.set(id, { tool: opts.tool, timer, settle })
      opts.announce(id)
    })
  }

  /** Settle a pending ask from the user's reply. False = the id is not ours (route it elsewhere). */
  resolve(id: string, reply: PermissionReply): boolean {
    const entry = this.pending.get(id)
    if (!entry) return false
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (reply === 'always') this.always.add(entry.tool)
    entry.settle(reply !== 'reject')
    return true
  }

  /** Deny everything still pending (turn stopped/aborted). Returns the denied ids so the caller
   *  can clear their cards. */
  denyAll(): string[] {
    const ids = [...this.pending.keys()]
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.settle(false)
    }
    this.pending.clear()
    return ids
  }
}
