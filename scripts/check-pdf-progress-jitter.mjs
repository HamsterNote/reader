import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const output = resolve(
  process.env.PDF_PROGRESS_OUTPUT ?? 'test-results/pdf-progress'
)
await mkdir(output, { recursive: true })
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (let page = 1; page <= 5; page++) {
  const sheet = pdf.addPage([600, 800])
  for (let line = 0; line < 28; line++) {
    sheet.drawText(`Page ${page} line ${line}: reading progress`, {
      x: 50,
      y: 750 - line * 22,
      font,
      size: 14
    })
  }
}
const bytes = Buffer.from(await pdf.save())
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'pdf-progress-fixture',
      configureServer(server) {
        server.middlewares.use('/navigation.pdf', (_request, response) => {
          response.setHeader('Content-Type', 'application/pdf')
          response.end(bytes)
        })
        server.middlewares.use('/pdf-progress', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(
            await server.transformIndexHtml(
              '/pdf-progress',
              '<html><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/pdf-navigation-harness.jsx"></script></body></html>'
            )
          )
        })
      }
    }
  ]
})
let browser
const report = { samples: [], reversals: [], errors: [] }
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1000, height: 740 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/pdf-progress`
  )
  await page
    .locator('.pdfViewer [data-selection-start-offset]')
    .first()
    .waitFor()
  await page.evaluate(() => {
    const viewer = document.querySelector(
      '.hamster-reader__pdf-viewer-container'
    )
    const thumb = document.querySelector(
      '.hamster-reader__reading-progress-position'
    )
    window.progressSamples = []
    window.progressDirection = 'down'
    const record = () => {
      window.progressSamples.push({
        time: performance.now(),
        direction: window.progressDirection,
        scrollTop: viewer.scrollTop,
        scrollHeight: viewer.scrollHeight,
        clientHeight: viewer.clientHeight,
        page: Number(thumb.dataset.pageNumber),
        top: thumb.getBoundingClientRect().top
      })
    }
    window.progressObserver = new MutationObserver(record)
    window.progressObserver.observe(thumb, { attributes: true })
    window.recordProgress = record
    record()
  })
  await page.locator('.hamster-reader__pdf-viewer-container').hover()
  for (const direction of ['down', 'up']) {
    await page.evaluate((direction) => {
      window.progressDirection = direction
      window.recordProgress()
    }, direction)
    for (let step = 0; step < 130; step++) {
      await page.mouse.wheel(0, direction === 'down' ? 50 : -50)
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
    }
    const last = await page.evaluate(() => {
      window.recordProgress()
      return window.progressSamples.at(-1)
    })
    assert.equal(last.page, direction === 'down' ? 5 : 1)
    assert.equal(
      last.scrollTop,
      direction === 'down' ? last.scrollHeight - last.clientHeight : 0
    )
  }
  report.samples = await page.evaluate(() => window.progressSamples)
  report.reversals = report.samples.flatMap((sample, index) => {
    const previous = report.samples[index - 1]
    if (!previous || sample.direction !== previous.direction) return []
    const reversed =
      sample.direction === 'down'
        ? sample.scrollTop >= previous.scrollTop &&
          sample.top < previous.top - 0.5
        : sample.scrollTop <= previous.scrollTop &&
          sample.top > previous.top + 0.5
    return reversed ? [{ previous, sample }] : []
  })
  console.log(
    JSON.stringify(
      {
        samples: report.samples.length,
        reversals: report.reversals.length,
        examples: report.reversals.slice(0, 3),
        errors: report.errors
      },
      null,
      2
    )
  )
  assert.equal(report.errors.length, 0)
  assert.equal(
    report.reversals.length,
    0,
    'indicator must not move against the scroll direction'
  )
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
