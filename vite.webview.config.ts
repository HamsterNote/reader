import { defineConfig } from 'vite'

export default defineConfig({
  root: 'webview',
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
