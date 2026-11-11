import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Serve the real WebBase host with this checkout's built reader. Do not modify
// its lockfile or hardlinked pnpm store artifacts to test a local correction.
const readerRoot = resolve(import.meta.dirname, '..')
const webBaseRoot = resolve(process.env.WEBBASE_DIR ?? '../WebBase')
const root = resolve(webBaseRoot, 'webview')
// Use the host's Vite version together with its own React plugin.
const { createServer, loadConfigFromFile } = await import(
  pathToFileURL(resolve(root, 'node_modules/vite/dist/node/index.js')).href
)
const { config } = await loadConfigFromFile(
  { command: 'serve', mode: 'development' },
  resolve(root, 'vite.config.ts')
)
config.resolve.alias.unshift(
  {
    find: /^@hamster-note\/reader$/,
    replacement: resolve(readerRoot, 'dist/index.js')
  },
  {
    find: '@hamster-note/reader/style.css',
    replacement: resolve(readerRoot, 'dist/style.css')
  }
)
const port = Number(process.env.WEBBASE_PORT ?? 6229)
const server = await createServer({
  ...config,
  configFile: false,
  root,
  cacheDir: resolve(readerRoot, 'node_modules/.vite-webbase-ham226'),
  server: {
    ...config.server,
    host: '0.0.0.0',
    port,
    strictPort: true,
    fs: { allow: [webBaseRoot, readerRoot] }
  }
})
await server.listen()
console.log(`WebBase with built reader: http://0.0.0.0:${port}/?demo=1`)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close()
    process.exit(0)
  })
}
