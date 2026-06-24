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
const onnxRuntimeWebDistPath = fileURLToPath(
  new URL('./node_modules/onnxruntime-web/dist/', import.meta.url)
)
const onnxRuntimeWebAssetsRoute = '/ort-wasm/'

const getOnnxRuntimeWebAssetContentType = (fileName: string) => {
  if (fileName.endsWith('.wasm')) {
    return 'application/wasm'
  }

  if (fileName.endsWith('.mjs')) {
    return 'text/javascript'
  }

  return 'application/octet-stream'
}

const isOnnxRuntimeWebAsset = (fileName: string) =>
  /^ort-wasm.*\.(?:mjs|wasm)$/.test(fileName)

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

function onnxRuntimeWebAssetsPlugin(): Plugin {
  return {
    name: 'onnxruntime-web-assets',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url

        if (!requestUrl?.startsWith(onnxRuntimeWebAssetsRoute)) {
          next()
          return
        }

        const assetFileName = decodeURIComponent(
          requestUrl.slice(onnxRuntimeWebAssetsRoute.length).split('?')[0]
        )

        if (
          !isOnnxRuntimeWebAsset(assetFileName) ||
          assetFileName.includes('/') ||
          assetFileName.includes('\\')
        ) {
          response.statusCode = 404
          response.end()
          return
        }

        response.setHeader(
          'Content-Type',
          getOnnxRuntimeWebAssetContentType(assetFileName)
        )
        createReadStream(join(onnxRuntimeWebDistPath, assetFileName))
          .on('error', () => {
            response.statusCode = 404
            response.end()
          })
          .pipe(response)
      })
    },
    generateBundle() {
      for (const fileName of readdirSync(onnxRuntimeWebDistPath)) {
        const filePath = join(onnxRuntimeWebDistPath, fileName)

        if (!statSync(filePath).isFile() || !isOnnxRuntimeWebAsset(fileName)) {
          continue
        }

        this.emitFile({
          type: 'asset',
          fileName: `ort-wasm/${fileName}`,
          source: readFileSync(filePath)
        })
      }
    },
    transform(code, id) {
      if (!id.includes('/@hamster-note/image-parser/dist/index.js')) {
        return null
      }

      const updatedCode = code.replace(
        'simd: false\n\t}',
        'simd: false,\n\t\twasmPaths: new URL((import.meta.env.BASE_URL || "/") + "ort-wasm/", window.location.origin).href\n\t}'
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

export default defineConfig(({ mode }) => ({
  plugins: [
    pdfParserStandardFontsPlugin(),
    onnxRuntimeWebAssetsPlugin(),
    react()
  ],
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
        find: /^clipper-lib$/,
        replacement: fileURLToPath(
          new URL('./src/vendor/clipper-lib.ts', import.meta.url)
        )
      },
      ...(mode === 'test'
        ? [
            {
              find: /^@hamster-note\/image-parser$/,
              replacement: fileURLToPath(
                new URL('./test/mocks/image-parser.ts', import.meta.url)
              )
            },
            {
              find: /^@system-ui-js\/multi-drag$/,
              replacement: fileURLToPath(
                new URL('./test/mocks/multi-drag.ts', import.meta.url)
              )
            },
            {
              find: /^@hamster-note\/virtual-paper$/,
              replacement: fileURLToPath(
                new URL('./test/mocks/virtual-paper.tsx', import.meta.url)
              )
            },
            {
              find: /^@hamster-note\/selection$/,
              replacement: fileURLToPath(
                new URL('./test/mocks/selection.tsx', import.meta.url)
              )
            }
          ]
        : [])
    ]
  },
  optimizeDeps: {
    include: [
      '@paddleocr/paddleocr-js',
      '@hamster-note/document-parser',
      '@hamster-note/types'
    ],
    exclude: ['@hamster-note/pdf-parser', '@hamster-note/image-parser']
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
}))
