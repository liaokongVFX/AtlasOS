import { describe, expect, it } from 'vitest'
import { createContentSecurityPolicy } from './security-policy'

describe('createContentSecurityPolicy', () => {
  it('allows only local renderer font sources', () => {
    expect(createContentSecurityPolicy(true)).toContain("font-src 'self' data: blob:;")
    expect(createContentSecurityPolicy(false)).toContain("font-src 'self' data: blob:;")
  })

  it('keeps production script sources closed to dev servers', () => {
    const policy = createContentSecurityPolicy(false)

    expect(policy).not.toContain('http://localhost:*')
    expect(policy).not.toContain('http://127.0.0.1:*')
  })
})
