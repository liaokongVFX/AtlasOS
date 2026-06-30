import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { createExcalidrawAssetPlugin } from './src/build/excalidraw-asset-plugin'

const DEFAULT_RENDERER_DEV_PORT = 14200
const requestedRendererDevPort = Number.parseInt(process.env.ATLAS_RENDERER_PORT ?? '', 10)
const rendererDevPort =
  Number.isInteger(requestedRendererDevPort) &&
  requestedRendererDevPort > 0 &&
  requestedRendererDevPort <= 65535
    ? requestedRendererDevPort
    : DEFAULT_RENDERER_DEV_PORT

function sandboxedPreloadSingleFileGuard(): Plugin {
  return {
    name: 'atlas-sandboxed-preload-single-file-guard',
    apply: 'build',
    generateBundle(_, bundle) {
      const chunkFiles = Object.values(bundle)
        .filter((asset) => asset.type === 'chunk' && !asset.isEntry)
        .map((asset) => asset.fileName)

      if (chunkFiles.length === 0) return

      this.error(
        `Sandboxed Electron preload entries must be self-contained. Remove shared preload chunks: ${chunkFiles.join(', ')}`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), sandboxedPreloadSingleFileGuard()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'browser-webview-policy': resolve(__dirname, 'src/preload/browser-webview-policy.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    server: {
      host: '127.0.0.1',
      port: rendererDevPort,
      strictPort: false
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss(), createExcalidrawAssetPlugin(__dirname)]
  }
})
