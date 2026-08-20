import { describe, expect, it } from 'vitest'
import { HARNESSES } from '../src/shared/protocol'
import { HARNESS_CAPS, harnessCaps } from '../src/shared/harness-caps'

describe('harness capability manifest', () => {
  it('has an entry for every harness id in protocol.ts (no silent gaps)', () => {
    for (const h of HARNESSES) {
      expect(HARNESS_CAPS[h.id], `missing caps for harness "${h.id}"`).toBeDefined()
    }
    expect(Object.keys(HARNESS_CAPS).sort()).toEqual(HARNESSES.map((h) => h.id).sort())
  })

  it('declares at least one mode per harness', () => {
    for (const h of HARNESSES) {
      expect(HARNESS_CAPS[h.id].modes.length, `harness "${h.id}" declares no modes`).toBeGreaterThan(0)
    }
  })

  it('falls back conservatively when the harness is unknown', () => {
    const caps = harnessCaps(undefined)
    expect(caps.modes).toEqual(['build'])
    expect(caps.commands).toEqual([])
    expect(caps.subagents).toBe(false)
    expect(caps.promptCapabilities.image).toBe(false)
  })

  it('resolves known harnesses to their manifest entry', () => {
    expect(harnessCaps('opencode')).toBe(HARNESS_CAPS.opencode)
  })
})
