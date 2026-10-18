import { createReadStream, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

type Asset = { path: string; mimeType: string }
const directory = resolve('dist/pdf-runtime')
const manifest = (): Asset[] =>
  JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')).files

export function pdfRuntimePlugin(): Plugin {
  return {
    name: 'local-pdf-runtime',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        if (!path?.startsWith('/pdf-runtime/')) {
          next()
          return
        }
        const asset = manifest().find(
          (file) => `/pdf-runtime/${file.path}` === path
        )
        if (!asset) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('Content-Type', asset.mimeType)
        response.setHeader('X-Content-Type-Options', 'nosniff')
        createReadStream(resolve(directory, asset.path))
          .on('error', () => {
            response.statusCode = 404
            response.end()
          })
          .pipe(response)
      })
    },
    generateBundle() {
      for (const file of manifest())
        this.emitFile({
          type: 'asset',
          fileName: `pdf-runtime/${file.path}`,
          source: readFileSync(resolve(directory, file.path))
        })
    }
  }
}
