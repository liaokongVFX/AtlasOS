import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const rendererTestSetup = resolve(__dirname, 'src/renderer/src/test/setup.ts')

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: existsSync(rendererTestSetup) ? [rendererTestSetup] : []
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
