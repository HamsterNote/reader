import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'webview',
  plugins: [react()],
  resolve: {
    alias: {
      '@hamster-note/reader': fileURLToPath(
        new URL('./src/index.ts', import.meta.url)
      )
    }
  },
  base: './',
  build: {
    outDir: '../webview-dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/webview.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? ''
          if (name.endsWith('.css')) return 'assets/webview.css'
          return 'assets/[name][extname]'
        }
      }
    }
  }
})
