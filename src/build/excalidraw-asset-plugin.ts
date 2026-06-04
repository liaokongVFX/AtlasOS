import { createReadStream, cpSync, existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Plugin as EsbuildPlugin } from 'esbuild'
import type { Plugin } from 'vite'

export const EXCALIDRAW_ASSET_ROUTE = '/excalidraw-assets/'

const EXCALIDRAW_CHUNK_FILTER =
  /[\\/]node_modules[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/](dev|prod)[\\/]chunk-[^\\/]+\.js$/

function isWithinDirectory(root: string, target: string): boolean {
  const result = relative(root, target)
  return result === '' || (!result.startsWith('..') && !isAbsolute(result))
}

function isExcalidrawChunk(id: string): boolean {
  const normalizedId = id.split('?')[0].replace(/\0/g, '')
  return EXCALIDRAW_CHUNK_FILTER.test(normalizedId)
}

export function removeExcalidrawFontFallback(code: string): string {
  return code
    .replace(/\n\s*urls\.push\(new URL\(assetUrl,\s*_ExcalidrawFontFace\.ASSETS_FALLBACK_URL\)\);/g, '')
    .replace(
      /return\s+([A-Za-z_$][\w$]*)\.push\(new URL\(([A-Za-z_$][\w$]*),\s*([A-Za-z_$][\w$]*)\.ASSETS_FALLBACK_URL\)\),\1/g,
      'return $1'
    )
    .replace(
      /__publicField\(_ExcalidrawFontFace,\s*"ASSETS_FALLBACK_URL",\s*`https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/`\);/g,
      '__publicField(_ExcalidrawFontFace, "ASSETS_FALLBACK_URL", "");'
    )
    .replace(
      /P\(([A-Za-z_$][\w$]*),\s*"ASSETS_FALLBACK_URL",\s*`https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/`\);/g,
      'P($1,"ASSETS_FALLBACK_URL","");'
    )
}

export function hasExcalidrawRemoteFontFallback(code: string): boolean {
  return /new URL\([^)]*\.ASSETS_FALLBACK_URL\)/.test(code) || /https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\//.test(code)
}

function transformExcalidrawChunk(code: string, id: string): string {
  const transformed = removeExcalidrawFontFallback(code)

  if (hasExcalidrawRemoteFontFallback(transformed)) {
    throw new Error(`Failed to remove Excalidraw remote font fallback from ${id}`)
  }

  return transformed
}

function createExcalidrawOptimizeDepsPlugin(): EsbuildPlugin {
  return {
    name: 'atlas-excalidraw-font-fallback',
    setup(build) {
      build.onLoad({ filter: EXCALIDRAW_CHUNK_FILTER }, (args) => ({
        contents: transformExcalidrawChunk(readFileSync(args.path, 'utf8'), args.path),
        loader: 'js'
      }))
    }
  }
}

export function createExcalidrawAssetPlugin(projectRoot: string): Plugin {
  const excalidrawDistPath = resolve(projectRoot, 'node_modules/@excalidraw/excalidraw/dist/prod')
  let rendererOutDir = resolve(projectRoot, 'out/renderer')

  return {
    name: 'atlas-excalidraw-assets',
    enforce: 'pre',
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [createExcalidrawOptimizeDepsPlugin()]
          }
        }
      }
    },
    configResolved(config) {
      rendererOutDir = resolve(config.root, config.build.outDir)
    },
    transform(code, id) {
      if (!isExcalidrawChunk(id)) {
        return null
      }

      return {
        code: transformExcalidrawChunk(code, id),
        map: null
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = request.url?.split('?')[0] ?? ''
        if (!requestPath.startsWith(EXCALIDRAW_ASSET_ROUTE)) {
          next()
          return
        }

        let assetPath = ''
        try {
          assetPath = decodeURIComponent(requestPath.slice(EXCALIDRAW_ASSET_ROUTE.length))
        } catch {
          response.statusCode = 404
          response.end()
          return
        }

        const filePath = resolve(excalidrawDistPath, assetPath)

        if (!isWithinDirectory(excalidrawDistPath, filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          response.statusCode = 404
          response.end()
          return
        }

        if (filePath.endsWith('.woff2')) response.setHeader('Content-Type', 'font/woff2')
        createReadStream(filePath).pipe(response)
      })
    },
    closeBundle() {
      cpSync(resolve(excalidrawDistPath, 'fonts'), resolve(rendererOutDir, 'excalidraw-assets/fonts'), {
        recursive: true
      })
    }
  }
}
