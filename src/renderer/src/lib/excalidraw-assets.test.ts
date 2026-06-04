import { describe, expect, it } from 'vitest'
import { getExcalidrawAssetPath } from './excalidraw-assets'

describe('getExcalidrawAssetPath', () => {
  it('resolves beside the packaged renderer entry', () => {
    expect(getExcalidrawAssetPath('file:///D:/projects/AtlasOS/out/renderer/index.html')).toBe(
      'file:///D:/projects/AtlasOS/out/renderer/excalidraw-assets/'
    )
  })

  it('resolves to the renderer dev-server route', () => {
    expect(getExcalidrawAssetPath('http://127.0.0.1:14200/?view=pet')).toBe('http://127.0.0.1:14200/excalidraw-assets/')
  })
})
