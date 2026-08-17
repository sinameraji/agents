import type { ModelInfo } from '~shared/protocol'

/**
 * Live model catalog. OpenRouter publishes an unauthenticated /models endpoint with per-token
 * pricing; we normalize it to ModelInfo and cache in the edge cache for an hour so the picker and
 * the cost meter reflect real prices.
 */
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL = 3600

interface OpenRouterModel {
  id: string
  name: string
  pricing?: { prompt?: string; completion?: string }
}

export async function fetchOpenRouterModels(): Promise<ModelInfo[]> {
  const res = await fetch(OPENROUTER_MODELS, {
    cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
  })
  if (!res.ok) throw new Error(`OpenRouter models: ${res.status}`)
  const body = (await res.json()) as { data: OpenRouterModel[] }
  return body.data
    .map((m): ModelInfo => {
      const provider = m.id.split('/')[0] ?? 'openrouter'
      return {
        id: m.id,
        label: m.name || m.id,
        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
        inputPerM: Number(m.pricing?.prompt ?? 0) * 1_000_000,
        outputPerM: Number(m.pricing?.completion ?? 0) * 1_000_000,
      }
    })
    .filter((m) => m.inputPerM > 0 || m.outputPerM > 0)
    .sort((a, b) => a.label.localeCompare(b.label))
}
