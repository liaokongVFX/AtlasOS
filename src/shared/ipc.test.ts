import { describe, expect, it } from 'vitest'
import {
  listTreeInputSchema,
  terminalPersistAssetInputSchema,
  terminalReadClipboardFilesInputSchema,
  terminalSaveClipboardImageInputSchema
} from './ipc'

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

describe('terminalPersistAssetInputSchema', () => {
  it('accepts base64 encoded image payloads', () => {
    const input = terminalPersistAssetInputSchema.parse({
      dataBase64: 'c2NyZWVuc2hvdA==',
      mimeType: 'image/png',
      sourceName: 'clipboard.png'
    })

    expect(input).toEqual({
      dataBase64: 'c2NyZWVuc2hvdA==',
      mimeType: 'image/png',
      sourceName: 'clipboard.png'
    })
  })

  it('rejects non-image or malformed clipboard payloads', () => {
    expect(() =>
      terminalPersistAssetInputSchema.parse({
        dataBase64: 'c2NyZWVuc2hvdA==',
        mimeType: 'text/plain'
      })
    ).toThrow()

    expect(() =>
      terminalPersistAssetInputSchema.parse({
        dataBase64: 'not base64',
        mimeType: 'image/png'
      })
    ).toThrow()
  })
})

describe('terminalSaveClipboardImageInputSchema', () => {
  it('accepts the empty clipboard-image save request', () => {
    expect(terminalSaveClipboardImageInputSchema.parse({})).toEqual({})
  })
})

describe('terminalReadClipboardFilesInputSchema', () => {
  it('accepts the empty clipboard-file read request', () => {
    expect(terminalReadClipboardFilesInputSchema.parse({})).toEqual({})
  })
})
