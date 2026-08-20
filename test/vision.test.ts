import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_TURN_IMAGE_BYTES,
  dataUrlFromBytes,
  imageMimeOf,
  mimeFromDataUrl,
  modelAcceptsImages,
  planImageBudget,
} from '../src/shared/vision'

describe('modelAcceptsImages heuristic', () => {
  it('anthropic direct: claude 3+ families see images, ancient claude does not', () => {
    expect(modelAcceptsImages('anthropic', 'claude-sonnet-4-5')).toBe(true)
    expect(modelAcceptsImages('anthropic', 'claude-opus-4-1')).toBe(true)
    expect(modelAcceptsImages('anthropic', 'claude-3-5-haiku-20241022')).toBe(true)
    expect(modelAcceptsImages('anthropic', 'claude-2.1')).toBe(false)
    expect(modelAcceptsImages('anthropic', 'claude-instant-1.2')).toBe(false)
  })

  it('openai direct: gpt-4o/4.1/5 and the vision o-series, not the text-only minis', () => {
    expect(modelAcceptsImages('openai', 'gpt-4o')).toBe(true)
    expect(modelAcceptsImages('openai', 'gpt-4.1-mini')).toBe(true)
    expect(modelAcceptsImages('openai', 'gpt-5-codex')).toBe(true)
    expect(modelAcceptsImages('openai', 'gpt-4-turbo')).toBe(true)
    expect(modelAcceptsImages('openai', 'o3')).toBe(true)
    expect(modelAcceptsImages('openai', 'o1-pro')).toBe(true)
    expect(modelAcceptsImages('openai', 'o4-mini')).toBe(true)
    expect(modelAcceptsImages('openai', 'o3-mini')).toBe(false)
    expect(modelAcceptsImages('openai', 'o1-mini')).toBe(false)
    expect(modelAcceptsImages('openai', 'gpt-3.5-turbo')).toBe(false)
  })

  it('cloudflare unified billing: vendor prefixes follow the same families, gemini included', () => {
    expect(modelAcceptsImages('cloudflare', 'anthropic/claude-sonnet-4.5')).toBe(true)
    expect(modelAcceptsImages('cloudflare', 'openai/gpt-5.1')).toBe(true)
    expect(modelAcceptsImages('cloudflare', 'google-ai-studio/gemini-2.5-pro')).toBe(true)
    expect(modelAcceptsImages('cloudflare', 'openai/o3-mini')).toBe(false)
  })

  it('cloudflare workers-ai: text-only except the known vision models', () => {
    expect(modelAcceptsImages('cloudflare', 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast')).toBe(false)
    expect(modelAcceptsImages('cloudflare', 'workers-ai/@cf/openai/gpt-oss-120b')).toBe(false)
    expect(modelAcceptsImages('cloudflare', 'workers-ai/@cf/meta/llama-3.2-11b-vision-instruct')).toBe(true)
    expect(modelAcceptsImages('cloudflare', 'workers-ai/@cf/llava-hf/llava-1.5-7b-hf')).toBe(true)
    expect(modelAcceptsImages('cloudflare', 'workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct')).toBe(true)
    expect(modelAcceptsImages('cloudflare', 'workers-ai/@cf/google/gemma-3-12b-it')).toBe(true)
  })

  it('openrouter: family heuristic over vendor-prefixed ids, VL/vision markers included', () => {
    expect(modelAcceptsImages('openrouter', 'anthropic/claude-sonnet-4.5')).toBe(true)
    expect(modelAcceptsImages('openrouter', 'openai/gpt-4o-mini')).toBe(true)
    expect(modelAcceptsImages('openrouter', 'google/gemini-2.5-flash')).toBe(true)
    expect(modelAcceptsImages('openrouter', 'qwen/qwen2.5-vl-72b-instruct')).toBe(true)
    expect(modelAcceptsImages('openrouter', 'mistralai/pixtral-large-2411')).toBe(true)
    expect(modelAcceptsImages('openrouter', 'meta-llama/llama-4-maverick')).toBe(true)
    expect(modelAcceptsImages('openrouter', 'qwen/qwen3-coder')).toBe(false)
    expect(modelAcceptsImages('openrouter', 'deepseek/deepseek-chat-v3')).toBe(false)
  })

  it('live catalog metadata beats the heuristic in both directions', () => {
    // heuristic says no, catalog says the model takes images
    expect(modelAcceptsImages('openrouter', 'x-ai/some-new-model', true)).toBe(true)
    // heuristic says yes, catalog says this variant is text-only
    expect(modelAcceptsImages('openrouter', 'openai/gpt-4o-text-only', false)).toBe(false)
  })
})

describe('imageMimeOf', () => {
  it('accepts the recorded image mimes and rejects non-images', () => {
    expect(imageMimeOf({ name: 'a', mime: 'image/png' })).toBe('image/png')
    expect(imageMimeOf({ name: 'a', mime: 'image/JPEG' })).toBe('image/jpeg')
    expect(imageMimeOf({ name: 'a.png', mime: 'application/pdf' })).toBe(null)
    expect(imageMimeOf({ name: 'a', mime: 'image/tiff' })).toBe(null)
  })

  it('falls back to the extension only when no mime was recorded', () => {
    expect(imageMimeOf({ name: 'shot.PNG' })).toBe('image/png')
    expect(imageMimeOf({ name: 'photo.jpeg' })).toBe('image/jpeg')
    expect(imageMimeOf({ name: 'notes.txt' })).toBe(null)
  })
})

describe('planImageBudget', () => {
  const MB = 1024 * 1024
  it('delivers everything under both caps', () => {
    const { deliver, skipped } = planImageBudget([{ size: MB }, { size: 2 * MB }])
    expect(deliver).toHaveLength(2)
    expect(skipped).toHaveLength(0)
  })

  it('skips a single image over the per-image cap', () => {
    const big = { size: MAX_IMAGE_BYTES + 1 }
    const ok = { size: MB }
    const { deliver, skipped } = planImageBudget([big, ok])
    expect(deliver).toEqual([ok])
    expect(skipped).toEqual([{ att: big, reason: 'image-too-large' }])
  })

  it('enforces the per-turn budget in order, without dropping later small images unfairly', () => {
    const a = { size: 4 * MB }
    const b = { size: 4 * MB }
    const c = { size: 1 * MB }
    const { deliver, skipped } = planImageBudget([a, b, c])
    // a + b hit exactly 8MB (the budget), c would exceed it
    expect(deliver).toEqual([a, b])
    expect(skipped).toEqual([{ att: c, reason: 'turn-budget' }])
    expect(MAX_TURN_IMAGE_BYTES).toBe(8 * MB)
  })

  it('an over-cap image does not consume turn budget', () => {
    const big = { size: MAX_IMAGE_BYTES + 1 }
    const rest = [{ size: 4 * MB }, { size: 4 * MB }]
    const { deliver } = planImageBudget([big, ...rest])
    expect(deliver).toEqual(rest)
  })
})

describe('data URL helpers', () => {
  it('round-trips bytes through a data URL', () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255])
    const url = dataUrlFromBytes('image/png', bytes)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const decoded = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0))
    expect([...decoded]).toEqual([...bytes])
    expect(mimeFromDataUrl(url)).toBe('image/png')
  })

  it('mimeFromDataUrl falls back to the image top-level type', () => {
    expect(mimeFromDataUrl('data:;base64,AAAA')).toBe('image')
    expect(mimeFromDataUrl('nonsense')).toBe('image')
  })
})
