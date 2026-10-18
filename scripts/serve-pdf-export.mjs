import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const root = resolve('apps/demo/dist')
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname
    )
    const path = resolve(
      root,
      `.${pathname === '/' ? '/index.html' : pathname}`
    )
    if (!path.startsWith(root + sep)) throw new Error('Outside export')
    const bytes = await readFile(path)
    response.setHeader(
      'Content-Type',
      types[extname(path)] ?? 'application/octet-stream'
    )
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.end(bytes)
  } catch {
    response.writeHead(404).end()
  }
}).listen(8182, '127.0.0.1')
