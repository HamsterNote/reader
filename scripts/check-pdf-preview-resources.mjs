import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const repo = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(repo, '../ham160-review-browser')
await mkdir(output, { recursive: true })
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (let number = 1; number <= 36; number++) {
  pdf.addPage([600, 800]).drawText(`Page ${number}`, { font, x: 50, y: 750 })
}
const bytes = Buffer.from(await pdf.save())
await writeFile(resolve(output, 'resources.pdf'), bytes)
const server = await createServer({
  root: repo,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'pdf-preview-resources',
      configureServer(server) {
        server.middlewares.use('/resources.pdf', (_request, response) => {
          response.setHeader('Content-Type', 'application/pdf')
          response.end(bytes)
        })
        server.middlewares.use(
          '/preview-resources',
          async (_request, response) => {
            response.setHeader('Content-Type', 'text/html')
            response.end(
              await server.transformIndexHtml(
                '/preview-resources',
                '<html><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/pdf-preview-resources-harness.jsx"></script></body></html>'
              )
            )
          }
        )
      }
    }
  ]
})
let browser
const report = { errors: [] }
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/preview-resources`
  )
  await page
    .locator('.pdfViewer [data-selection-start-offset]')
    .first()
    .waitFor()
  report.baseline = await page.evaluate(() => window.pdfResourceTest.baseline())
  for (let number = 1; number <= 36; number++) {
    await page.evaluate((number) => window.pdfResourceTest.show(number), number)
    await page.waitForFunction(
      (number) => window.pdfResourceTest.images.includes(number),
      number
    )
  }
  report.afterEviction = await page.evaluate(() =>
    window.pdfResourceTest.snapshot()
  )
  report.previewImages = await page.evaluate(
    () => window.pdfResourceTest.images
  )
  report.releases = await page.evaluate(() => window.pdfResourceTest.events)
  assert.equal(report.baseline.retained, 36)
  assert.equal(report.previewImages.length, 24)
  assert(!report.previewImages.includes(1), 'old PNG must be evicted')
  assert(
    report.afterEviction.retained <= 10,
    'only body-buffered page resources may remain'
  )
  assert(
    report.afterEviction.operators < report.baseline.operators,
    'operator caches must decrease'
  )
  const bodyRelease = report.releases.find((event) => event.pageNumber === 1)
  assert(bodyRelease.before.operators > 0)
  assert.equal(
    bodyRelease.after.operators,
    bodyRelease.before.operators,
    'body page must be protected by the official buffer'
  )
  assert.equal(
    report.afterEviction.pages[0].operators,
    bodyRelease.after.operators
  )
  const released = report.releases.filter(
    (event) => event.before.retained && !event.after.retained
  )
  assert(
    released.length >= 26,
    'preview-only PDFPageProxy caches must actually be released'
  )
  await page.evaluate(() => window.pdfResourceTest.close())
  await page.waitForFunction(() => window.pdfResourceTest.images.length === 0)
  report.afterClose = await page.evaluate(() =>
    window.pdfResourceTest.snapshot()
  )
  assert.equal(
    report.afterClose.pages[0].operators,
    bodyRelease.after.operators
  )
  assert.deepEqual(report.errors, [])
  await page.screenshot({ path: resolve(output, 'body-after-eviction.png') })
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
console.log(
  JSON.stringify({
    baseline: {
      retained: report.baseline.retained,
      operators: report.baseline.operators
    },
    afterEviction: {
      retained: report.afterEviction.retained,
      operators: report.afterEviction.operators
    },
    previewImages: report.previewImages.length,
    errors: report.errors
  })
)
