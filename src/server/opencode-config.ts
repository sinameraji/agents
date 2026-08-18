import type { Config } from '@opencode-ai/sdk/v2'
import type { Connections, Provider } from '~shared/protocol'

/**
 * Build an OpenCode `Config.provider` block + the {providerID, modelID} to prompt with, from the
 * user's chosen provider and their BYO connections. Everything is the user's own credit/keys.
 */
export function buildOpencodeProvider(
  provider: Provider,
  model: string,
  conn: Connections,
): { config: Config; model: { providerID: string; modelID: string } } {
  switch (provider) {
    case 'openrouter':
      return {
        config: {
          provider: {
            openrouter: { options: { apiKey: conn.openrouterKey ?? '' } },
          },
        } as Config,
        model: { providerID: 'openrouter', modelID: model },
      }
    case 'cloudflare':
      return {
        config: {
          provider: {
            'cloudflare-ai-gateway': {
              options: {
                accountId: conn.cloudflareAccountId ?? '',
                gatewayId: conn.cloudflareGatewayId ?? '',
                apiToken: conn.cloudflareApiToken ?? '',
              },
            },
          },
        } as unknown as Config,
        model: { providerID: 'cloudflare-ai-gateway', modelID: model },
      }
    case 'anthropic':
      return {
        config: { provider: { anthropic: { options: { apiKey: conn.anthropicKey ?? '' } } } } as Config,
        model: { providerID: 'anthropic', modelID: model },
      }
    case 'openai':
      return {
        config: { provider: { openai: { options: { apiKey: conn.openaiKey ?? '' } } } } as Config,
        model: { providerID: 'openai', modelID: model },
      }
  }
}
