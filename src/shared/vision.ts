/**
 * The MODEL axis of image input. Harness support (the pipe) lives in harness-caps.ts
 * `promptCapabilities.image`; this file answers the other half: does the currently selected
 * model actually accept image input? Both must be true before the DO inlines an image into a
 * turn — otherwise the image still lands in /workspace/uploads as a plain file.
 */
import type { Provider } from './protocol'

/** Images larger than this are never inlined into a prompt (they stay workspace files). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
/** Combined inline-image budget per turn; images beyond it stay workspace files. */
export const MAX_TURN_IMAGE_BYTES = 8 * 1024 * 1024

/** Mimes we treat as model-attachable images (what vision APIs commonly accept). */
export const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const EXT_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * The attachment's image mime, or null when it is not an image. Prefers the recorded mime;
 * falls back to the file extension for attachments uploaded before mimes were stored.
 */
export function imageMimeOf(att: { name: string; mime?: string }): string | null {
  if (att.mime && IMAGE_MIMES.has(att.mime.toLowerCase())) return att.mime.toLowerCase()
  if (att.mime) return null // a real, non-image mime is trusted (don't guess from the name)
  const ext = att.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIMES[ext] ?? null
}

/**
 * Family heuristic over a (possibly vendor-prefixed) model id — used verbatim for OpenRouter ids
 * (anthropic/claude-…, openai/gpt-…) and Cloudflare's unified-billing catalog (same prefixes,
 * plus google-ai-studio/gemini-…).
 */
function familyAcceptsImages(id: string): boolean {
  // anthropic: every claude-3+ generation (sonnet/opus/haiku) is vision-capable; only the long-gone claude-1/2/instant were text-only.
  if (id.includes('claude')) return !/claude-(1|2|instant)/.test(id)
  // openai: gpt-4o / gpt-4.1 / gpt-4-turbo / gpt-5* (codex included) / chatgpt-4o all take image input.
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|chatgpt-4o/.test(id)) return true
  // openai o-series with vision: o1 and o1-pro (o1-mini/o1-preview are text-only).
  if (/(^|\/)o1(-pro)?(-\d{4}|$)/.test(id)) return true
  // openai o-series with vision: o3 and o3-pro (o3-mini is text-only).
  if (/(^|\/)o3(-pro)?(-\d{4}|$)/.test(id)) return true
  // openai o4-mini is the one vision-capable -mini in the o-series.
  if (/(^|\/)o4-mini/.test(id)) return true
  // google: gemini 1.5+ and 2.x are natively multimodal (image input on every chat variant).
  if (id.includes('gemini')) return true
  // llama 4 (scout/maverick) is natively multimodal.
  if (id.includes('llama-4')) return true
  // gemma 3 takes images from 4b up; only the 1b variant is text-only.
  if (id.includes('gemma-3') && !id.includes('gemma-3-1b')) return true
  // generic vision-language markers: *-vision-* ids (llama-3.2-11b-vision, grok-vision, …).
  if (id.includes('vision')) return true
  // the VL (vision-language) naming convention: qwen2.5-vl-72b, qwen-vl-plus, qwen3-vl, ….
  if (/(^|[/.-])vl(-|$)/.test(id)) return true
  // Mistral's Pixtral family is vision-native.
  if (id.includes('pixtral')) return true
  return false
}

/** Workers AI (`workers-ai/@cf/...`): text-generation catalog is text-only except the known vision models. */
function workersAiAcceptsImages(id: string): boolean {
  // @cf/meta/llama-3.2-11b-vision-instruct — the catalog's explicit vision-instruct model.
  if (id.includes('vision')) return true
  // @cf/llava-hf/llava-1.5-7b-hf — LLaVA is a vision-language model.
  if (id.includes('llava')) return true
  // @cf/meta/llama-4-scout-17b-16e-instruct — Llama 4 is natively multimodal.
  if (id.includes('llama-4')) return true
  // @cf/google/gemma-3-12b-it — Gemma 3 (4b+) takes image input.
  if (id.includes('gemma-3') && !id.includes('gemma-3-1b')) return true
  // everything else in the Workers AI text-generation catalog is text-only.
  return false
}

/**
 * Whether image input reaches this model. `liveVision`, when the caller has it (the model
 * picker's OpenRouter catalog carries `input_modalities`), beats the heuristic in either
 * direction; without it the family heuristic decides.
 */
export function modelAcceptsImages(provider: Provider, model: string, liveVision?: boolean): boolean {
  if (typeof liveVision === 'boolean') return liveVision
  const id = model.toLowerCase()
  switch (provider) {
    case 'anthropic':
      // direct Anthropic: bare claude ids (claude-sonnet-4-5, claude-3-5-haiku-…).
      return familyAcceptsImages(id)
    case 'openai':
      // direct OpenAI: bare gpt/o-series ids.
      return familyAcceptsImages(id)
    case 'cloudflare':
      // Workers AI models keep their workers-ai/@cf/... prefix through our catalog.
      if (id.startsWith('workers-ai/')) return workersAiAcceptsImages(id)
      // unified-billing vendor ids (anthropic/…, openai/…, google-ai-studio/gemini-…).
      return familyAcceptsImages(id)
    case 'openrouter':
      // vendor-prefixed catalog ids; same families.
      return familyAcceptsImages(id)
  }
}

export type ImageSkipReason = 'image-too-large' | 'turn-budget'

/**
 * Apply the per-image and per-turn size caps to the images of one turn, in order. Pure so the
 * DO's delivery decision is unit-testable: `deliver` is what gets inlined for the model,
 * `skipped` is what stays a workspace file (with the reason for the visible note).
 */
export function planImageBudget<T extends { size: number }>(
  images: T[],
): { deliver: T[]; skipped: { att: T; reason: ImageSkipReason }[] } {
  const deliver: T[] = []
  const skipped: { att: T; reason: ImageSkipReason }[] = []
  let total = 0
  for (const att of images) {
    if (att.size > MAX_IMAGE_BYTES) {
      skipped.push({ att, reason: 'image-too-large' })
      continue
    }
    if (total + att.size > MAX_TURN_IMAGE_BYTES) {
      skipped.push({ att, reason: 'turn-budget' })
      continue
    }
    total += att.size
    deliver.push(att)
  }
  return { deliver, skipped }
}

/** base64 data URL from raw bytes (chunked so large images don't blow the call stack). */
export function dataUrlFromBytes(mime: string, bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** The mime from a data URL header, with a safe top-level fallback for image payloads. */
export function mimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;,]+)[;,]/.exec(dataUrl)
  return m?.[1] ?? 'image'
}
