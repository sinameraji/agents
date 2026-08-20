/**
 * Cost math, shared by the worker (real usage → cost on the wire) and the browser (the composer's
 * pre-send estimate). Pure functions only: no fetching, no catalog knowledge.
 */
import type { ModelInfo } from './protocol'

/**
 * Prices in USD per MILLION tokens. Those are the units the model catalog already speaks:
 * `ModelInfo.inputPerM` / `outputPerM` (protocol.ts), which every catalog source normalizes into
 * (OpenRouter's per-token `pricing.prompt` is multiplied by 1e6, the AI Gateway catalog's
 * `cost_in`/`cost_out` likewise, and the hand-kept tables are written per-million directly).
 */
export interface ModelPricing {
  inputPerM: number
  outputPerM: number
}

/**
 * Pricing for a catalog entry, or null when the catalog does not price it. A 0/0 entry (every
 * Workers AI model, for instance) means "unknown", NOT "free": treating it as free is how a
 * session ends up reading $0.00 forever and slipping past the monthly budget cap.
 */
export function pricingOf(model: Pick<ModelInfo, 'inputPerM' | 'outputPerM'> | null | undefined): ModelPricing | null {
  if (!model) return null
  const inputPerM = Number(model.inputPerM) || 0
  const outputPerM = Number(model.outputPerM) || 0
  if (inputPerM <= 0 && outputPerM <= 0) return null
  return { inputPerM, outputPerM }
}

/**
 * USD for a turn of `inputTokens` in and `outputTokens` out. `undefined` when pricing is unknown:
 * callers must then omit cost entirely. A missing number is honest; a zero is a wrong number that
 * the meter, the session total and the budget cap would all believe.
 */
export function estimateCostUsd(
  pricing: ModelPricing | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  if (!pricing) return undefined
  const input = Math.max(0, Number(inputTokens) || 0)
  const output = Math.max(0, Number(outputTokens) || 0)
  return (input / 1_000_000) * pricing.inputPerM + (output / 1_000_000) * pricing.outputPerM
}

/** Fallbacks for a session with no measured turns yet: a small-project context and a short reply. */
const FALLBACK_INPUT_TOKENS = 2000
const FALLBACK_OUTPUT_TOKENS = 400
/** The usual rough English/code ratio; good enough for a "~" chip, and cheap on every keystroke. */
const CHARS_PER_TOKEN = 4
/** How many recent turns the output average looks at. */
const OUTPUT_WINDOW = 3

/**
 * Rough token shape of the NEXT turn: the context we last sent (the whole conversation goes up
 * again every turn) plus whatever is in the draft, against the recent average reply length.
 */
export function nextTurnTokens(opts: {
  /** Input tokens the last assistant turn reported, i.e. the current context size. */
  lastInputTokens?: number
  /** Output tokens of recent assistant turns, oldest first; only the last few are used. */
  recentOutputTokens?: number[]
  /** Characters currently typed in the composer. */
  draftChars?: number
}): { input: number; output: number } {
  const context = opts.lastInputTokens && opts.lastInputTokens > 0 ? opts.lastInputTokens : FALLBACK_INPUT_TOKENS
  const draft = Math.max(0, Number(opts.draftChars) || 0)
  const recent = (opts.recentOutputTokens ?? []).filter((n) => Number.isFinite(n) && n > 0).slice(-OUTPUT_WINDOW)
  const output = recent.length
    ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
    : FALLBACK_OUTPUT_TOKENS
  return { input: context + Math.ceil(draft / CHARS_PER_TOKEN), output }
}
