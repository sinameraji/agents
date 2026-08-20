/**
 * Calendar-month spend accounting over LIFETIME session costs.
 *
 * The sessions index stores one lifetime cost per session (UserAgent `sessions.cost`), not a
 * dated ledger, so exact per-month attribution is impossible. Approximation: remember the
 * lifetime total at the start of each month ({ monthKey, baseline }) and count everything above
 * that baseline as this month's spend. The trade-offs, honestly:
 *
 * - The first-ever call anchors the baseline at the current total, so spend from before this
 *   accounting existed is never counted against a cap.
 * - Deleting a session removes its lifetime cost from the total. The baseline re-anchors DOWN so
 *   future spend still counts (instead of refilling invisible headroom), but whatever the deleted
 *   session spent this month is forgotten.
 * - Cost only accrues when the harness reports usage.cost (OpenCode and the bridge harnesses do;
 *   the cfagent loop reports tokens without cost, so its turns are free in this accounting).
 */
export interface SpendCheckpoint {
  /** Calendar month this baseline belongs to, e.g. "2026-08" (UTC). */
  monthKey: string
  /** Lifetime cost total (sum of sessions.cost) at the start of that month. */
  baseline: number
}

/** UTC year-month key, e.g. "2026-08". */
export function monthKeyOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Roll the checkpoint forward for `monthKey` and derive this month's spend from the lifetime
 * total. Pure: the caller persists the returned checkpoint when it changed.
 */
export function rollSpendCheckpoint(
  checkpoint: SpendCheckpoint | null,
  totalUsd: number,
  monthKey: string,
): { checkpoint: SpendCheckpoint; spentUsd: number } {
  let cp = checkpoint
  // New month (or first ever call): everything spent so far belongs to previous months.
  if (!cp || cp.monthKey !== monthKey) cp = { monthKey, baseline: totalUsd }
  // Session deletion can shrink the lifetime total below the baseline; re-anchor downward so
  // NEW spend keeps counting instead of quietly filling the gap the deletion opened.
  if (totalUsd < cp.baseline) cp = { monthKey: cp.monthKey, baseline: totalUsd }
  return { checkpoint: cp, spentUsd: Math.max(0, totalUsd - cp.baseline) }
}
