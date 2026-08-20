import type { Connections, Harness, ModelInfo, Provider } from '~shared/protocol'
import { pricingOf, type ModelPricing } from '~shared/pricing'

/**
 * The model catalog, in ONE place. It backs both the picker (`GET /api/models` in index.ts) and
 * the server-side cost accounting (`modelPricing`, used by the SessionAgent to price a cfagent
 * turn), so the prices the user sees in the picker are literally the prices we bill against.
 *
 * OpenRouter publishes an unauthenticated /models endpoint with per-token pricing; we normalize it
 * to ModelInfo and cache in the edge cache for an hour so the picker and the cost meter reflect
 * real prices.
 */
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL = 3600

interface OpenRouterModel {
  id: string
  name: string
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[] }
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
        // Live vision metadata: only set when OpenRouter actually says; absent = heuristic.
        ...(Array.isArray(m.architecture?.input_modalities)
          ? { vision: m.architecture.input_modalities.includes('image') }
          : {}),
      }
    })
    .filter((m) => m.inputPerM > 0 || m.outputPerM > 0)
    .sort((a, b) => a.label.localeCompare(b.label))
}

// KimiFlare's supported models, from its registry (src/models/registry.ts in sinameraji/kimiflare):
// the @cf/ ones are Workers AI (run on the account directly, gateway optional); kimi-k3 is a
// Cloudflare-catalog model that ONLY works via unified billing (AI Gateway credits).
const KIMIFLARE_MODELS: ModelInfo[] = [
  { id: 'workers-ai/@cf/moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code · Workers AI', provider: 'cloudflare', inputPerM: 0.95, outputPerM: 4 },
  { id: 'workers-ai/@cf/moonshotai/kimi-k2.6', label: 'Kimi K2.6 · Workers AI', provider: 'cloudflare', inputPerM: 0.95, outputPerM: 4 },
  { id: 'workers-ai/@cf/moonshotai/kimi-k2.5', label: 'Kimi K2.5 · Workers AI', provider: 'cloudflare', inputPerM: 0.55, outputPerM: 2.19 },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3 · unified billing', provider: 'cloudflare', inputPerM: 3, outputPerM: 15 },
  { id: 'workers-ai/@cf/zai-org/glm-5.2', label: 'GLM 5.2 · Workers AI', provider: 'cloudflare', inputPerM: 1.4, outputPerM: 4.4 },
]

// Fallback unified-billing catalog if the live fetch fails. Kept current by hand as a safety net.
const UNIFIED_FALLBACK: ModelInfo[] = [
  { id: 'openai/gpt-5.6-sol', label: 'gpt-5.6-sol · unified billing', provider: 'cloudflare', inputPerM: 1.25, outputPerM: 7.5 },
  { id: 'openai/gpt-5.6-luna', label: 'gpt-5.6-luna · unified billing', provider: 'cloudflare', inputPerM: 0.1, outputPerM: 0.6 },
  { id: 'openai/gpt-5.1', label: 'gpt-5.1 · unified billing', provider: 'cloudflare', inputPerM: 1.25, outputPerM: 10 },
  { id: 'openai/gpt-4.1-mini', label: 'gpt-4.1-mini · unified billing', provider: 'cloudflare', inputPerM: 0.4, outputPerM: 1.6 },
  { id: 'anthropic/claude-sonnet-4.5', label: 'claude-sonnet-4.5 · unified billing', provider: 'cloudflare', inputPerM: 3, outputPerM: 15 },
  { id: 'anthropic/claude-haiku-4.5', label: 'claude-haiku-4.5 · unified billing', provider: 'cloudflare', inputPerM: 1, outputPerM: 5 },
]

/** Live unified-billing catalog from the gateway's OpenAI-compatible /models list, filtered to
 *  chat models from providers Cloudflare bills on the user's behalf. Empty array on any failure. */
async function fetchUnifiedCatalog(acct: string, token: string, gatewayId: string): Promise<ModelInfo[]> {
  if (!gatewayId) return []
  try {
    const res = (await fetch(`https://gateway.ai.cloudflare.com/v1/${acct}/${gatewayId}/compat/models`, {
      headers: { 'cf-aig-authorization': `Bearer ${token}` },
    }).then((r) => r.json())) as { data?: Array<{ id?: string; owned_by?: string; cost_in?: number; cost_out?: number }> }
    if (!Array.isArray(res.data)) return []
    const UNIFIED_OWNERS = new Set(['openai', 'anthropic', 'google-ai-studio', 'xai', 'groq'])
    // Non-chat / specialized / duplicate variants that shouldn't clutter a coding-model picker.
    const EXCLUDE = /(:batch|embed|whisper|tts|dall|image|imagen|realtime|moderation|audio|transcribe|rerank|robotics|live|translate|omni|-vision|guard|banana|-search|lyria|veo|deep-research|computer-use|clip|learnlm|aqa|-\d{8}$)/i
    return res.data
      .filter((m) => {
        if (!m.id || !UNIFIED_OWNERS.has(String(m.owned_by))) return false
        // Skip malformed doubled-owner ids like "anthropic/anthropic/..." or "xai/xai/...".
        const parts = m.id.split('/')
        if (parts.length > 2 && parts[0] === parts[1]) return false
        return !EXCLUDE.test(m.id)
      })
      .map((m) => ({
        id: m.id!,
        label: `${m.id!.split('/').pop()} · unified billing`,
        provider: 'cloudflare',
        inputPerM: (m.cost_in ?? 0) * 1_000_000,
        outputPerM: (m.cost_out ?? 0) * 1_000_000,
      }))
  } catch {
    return []
  }
}

/** Prices we already keep by hand for specific Workers AI model ids (the KimiFlare registry).
 *  Price is a property of the MODEL, not of the harness that runs it, so the same id gets the
 *  same price on every lane — the picker and the cost meter then agree by construction. */
const HAND_PRICED = new Map(KIMIFLARE_MODELS.map((m) => [m.id, m]))

/** Cloudflare's two lanes: Workers AI models on the user's own account (the account API publishes
 *  no per-token price, so anything not in HAND_PRICED stays 0/0 = unknown, never "free") plus the
 *  unified-billing vendor models, live from the gateway catalog with the curated set as backup. */
async function cloudflareModels(conn: Connections | undefined): Promise<ModelInfo[]> {
  try {
    if (conn?.cloudflareAccountId && conn.cloudflareApiToken) {
      const res = (await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${conn.cloudflareAccountId}/ai/models/search?task=Text%20Generation&per_page=100`,
        { headers: { authorization: `Bearer ${conn.cloudflareApiToken}` } },
      ).then((r) => r.json())) as { success?: boolean; result?: Array<{ name?: string }> }
      const wai: ModelInfo[] = (res.result ?? [])
        .map((m) => String(m.name ?? ''))
        .filter(Boolean)
        .map((name) => {
          const id = `workers-ai/${name}`
          const known = HAND_PRICED.get(id)
          return {
            id,
            label: `${name.replace('@cf/', '')} · Workers AI`,
            provider: 'cloudflare',
            inputPerM: known?.inputPerM ?? 0,
            outputPerM: known?.outputPerM ?? 0,
          }
        })
      // Unified-billing vendor models, LIVE from the gateway catalog so new models (e.g. a
      // freshly-added gpt-5.6-sol) appear automatically. Fall back to the curated set.
      const live = await fetchUnifiedCatalog(conn.cloudflareAccountId, conn.cloudflareApiToken, conn.cloudflareGatewayId ?? '')
      return [...wai, ...(live.length ? live : UNIFIED_FALLBACK)]
    }
  } catch { /* fall through to the static list */ }
  return [
    { id: 'workers-ai/@cf/openai/gpt-oss-120b', label: 'gpt-oss-120b · Workers AI', provider: 'cloudflare', inputPerM: 0, outputPerM: 0 },
    { id: 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'llama-3.3-70b · Workers AI', provider: 'cloudflare', inputPerM: 0, outputPerM: 0 },
    ...UNIFIED_FALLBACK,
  ]
}

/**
 * Every model this (provider, harness) pair can run, with pricing. Throws only when OpenRouter's
 * catalog is unreachable (the route turns that into a 502); the other lanes degrade to their
 * fallback lists. Direct anthropic/openai keys have no catalog endpoint here yet, so they return
 * [] — the picker shows "no live catalog", and cost stays unknown rather than wrong.
 */
export async function modelCatalog(opts: {
  provider: Provider
  harness?: Harness | string
  conn?: Connections
}): Promise<ModelInfo[]> {
  // KimiFlare only runs Kimi/GLM models on the user's Cloudflare — show exactly those.
  if (opts.harness === 'kimiflare') return KIMIFLARE_MODELS
  if (opts.provider === 'openrouter') return fetchOpenRouterModels()
  if (opts.provider === 'cloudflare') return cloudflareModels(opts.conn)
  return []
}

/**
 * Pricing for one model id, from the same catalog the picker shows. `null` means the catalog
 * knows no price for it (unpriced Workers AI entry, provider without a catalog, model retired);
 * callers must then report no cost at all. Throws when the catalog lookup itself failed, so a
 * transient network blip is not cached as "unknown forever".
 */
export async function modelPricing(opts: {
  provider: Provider
  harness?: Harness | string
  model: string
  conn?: Connections
}): Promise<ModelPricing | null> {
  const list = await modelCatalog(opts)
  return pricingOf(list.find((m) => m.id === opts.model))
}
