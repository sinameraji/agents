import type { Config } from '@opencode-ai/sdk/v2'
import type { Connections, Provider, SessionMode } from '~shared/protocol'

/** OpenCode provider id for each of our providers. */
function providerId(provider: Provider): string {
  return provider === 'cloudflare' ? 'cloudflare-ai-gateway' : provider
}

/**
 * Tool-permission preset for the session mode (Config['permission'], values 'ask'|'allow'|'deny'
 * per @opencode-ai/sdk v2 PermissionConfig — this is how OpenCode's own TUI distinguishes modes).
 * Build asks before file edits and shell; Auto allows everything (the sandbox is the boundary);
 * Plan uses the ask preset too, on top of the per-prompt plan agent's own agent-level rules.
 * Config only applies at process start, so a mode switch marks the process dirty (session-agent).
 */
function permissionFor(mode: SessionMode): Config['permission'] {
  return mode === 'auto'
    ? { edit: 'allow', bash: 'allow', webfetch: 'allow' }
    : { edit: 'ask', bash: 'ask', webfetch: 'allow' }
}

/**
 * A fully-formed OpenCode config for the user's provider + model, per the patterns proven in
 * launch-safely:
 *  - set `model` AND `small_model` at the top level (small_model must be pinned or OpenCode's
 *    auxiliary calls can "half-fail invisibly"); we pin small_model to the same model for safety.
 *  - DO NOT include a `models` block, an incomplete one makes OpenCode hang forever with no output.
 *  - model ref format is `<providerId>/<modelId>`.
 */
export function buildOpencodeConfig(
  provider: Provider,
  model: string,
  conn: Connections,
  /** Session mode; drives the permission preset (see permissionFor). */
  mode: SessionMode,
  /** When set (cloudflare only), model calls go through the worker's /aig broker: the worker
   *  validates this per-session bearer and stamps a fresh cf-aig-authorization upstream. */
  proxy?: { baseURL: string; token: string },
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
      // KEYLESS unified billing (verified live 2026-08-20): the gateway's OpenAI-compatible
      // endpoint serves ANY catalog model (openai/…, anthropic/…, workers-ai/@cf/…) on the
      // account's AI Gateway credits when the CF token rides in `cf-aig-authorization` and NO
      // `Authorization` header is sent — the mere presence of one flips the gateway into
      // BYOK mode and it forwards that value upstream as the provider's API key ("Incorrect
      // API key provided: cfoat…"). OpenCode's built-in cloudflare-ai-gateway provider does
      // exactly that with apiToken, so we bypass it with a bare openai-compatible provider.
      providerBlock = {
        'cloudflare-ai-gateway': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Cloudflare AI Gateway',
          options: proxy
            ? {
                // Through the worker broker: the bearer below is a per-session proxy token the
                // worker swaps for a live cf-aig-authorization — no CF credential in the container.
                baseURL: `${proxy.baseURL}/compat`,
                apiKey: proxy.token,
              }
            : {
                baseURL: `https://gateway.ai.cloudflare.com/v1/${conn.cloudflareAccountId ?? ''}/${conn.cloudflareGatewayId ?? ''}/compat`,
                headers: { 'cf-aig-authorization': `Bearer ${conn.cloudflareApiToken ?? ''}` },
              },
          // gpt-5* on chat/completions refuses function tools unless reasoning_effort is 'none'
          // (OpenAI: "Function tools with reasoning_effort are not supported for gpt-5.6-luna …").
          models: {
            [bare]: /^openai\/gpt-5/.test(bare)
              ? { name: bare, options: { reasoningEffort: 'none' } }
              : { name: bare },
          },
        },
      }
      break
  }

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: modelRef,
    small_model: modelRef,
    permission: permissionFor(mode),
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

/** Per-prompt model ref: lets a RUNNING OpenCode server follow the user's current pick
 *  (config env only applies at process start, so setModel alone never reaches a live server). */
export function opencodePromptModel(provider: Provider, model: string): { providerID: string; modelID: string } {
  const pid = providerId(provider)
  const bare = model.replace(new RegExp(`^${pid}/`), '')
  return { providerID: pid, modelID: bare }
}

/** The same pick as a `<providerId>/<modelId>` STRING: session.command takes `model` that way
 *  (types.gen.d.ts:8709), unlike promptAsync/session.shell which take the split object. */
export function opencodeModelRef(provider: Provider, model: string): string {
  const { providerID, modelID } = opencodePromptModel(provider, model)
  return `${providerID}/${modelID}`
}
