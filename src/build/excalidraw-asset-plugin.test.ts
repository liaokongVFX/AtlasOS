import { describe, expect, it } from 'vitest'
import {
  createExcalidrawAssetPlugin,
  hasExcalidrawRemoteFontFallback,
  removeExcalidrawFontFallback
} from './excalidraw-asset-plugin'

describe('removeExcalidrawFontFallback', () => {
  it('removes the readable dev fallback URL source', () => {
    const input = [
      'static createUrls(uri) {',
      '  const assetUrl = uri.replace(/^\\/+/, "");',
      '  const urls = [];',
      '  urls.push(new URL(assetUrl, normalizedBaseUrl));',
      '  urls.push(new URL(assetUrl, _ExcalidrawFontFace.ASSETS_FALLBACK_URL));',
      '  return urls;',
      '}',
      '__publicField(_ExcalidrawFontFace, "ASSETS_FALLBACK_URL", `https://esm.sh/${define_import_meta_env_default.PKG_NAME ? `${define_import_meta_env_default.PKG_NAME}@${define_import_meta_env_default.PKG_VERSION}` : "@excalidraw/excalidraw"}/dist/prod/`);'
    ].join('\n')

    const output = removeExcalidrawFontFallback(input)

    expect(hasExcalidrawRemoteFontFallback(input)).toBe(true)
    expect(hasExcalidrawRemoteFontFallback(output)).toBe(false)
    expect(output).toContain('return urls;')
    expect(output).not.toContain('https://esm.sh')
  })

  it('removes the minified prod fallback URL source', () => {
    const input = [
      'static createUrls(t){let n=t.replace(/^\\/+/, ""),r=[];',
      'return r.push(new URL(n,jn.ASSETS_FALLBACK_URL)),r}',
      'static getFormat(t){return ""}',
      'P(jn,"ASSETS_FALLBACK_URL",`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:"@excalidraw/excalidraw"}/dist/prod/`);'
    ].join('')

    const output = removeExcalidrawFontFallback(input)

    expect(hasExcalidrawRemoteFontFallback(input)).toBe(true)
    expect(hasExcalidrawRemoteFontFallback(output)).toBe(false)
    expect(output).toContain('return r}static getFormat')
    expect(output).toContain('P(jn,"ASSETS_FALLBACK_URL","");')
  })

  it('does not alter chunks without Excalidraw remote font fallback code', () => {
    const input = 'const urls = [new URL(assetUrl, normalizedBaseUrl)];'

    expect(removeExcalidrawFontFallback(input)).toBe(input)
  })

  it('wires the fallback transform into Vite dependency prebundling', () => {
    const plugin = createExcalidrawAssetPlugin('D:/projects/AtlasOS')
    const config = (plugin.config as () => {
      optimizeDeps?: { esbuildOptions?: { plugins?: { name: string }[] } }
    })()

    expect(config.optimizeDeps?.esbuildOptions?.plugins?.map((esbuildPlugin) => esbuildPlugin.name)).toContain(
      'atlas-excalidraw-font-fallback'
    )
  })
})
