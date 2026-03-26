import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5577,
    host: '0.0.0.0'
  },
  resolve: {
    alias: [
      {
        find: /^@hamster-note\/reader\/style\.css$/,
        replacement: fileURLToPath(
          new URL('./src/styles/index.scss', import.meta.url)
        )
      },
      {
        find: /^@hamster-note\/reader$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url))
      }
    ]
  },
  build: {
    outDir: 'demo-dist'
  },
  test: {
    environment: 'jsdom',
    setupFiles: './test/setup.ts',
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['dist/**', 'demo-dist/**'],
    coverage: {
      provider: 'v8'
    }
  }
})
