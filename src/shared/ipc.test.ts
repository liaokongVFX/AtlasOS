import { describe, expect, it } from 'vitest'
import { listTreeInputSchema } from './ipc'

describe('listTreeInputSchema', () => {
  it('defaults to one-level directory reads for lazy expansion', () => {
    const input = listTreeInputSchema.parse({ rootPath: '/repo', targetPath: '/repo/src' })

    expect(input).toEqual({ rootPath: '/repo', targetPath: '/repo/src', maxDepth: 1 })
  })

  it('allows bounded explicit recursion for compatibility', () => {
    expect(listTreeInputSchema.parse({ rootPath: '/repo', maxDepth: 64 }).maxDepth).toBe(64)
    expect(() => listTreeInputSchema.parse({ rootPath: '/repo', maxDepth: 65 })).toThrow()
  })
})
