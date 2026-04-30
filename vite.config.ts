import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const pdfParserStandardFontsPath = fileURLToPath(
  new URL(
    './node_modules/@hamster-note/pdf-parser/dist/standard_fonts/',
    import.meta.url
  )
)
const pdfParserStandardFontsRoute = '/pdfjs-standard-fonts/'

function pdfParserStandardFontsPlugin(): Plugin {
  return {
    name: 'pdf-parser-standard-fonts',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url

        if (!requestUrl?.startsWith(pdfParserStandardFontsRoute)) {
          next()
          return
        }

        const fontFileName = decodeURIComponent(
          requestUrl.slice(pdfParserStandardFontsRoute.length).split('?')[0]
        )

        if (
          fontFileName.length === 0 ||
          fontFileName.includes('/') ||
          fontFileName.includes('\\')
        ) {
          response.statusCode = 404
          response.end()
          return
        }

        response.setHeader('Content-Type', 'application/octet-stream')
        createReadStream(join(pdfParserStandardFontsPath, fontFileName))
          .on('error', () => {
            response.statusCode = 404
            response.end()
          })
          .pipe(response)
      })
    },
    generateBundle() {
      for (const fileName of readdirSync(pdfParserStandardFontsPath)) {
        const filePath = join(pdfParserStandardFontsPath, fileName)

        if (!statSync(filePath).isFile()) {
          continue
        }

        this.emitFile({
          type: 'asset',
          fileName: `pdfjs-standard-fonts/${fileName}`,
          source: readFileSync(filePath)
        })
      }
    },
    transform(code, id) {
      if (!id.includes('/@hamster-note/pdf-parser/dist/pdfParser-')) {
        return null
      }

      const updatedCode = code.replace(
        'new URL("./standard_fonts/", import.meta.url).href',
        'new URL((import.meta.env.BASE_URL || "/") + "pdfjs-standard-fonts/", window.location.origin).href'
      )

      if (updatedCode === code) {
        return null
      }

      return {
        code: updatedCode,
        map: null
      }
    }
  }
}

export default defineConfig({
  plugins: [pdfParserStandardFontsPlugin(), react()],
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
      },
      {
        find: /^@hamster-note\/image-parser$/,
        replacement: fileURLToPath(new URL('./test/mocks/image-parser.ts', import.meta.url))
      }
    ]
  },
  optimizeDeps: {
    exclude: ['@hamster-note/pdf-parser']
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
