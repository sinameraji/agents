import { describe, expect, it } from 'vitest'
import { monthKeyOf, rollSpendCheckpoint } from '../src/server/spend'

describe('monthKeyOf', () => {
  it('formats the UTC year-month with zero padding', () => {
    expect(monthKeyOf(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01')
    expect(monthKeyOf(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('2026-12')
  })

  it('keys off UTC, not local time', () => {
    // 2026-09-01T00:30Z is still August in UTC-negative zones; the key must be September.
    expect(monthKeyOf(new Date(Date.UTC(2026, 8, 1, 0, 30)))).toBe('2026-09')
  })
})

describe('rollSpendCheckpoint', () => {
  it('anchors the baseline at the current total on first use (prior spend is not counted)', () => {
    const r = rollSpendCheckpoint(null, 42.5, '2026-08')
    expect(r.checkpoint).toEqual({ monthKey: '2026-08', baseline: 42.5 })
    expect(r.spentUsd).toBe(0)
  })

  it('counts spend above the baseline within the same month', () => {
    const first = rollSpendCheckpoint(null, 10, '2026-08')
    const later = rollSpendCheckpoint(first.checkpoint, 13.25, '2026-08')
    expect(later.spentUsd).toBeCloseTo(3.25)
    expect(later.checkpoint).toEqual(first.checkpoint) // unchanged, nothing to persist
  })

  it('resets spend to zero on month rollover', () => {
    const aug = rollSpendCheckpoint(null, 10, '2026-08')
    const grown = rollSpendCheckpoint(aug.checkpoint, 18, '2026-08')
    expect(grown.spentUsd).toBe(8)
    const sep = rollSpendCheckpoint(grown.checkpoint, 18, '2026-09')
    expect(sep.checkpoint).toEqual({ monthKey: '2026-09', baseline: 18 })
    expect(sep.spentUsd).toBe(0)
  })

  it('re-anchors downward when a session deletion shrinks the lifetime total', () => {
    const cp = { monthKey: '2026-08', baseline: 10 }
    // A session worth $4 lifetime was deleted: total 16 -> 12.
    const afterDelete = rollSpendCheckpoint(cp, 12, '2026-08')
    // The total is still above the baseline, so the month's remaining spend stays visible...
    expect(afterDelete.spentUsd).toBe(2)
    expect(afterDelete.checkpoint).toEqual(cp)
    // ...and when the total drops BELOW the baseline, the baseline follows it down so new
    // spend counts immediately instead of refilling the deleted headroom.
    const belowBaseline = rollSpendCheckpoint(cp, 6, '2026-08')
    expect(belowBaseline.checkpoint).toEqual({ monthKey: '2026-08', baseline: 6 })
    expect(belowBaseline.spentUsd).toBe(0)
    const newSpend = rollSpendCheckpoint(belowBaseline.checkpoint, 9, '2026-08')
    expect(newSpend.spentUsd).toBe(3)
  })

  it('never reports negative spend', () => {
    const r = rollSpendCheckpoint({ monthKey: '2026-08', baseline: 10 }, 4, '2026-08')
    expect(r.spentUsd).toBeGreaterThanOrEqual(0)
  })
})
