import type { ModelInfo } from './protocol'

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

export function formatCost(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(3)}`
}

/** Estimate cost in USD from token counts and a model's per-1M pricing. */
export function estimateCost(tokensIn: number, tokensOut: number, model?: ModelInfo): number {
  if (!model) return 0
  return (tokensIn / 1_000_000) * model.inputPerM + (tokensOut / 1_000_000) * model.outputPerM
}

export function countLines(text: string): number {
  if (text === '') return 0
  return text.split('\n').length
}
