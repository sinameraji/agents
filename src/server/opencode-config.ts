import type { Config } from '@opencode-ai/sdk/v2'
import type { Connections, Provider } from '~shared/protocol'

/** OpenCode provider id for each of our providers. */
function providerId(provider: Provider): string {
  return provider === 'cloudflare' ? 'cloudflare-ai-gateway' : provider
}

/**
 * A fully-formed OpenCode config for the user's provider + model, per the patterns proven in
 * launch-safely:
 *  - set `model` AND `small_model` at the top level (small_model must be pinned or OpenCode's
 *    auxiliary calls can "half-fail invisibly"); we pin small_model to the same model for safety.
 *  - DO NOT include a `models` block — an incomplete one makes OpenCode hang forever with no output.
 *  - model ref format is `<providerId>/<modelId>`.
 */
export function buildOpencodeConfig(
  provider: Provider,
  model: string,
  conn: Connections,
): { config: Config; modelRef: string } {
  const pid = providerId(provider)
  const bare = model.replace(new RegExp(`^${pid}/`), '')
  const modelRef = `${pid}/${bare}`

  let providerBlock: Record<string, unknown>
  switch (provider) {
    case 'openrouter':
      providerBlock = { openrouter: { options: { apiKey: conn.openrouterKey ?? '' } } }
      break
    case 'anthropic':
      providerBlock = { anthropic: { options: { apiKey: conn.anthropicKey ?? '' } } }
      break
    case 'openai':
      providerBlock = { openai: { options: { apiKey: conn.openaiKey ?? '' } } }
      break
    case 'cloudflare':
      providerBlock = {
        'cloudflare-ai-gateway': {
          options: {
            accountId: conn.cloudflareAccountId ?? '',
            gatewayId: conn.cloudflareGatewayId ?? '',
            apiToken: conn.cloudflareApiToken ?? '',
          },
        },
      }
      break
  }

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: modelRef,
    small_model: modelRef,
    provider: providerBlock,
  } as unknown as Config

  return { config, modelRef }
}

/** Does the user have a usable key for this provider? */
export function hasProviderKey(provider: Provider, conn: Connections): boolean {
  switch (provider) {
    case 'openrouter':
      return !!conn.openrouterKey
    case 'anthropic':
      return !!conn.anthropicKey
    case 'openai':
      return !!conn.openaiKey
    case 'cloudflare':
      return !!(conn.cloudflareApiToken && conn.cloudflareAccountId && conn.cloudflareGatewayId)
  }
}
