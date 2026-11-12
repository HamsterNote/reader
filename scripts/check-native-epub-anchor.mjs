import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const sidecar = JSON.parse(
  await readFile(
    resolve(root, 'test/compat/fixtures/epub/native-inline-sidecar.json'),
    'utf8'
  )
)
const native = sidecar.reading_position.data.textReadingProgress.anchor
const server = await createServer({
  configFile: false,
  root,
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [
    {
      name: 'anchor-harness',
      configureServer(server) {
        server.middlewares.use('/anchor-test', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(
            '<!doctype html><style>body{margin:0}#reader{width:100vw;height:100vh;overflow:hidden}</style><div id="reader"></div>'
          )
        })
      }
    }
  ]
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 480, height: 600 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [name, anchor] of [
    ['native beta.3', native],
    [
      'reader 3.0.0',
      { pageNumber: 2, textId: 'page-2-text', text: 'C', offset: 16459 }
    ]
  ]) {
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/anchor-test`
    )
    const restored = await page.evaluate(async (anchor) => {
      const { createEpubEngine } =
        await import('/src/epub/foliateEpubEngine.ts')
      const source = new Uint8Array(
        await (
          await fetch('/test/compat/fixtures/epub/native-inline.epub')
        ).arrayBuffer()
      )
      const engine = createEpubEngine({
        container: document.getElementById('reader'),
        source
      })
      window.engine = engine
      await engine.ready
      await engine.goToPosition(anchor)
      return engine.captureReadingPosition()
    }, anchor)
    assert.equal(restored.status, 'ready')
    assert.equal(restored.position.offset, 16459)
    const frame = page.frames().find((frame) => frame.url().startsWith('blob:'))
    assert.ok(frame, 'live Foliate frame')
    const target = frame.locator('#p20')
    const rect = await target.boundingBox()
    assert.ok(rect)
    const visible =
      Math.max(0, Math.min(480, rect.x + rect.width) - Math.max(0, rect.x)) *
      Math.max(0, Math.min(600, rect.y + rect.height) - Math.max(0, rect.y))
    const ratio = visible / (rect.width * rect.height)
    assert.ok(
      ratio > 0,
      `target paragraph must intersect viewport: ${JSON.stringify(rect)}`
    )
    console.log(
      JSON.stringify({
        name,
        incomingOffset: anchor.offset,
        restoredOffset: restored.position.offset,
        target: '#p20',
        ratio,
        rect
      })
    )
    if (name === 'reader 3.0.0') {
      for (const viewport of [
        { width: 320, height: 600 },
        { width: 640, height: 28 },
        { width: 480, height: 600 }
      ]) {
        await page.setViewportSize(viewport)
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
        )
        await page.waitForFunction(
          () => window.engine.captureReadingPosition().status === 'ready'
        )
        const position = await page.evaluate(() =>
          window.engine.captureReadingPosition()
        )
        assert.equal(position.position.offset, 16459)
        const visible = await target.evaluate(
          (element) =>
            new Promise((resolve) => {
              const observer = new IntersectionObserver(([entry]) => {
                observer.disconnect()
                resolve(entry.intersectionRatio)
              })
              observer.observe(element)
            })
        )
        assert.ok(
          visible > 0,
          `reflow target must remain visible: ${JSON.stringify({ viewport, visible })}`
        )
        console.log(
          JSON.stringify({
            viewport,
            offset: position.position.offset,
            ratio: visible
          })
        )
      }
    }
    await page.evaluate(() => window.engine.destroy())
  }
  assert.deepEqual(errors, [])
  console.log(
    '2 passed / 0 failed; native sidecar + reader 3.0.0 real Chromium restoration'
  )
} finally {
  await browser?.close()
  await server.close()
}
