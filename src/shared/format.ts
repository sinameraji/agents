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

export function countLines(text: string): number {
  if (text === '') return 0
  return text.split('\n').length
}
