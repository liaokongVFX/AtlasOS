import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertInsideRoot, childPath, sanitizeFileName } from './path-safety'

const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace'

describe('path safety helpers', () => {
  it('allows paths inside the selected root', () => {
    const target = join(root, 'src', 'index.ts')
    expect(assertInsideRoot(root, target)).toBe(target)
  })

  it('rejects paths outside the selected root', () => {
    const target = process.platform === 'win32' ? 'C:\\other\\secret.txt' : '/other/secret.txt'
    expect(() => assertInsideRoot(root, target)).toThrow(/outside/)
  })

  it('sanitizes file names and blocks traversal', () => {
    expect(sanitizeFileName('note.md')).toBe('note.md')
    expect(() => sanitizeFileName('../secret.md')).not.toThrow()
    expect(() => childPath(root, root, '..')).toThrow(/Invalid/)
  })
})
