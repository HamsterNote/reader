import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const native = JSON.parse(
  await readFile(
    resolve(root, 'test/compat/fixtures/epub/native-inline-highlight.json'),
    'utf8'
  )
)
const server = await createServer({
  configFile: false,
  root,
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: '127.0.0.1', port: 0, watch: null },
  plugins: [
    {
      name: 'native-highlight-harness',
      configureServer(server) {
        server.middlewares.use(
          '/native-highlight-test',
          (_request, response) => {
            response.setHeader('Content-Type', 'text/html')
            response.end(
              '<!doctype html><style>body{margin:0}#reader{width:480px;height:600px;overflow:hidden}</style><div id="reader"></div>'
            )
          }
        )
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
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/native-highlight-test`
  )
  const result = await page.evaluate(async (native) => {
    const { createEpubEngine } = await import('/src/epub/foliateEpubEngine.ts')
    const source = new Uint8Array(
      await (
        await fetch('/test/compat/fixtures/epub/native-inline.epub')
      ).arrayBuffer()
    )
    const engine = createEpubEngine({
      container: document.getElementById('reader'),
      source
    })
    const original = JSON.stringify(native)
    try {
      await engine.ready
      const report = engine.showRanges([native])
      await engine.goToRange(native.id)
      const range = await engine.selectRange(native.id)
      const paragraph = range.startContainer.parentElement.closest('p')
      const ratio = await new Promise((resolve) => {
        const observer = new IntersectionObserver(([entry]) => {
          observer.disconnect()
          resolve(entry.intersectionRatio)
        })
        observer.observe(paragraph)
      })
      const local = range.cloneRange()
      local.setStart(local.startContainer, local.startOffset + 1)
      const startEdit = {
        ...native,
        ...engine.updateRangeEndpoint(native.id, local, false)
      }
      engine.showRanges([startEdit])
      local.setEnd(local.endContainer, local.endOffset - 1)
      const saved = JSON.parse(
        JSON.stringify({
          ...startEdit,
          ...engine.updateRangeEndpoint(native.id, local, true)
        })
      )
      engine.showRanges([saved])
      const restored = await engine.selectRange(native.id)
      const missing = { ...native, nativeTextSegments: undefined }
      const rejected = engine.showRanges([missing])
      const rejectedSelection = await engine.selectRange(native.id)
      const modern = {
        id: 'modern',
        text: 'After',
        start: native.start,
        end: native.end
      }
      engine.showRanges([modern])
      await engine.goToRange(modern.id)
      const modernRange = await engine.selectRange(modern.id)
      return {
        report,
        paragraph: paragraph.id,
        ratio,
        startEdit,
        saved,
        restoredParagraph:
          restored.startContainer.parentElement.closest('p').id,
        restoredText: restored.toString(),
        rejected,
        rejectedSelection: rejectedSelection === null,
        originalUnchanged: original === JSON.stringify(native),
        modernParagraph:
          modernRange.startContainer.parentElement.closest('p').id
      }
    } finally {
      await engine.destroy()
    }
  }, native)
  assert.deepEqual(result.report, {
    located: ['native-history'],
    unlocatable: []
  })
  assert.equal(result.paragraph, 'p9')
  assert.ok(result.ratio > 0)
  assert.equal(result.startEdit.start.offset, 7905)
  assert.equal(result.startEdit.end.offset, 7909)
  assert.equal(result.saved.start.offset, 7905)
  assert.equal(result.saved.end.offset, 7908)
  assert.equal(result.saved.epubRangeCoordinates, 'reader-compat-v1')
  assert.equal(result.restoredParagraph, 'p9')
  assert.equal(result.restoredText, 'fte')
  assert.equal(
    result.rejected.unlocatable[0]?.reason,
    'unverified-native-source'
  )
  assert.ok(result.rejectedSelection && result.originalUnchanged)
  assert.equal(result.modernParagraph, 'p8')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(result, null, 2))
  console.log(
    'PASS: native repeated text, both endpoint edits and JSON roundtrip, missing provenance rejection, modern coordinates unchanged'
  )
} finally {
  await browser?.close()
  await server.close()
}
