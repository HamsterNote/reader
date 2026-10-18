import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/pdf-runtime',
    emptyOutDir: true,
    lib: {
      entry: 'src/pdf/pdfDom.ts',
      formats: ['es'],
      fileName: () => 'adapter.js'
    },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
