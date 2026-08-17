import type { ModelInfo } from './protocol'

export const MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', provider: 'Anthropic', inputPerM: 3, outputPerM: 15 },
  { id: 'claude-opus-4.1', label: 'Claude Opus 4.1', provider: 'Anthropic', inputPerM: 15, outputPerM: 75 },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex', provider: 'OpenAI', inputPerM: 2.5, outputPerM: 10 },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', inputPerM: 1.25, outputPerM: 10 },
  { id: 'qwen3-coder', label: 'Qwen3 Coder 480B', provider: 'Alibaba', inputPerM: 0.4, outputPerM: 1.6 },
]

export const GATEWAYS = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'cloudflare', label: 'Cloudflare AI Gateway' },
  { id: 'vercel', label: 'Vercel AI Gateway' },
  { id: 'direct', label: 'Direct provider keys' },
]
