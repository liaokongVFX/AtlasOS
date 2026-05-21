import { describe, expect, it } from 'vitest'
import { codeLanguageDescriptionForFile, loadCodeLanguageForFile } from './code-language'

describe('codeLanguageDescriptionForFile', () => {
  it.each([
    { path: 'src/app.tsx', mimeType: undefined, expectedName: 'TSX' },
    { path: 'scripts/build.py', mimeType: undefined, expectedName: 'Python' },
    { path: 'Dockerfile', mimeType: undefined, expectedName: 'Dockerfile' },
    { path: 'config.jsonc', mimeType: undefined, expectedName: 'JSON' },
    { path: '.env', mimeType: undefined, expectedName: 'Properties files' },
    { path: 'component.vue', mimeType: undefined, expectedName: 'Vue' },
    { path: 'inline', mimeType: 'text/css', expectedName: 'CSS' }
  ])('detects $path as $expectedName', ({ path, mimeType, expectedName }) => {
    expect(codeLanguageDescriptionForFile(path, mimeType)?.name).toBe(expectedName)
  })

  it('returns null for unrecognized plain text files', () => {
    expect(codeLanguageDescriptionForFile('notes.txt')).toBeNull()
  })

  it('loads CodeMirror language support on demand', async () => {
    const support = await loadCodeLanguageForFile('src/app.ts')

    expect(support?.language.name).toBe('typescript')
  })
})
