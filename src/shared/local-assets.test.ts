import { describe, expect, it } from 'vitest'
import {
  localAssetUrl,
  mimeTypeForLocalAsset,
  parseByteRange,
  parseLocalAssetUrl
} from './local-assets'

describe('local asset URLs', () => {
  it('round-trips Windows paths through the atlas-file URL', () => {
    const rootPath = 'C:\\Users\\xhwz2\\Downloads'
    const path = 'C:\\Users\\xhwz2\\Downloads\\mind map.png'

    const url = localAssetUrl(rootPath, path)

    expect(url).toMatch(/^atlas-file:\/\/preview\?/)
    expect(parseLocalAssetUrl(url)).toEqual({ rootPath, targetPath: path })
  })

  it('detects media MIME types from paths', () => {
    expect(mimeTypeForLocalAsset('photo.PNG')).toBe('image/png')
    expect(mimeTypeForLocalAsset('clip.mp4')).toBe('video/mp4')
    expect(mimeTypeForLocalAsset('archive.bin')).toBe('application/octet-stream')
  })
})

describe('parseByteRange', () => {
  it('returns full when no range header is present', () => {
    expect(parseByteRange(null, 100)).toEqual({ kind: 'full' })
  })

  it('parses bounded, open-ended, and suffix byte ranges', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ kind: 'partial', start: 10, end: 19 })
    expect(parseByteRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 })
    expect(parseByteRange('bytes=-25', 100)).toEqual({ kind: 'partial', start: 75, end: 99 })
  })

  it('marks unsupported ranges invalid', () => {
    expect(parseByteRange('items=0-1', 100)).toEqual({ kind: 'invalid' })
    expect(parseByteRange('bytes=100-101', 100)).toEqual({ kind: 'invalid' })
    expect(parseByteRange('bytes=20-10', 100)).toEqual({ kind: 'invalid' })
    expect(parseByteRange('bytes=0-1,4-5', 100)).toEqual({ kind: 'invalid' })
  })
})
