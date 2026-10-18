import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    lib: {
      entry: {
        index: 'src/index.ts',
        'pdf-contracts': 'src/pdf-contracts.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: 'style'
    },
    rollupOptions: {
      external: ['react', 'react-dom', /^@hamster-note\//, /^@system-ui-js\//]
    }
  }
})
