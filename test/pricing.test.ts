import { describe, expect, it } from 'vitest'
import { estimateCostUsd, nextTurnTokens, pricingOf } from '../src/shared/pricing'

describe('pricingOf', () => {
  it('reads the catalog per-million prices', () => {
    expect(pricingOf({ inputPerM: 3, outputPerM: 15 })).toEqual({ inputPerM: 3, outputPerM: 15 })
  })

  it('treats an unpriced catalog entry as unknown, not free', () => {
    // Workers AI models are served with 0/0 — "we have no price", never "$0 per token".
    expect(pricingOf({ inputPerM: 0, outputPerM: 0 })).toBeNull()
    expect(pricingOf(undefined)).toBeNull()
    expect(pricingOf(null)).toBeNull()
  })

  it('keeps one-sided pricing (a priced input with a free output is still knowable)', () => {
    expect(pricingOf({ inputPerM: 0.4, outputPerM: 0 })).toEqual({ inputPerM: 0.4, outputPerM: 0 })
  })
})

describe('estimateCostUsd', () => {
  it('bills per million tokens', () => {
    // 1M in at $3/M + 1M out at $15/M.
    expect(estimateCostUsd({ inputPerM: 3, outputPerM: 15 }, 1_000_000, 1_000_000)).toBeCloseTo(18)
    // A realistic turn: 12k in, 800 out on Sonnet pricing.
    expect(estimateCostUsd({ inputPerM: 3, outputPerM: 15 }, 12_000, 800)).toBeCloseTo(0.048)
  })

  it('is undefined when pricing is unknown, so callers can omit cost instead of reporting zero', () => {
    expect(estimateCostUsd(null, 12_000, 800)).toBeUndefined()
    expect(estimateCostUsd(undefined, 12_000, 800)).toBeUndefined()
  })

  it('returns a real zero for a zero-token turn with known pricing', () => {
    expect(estimateCostUsd({ inputPerM: 3, outputPerM: 15 }, 0, 0)).toBe(0)
  })

  it('clamps junk token counts instead of producing negative or NaN cost', () => {
    expect(estimateCostUsd({ inputPerM: 3, outputPerM: 15 }, -5, 1_000_000)).toBeCloseTo(15)
    expect(estimateCostUsd({ inputPerM: 3, outputPerM: 15 }, Number.NaN, 0)).toBe(0)
  })
})

describe('nextTurnTokens', () => {
  it('falls back to a small context and a short reply with no history', () => {
    expect(nextTurnTokens({})).toEqual({ input: 2000, output: 400 })
  })

  it('adds the draft at four characters per token', () => {
    expect(nextTurnTokens({ draftChars: 400 })).toEqual({ input: 2100, output: 400 })
    // Partial tokens round up: a one-character draft is still a token.
    expect(nextTurnTokens({ draftChars: 1 })).toEqual({ input: 2001, output: 400 })
  })

  it('uses the last turn input tokens as the context size', () => {
    expect(nextTurnTokens({ lastInputTokens: 48_000, draftChars: 80 })).toEqual({ input: 48_020, output: 400 })
  })

  it('averages the last three assistant outputs and ignores older ones', () => {
    expect(nextTurnTokens({ recentOutputTokens: [10_000, 100, 200, 300] }).output).toBe(200)
  })

  it('ignores zero-output turns rather than dragging the average down', () => {
    expect(nextTurnTokens({ recentOutputTokens: [600, 0, 0] }).output).toBe(600)
    expect(nextTurnTokens({ recentOutputTokens: [0, 0] }).output).toBe(400)
  })

  it('rounds the average to whole tokens', () => {
    expect(nextTurnTokens({ recentOutputTokens: [100, 101, 102] }).output).toBe(101)
    expect(nextTurnTokens({ recentOutputTokens: [100, 100, 101] }).output).toBe(100)
  })
})
