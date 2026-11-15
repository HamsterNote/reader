import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { parsePdfMetadataExperimentConfig } from './webview/src/pdfMetadataExperimentConfig'

export default defineConfig(({ mode }) => {
  const experiment = parsePdfMetadataExperimentConfig(
    loadEnv(
      mode,
      fileURLToPath(new URL('./webview', import.meta.url)),
      'VITE_READER_PDF_METADATA_'
    )
  )
  return {
    define: {
      __READER_PDF_METADATA_EXPERIMENT_ENABLED__: JSON.stringify(
        experiment.enabled
      ),
      __READER_PDF_METADATA_EXPERIMENT__: JSON.stringify(experiment)
    },
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
  }
})
