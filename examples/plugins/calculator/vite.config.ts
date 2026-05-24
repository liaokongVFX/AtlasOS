import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/renderer.ts'),
      formats: ['es'],
      fileName: () => 'renderer.js'
    },
    outDir: 'dist',
    rollupOptions: {
      external: [],
      output: {
        exports: 'named'
      }
    }
  }
})
