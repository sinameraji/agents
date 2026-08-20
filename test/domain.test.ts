import { describe, expect, it } from 'vitest'
import { deriveZone, describeCfError, isCfAuthError, normalizeHostname, zoneStatusLabel } from '~shared/domain'

describe('normalizeHostname', () => {
  it('lower-cases and strips scheme, path, port, trailing dot', () => {
    expect(normalizeHostname('HTTPS://Agents.Example.COM/some/path?q=1')).toBe('agents.example.com')
    expect(normalizeHostname('agents.example.com:8443')).toBe('agents.example.com')
    expect(normalizeHostname('agents.example.com.')).toBe('agents.example.com')
    expect(normalizeHostname('  example.com  ')).toBe('example.com')
  })

  it('rejects non-hostnames', () => {
    expect(normalizeHostname('localhost')).toBeNull() // single label
    expect(normalizeHostname('')).toBeNull()
    expect(normalizeHostname('foo_bar.example.com')).toBeNull() // underscore
    expect(normalizeHostname('-bad.example.com')).toBeNull() // leading hyphen
    expect(normalizeHostname('bad-.example.com')).toBeNull() // trailing hyphen
    expect(normalizeHostname('192.168.1.1')).toBeNull() // IPv4 literal
  })
})

describe('deriveZone', () => {
  it('takes the last two labels for ordinary TLDs', () => {
    expect(deriveZone('agents.example.com')).toEqual({ ok: true, hostname: 'agents.example.com', zone: 'example.com' })
    expect(deriveZone('example.com')).toEqual({ ok: true, hostname: 'example.com', zone: 'example.com' })
    expect(deriveZone('deep.sub.agents.example.dev')).toEqual({
      ok: true,
      hostname: 'deep.sub.agents.example.dev',
      zone: 'example.dev',
    })
  })

  it('recognizes common two-part public suffixes (co.uk style)', () => {
    expect(deriveZone('agents.mycompany.co.uk')).toEqual({
      ok: true,
      hostname: 'agents.mycompany.co.uk',
      zone: 'mycompany.co.uk',
    })
    expect(deriveZone('mycompany.com.au')).toEqual({ ok: true, hostname: 'mycompany.com.au', zone: 'mycompany.com.au' })
  })

  it('refuses a bare public suffix', () => {
    const r = deriveZone('co.uk')
    expect(r.ok).toBe(false)
  })

  it('honors an explicit zone override when it is a parent of the hostname', () => {
    expect(deriveZone('agents.division.mycompany.example', 'mycompany.example')).toEqual({
      ok: true,
      hostname: 'agents.division.mycompany.example',
      zone: 'mycompany.example',
    })
    // Override equals the hostname itself.
    expect(deriveZone('mycompany.example', 'mycompany.example')).toEqual({
      ok: true,
      hostname: 'mycompany.example',
      zone: 'mycompany.example',
    })
  })

  it('rejects an override that is not a parent of the hostname', () => {
    const r = deriveZone('agents.mycompany.example', 'othercompany.example')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not the same domain/i)
  })

  it('rejects an override that is not aligned on a label boundary', () => {
    // "company.example" is a string suffix of "mycompany.example" but not a DNS parent.
    const r = deriveZone('agents.mycompany.example', 'company.example')
    expect(r.ok).toBe(false)
  })

  it('rejects an override that is itself a public suffix', () => {
    const r = deriveZone('agents.mycompany.co.uk', 'co.uk')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/public suffix/i)
  })

  it('rejects an invalid hostname up front', () => {
    const r = deriveZone('not a domain')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/agents\.yourcompany\.com/)
  })
})

describe('isCfAuthError', () => {
  it('flags HTTP 401/403 and known auth codes', () => {
    expect(isCfAuthError({ httpStatus: 403 })).toBe(true)
    expect(isCfAuthError({ httpStatus: 401 })).toBe(true)
    expect(isCfAuthError({ errors: [{ code: 9109, message: 'Invalid access token' }] })).toBe(true)
    expect(isCfAuthError({ errors: [{ code: 10000, message: 'Authentication error' }] })).toBe(true)
  })

  it('flags permission-shaped messages without a known code', () => {
    expect(isCfAuthError({ errors: [{ code: 1234, message: 'you do not have permission to do that' }] })).toBe(true)
  })

  it('does not flag ordinary request errors', () => {
    expect(isCfAuthError({ httpStatus: 400, errors: [{ code: 1049, message: 'x is not a registered domain' }] })).toBe(false)
  })
})

describe('describeCfError', () => {
  it('names the missing permission for the context', () => {
    expect(describeCfError({ errors: [{ code: 9109 }] }, 'zone-create')).toContain('Zone Edit or Zone DNS Edit')
    expect(describeCfError({ httpStatus: 403 }, 'zone-read')).toContain('Zone Read')
    expect(describeCfError({ httpStatus: 403 }, 'attach')).toContain('Zone DNS Edit and Workers Routes Edit')
  })

  it('explains a zone that lives on another account (1061)', () => {
    const msg = describeCfError({ errors: [{ code: 1061, message: 'example.com already exists' }] }, 'zone-create')
    expect(msg).toMatch(/different account/i)
  })

  it('explains an unregistered domain (1049)', () => {
    const msg = describeCfError({ errors: [{ code: 1049, message: 'example.test is not a registered domain' }] }, 'zone-create')
    expect(msg).toMatch(/registered/i)
  })

  it('passes through unknown messages and has a generic fallback', () => {
    expect(describeCfError({ errors: [{ code: 4242, message: 'Something oddly specific' }] }, 'zone-create')).toBe(
      'Something oddly specific',
    )
    expect(describeCfError({ httpStatus: 500 }, 'zone-create')).toMatch(/temporary/i)
    expect(describeCfError({}, 'attach')).toMatch(/rejected/i)
  })
})

describe('zoneStatusLabel', () => {
  it('maps zone statuses to pill copy', () => {
    expect(zoneStatusLabel('pending')).toBe('Waiting for nameservers')
    expect(zoneStatusLabel('initializing')).toBe('Waiting for nameservers')
    expect(zoneStatusLabel('active')).toBe('Active')
    expect(zoneStatusLabel('moved')).toMatch(/moved/i)
  })
})
