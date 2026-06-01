import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const DEFAULT_RENDERER_DEV_PORT = 14200
const requestedRendererDevPort = Number.parseInt(process.env.ATLAS_RENDERER_PORT ?? '', 10)
const rendererDevPort =
  Number.isInteger(requestedRendererDevPort) &&
  requestedRendererDevPort > 0 &&
  requestedRendererDevPort <= 65535
    ? requestedRendererDevPort
    : DEFAULT_RENDERER_DEV_PORT

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
    plugins: [externalizeDepsPlugin()],
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
    plugins: [react(), tailwindcss()]
  }
})
