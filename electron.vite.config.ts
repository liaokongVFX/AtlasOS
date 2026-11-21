import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { createExcalidrawAssetPlugin } from './src/build/excalidraw-asset-plugin'
import { resolveRendererDevPort } from './src/build/dev-server-port'

const rendererDevPort = resolveRendererDevPort(process.env.ATLAS_RENDERER_PORT)

function windowsQuickInputHelper(): Plugin {
  const sources = ['quick-input-helper.cs', 'quick-input-paste.cs'].map(name => resolve(__dirname, 'src/main/services', name))
  return {
    name: 'windows-quick-input-helper',
    buildStart() {
      if (process.platform === 'win32') sources.forEach(source => this.addWatchFile(source))
    },
    writeBundle({ dir }) {
      if (process.platform !== 'win32' || !dir) return
      const framework = resolve(process.env.SystemRoot!, 'Microsoft.NET/Framework/v4.0.30319')
      const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(name => '/r:' + resolve(framework, 'WPF', name + '.dll'))
      execFileSync(resolve(framework, 'csc.exe'), ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu',
        ...references, '/r:System.Windows.Forms.dll', '/out:' + resolve(dir, 'quick-input-helper.exe'), ...sources], { windowsHide: true, stdio: 'inherit' })
    }
  }
}

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
    plugins: [externalizeDepsPlugin(), windowsQuickInputHelper()],
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
