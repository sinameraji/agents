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

  it('modes reflect real behavior: all three where Plan/Build/Auto differ, build-only for pi', () => {
    // opencode: plan agent + permission presets; kimiflare: per-prompt plan/edit/auto;
    // aisdk + cfagent: plan blocks writes, build asks before mutations, auto never asks.
    for (const id of ['opencode', 'kimiflare', 'aisdk', 'cfagent'] as const) {
      expect(HARNESS_CAPS[id].modes, `harness "${id}"`).toEqual(['plan', 'build', 'auto'])
    }
    // pi ignores modes entirely (--no-approve; the sandbox is the boundary).
    expect(HARNESS_CAPS.pi.modes).toEqual(['build'])
  })

  it('harnesses that ask before mutations advertise permissions', () => {
    for (const id of ['opencode', 'kimiflare', 'aisdk', 'cfagent'] as const) {
      expect(HARNESS_CAPS[id].permissions, `harness "${id}"`).toBe(true)
    }
    expect(HARNESS_CAPS.pi.permissions).toBe(false)
  })

  it('image prompt capability matches what each pipe can actually deliver', () => {
    // opencode (FilePartInput), aisdk (bridge /prompt images), cfagent (DO-built message) can
    // put images in front of the model; pi and kimiflare pipes are text-only.
    for (const id of ['opencode', 'aisdk', 'cfagent'] as const) {
      expect(HARNESS_CAPS[id].promptCapabilities.image, `harness "${id}"`).toBe(true)
    }
    for (const id of ['pi', 'kimiflare'] as const) {
      expect(HARNESS_CAPS[id].promptCapabilities.image, `harness "${id}"`).toBe(false)
    }
    // generic file attachments stay harness-agnostic (R2 → /workspace/uploads).
    for (const h of HARNESSES) expect(HARNESS_CAPS[h.id].promptCapabilities.fileAttach).toBe(true)
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
