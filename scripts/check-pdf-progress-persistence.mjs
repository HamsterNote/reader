// Regression from the HAM-276 review: cached page seeks must persist progress.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  const page = await browser.newPage({
    viewport: { width: 800, height: 900 }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/progress.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/progress.html`)
  await page.addStyleTag({
    content: 'body{margin:0}.hamster-reader{height:100%}'
  })
  await page.waitForFunction(() => window.readerRegression)
  const doc = await PDFDocument.create()
  for (let i = 0; i < 12; i++) {
    const sheet = doc.addPage([600, 800])
    sheet.drawText(`Page ${i + 1}`, { x: 40, y: 720, size: 20 })
  }
  const bytes = Array.from(await doc.save())
  const open = (restore) =>
    page.evaluate(
      async ({ bytes, restore }) => {
        window.progressPositions = []
        await window.readerRegression.open('pdf', bytes, {
          containMarginTop: 44,
          data: restore
            ? {
                layoutReadingProgress: { pageNumber: 8, verticalPercentage: 0 }
              }
            : undefined,
          onDataChange: (data) => {
            if (data.layoutReadingProgress)
              window.progressPositions.push(data.layoutReadingProgress)
          }
        })
      },
      { bytes, restore }
    )
  const settle = () =>
    page.evaluate(async () => {
      for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame)
    })
  const measure = (requested) =>
    page.evaluate((requested) => {
      const root = document.querySelector('.hamster-reader')
      return {
        requested,
        indicator: Number(
          root.querySelector('[role=slider]').getAttribute('aria-valuenow')
        ),
        savedPositions: window.progressPositions,
        actualTop: root
          .querySelector(`.pdfViewer .page[data-page-number="${requested}"]`)
          .getBoundingClientRect().top,
        safeTop: root.getBoundingClientRect().top + 44
      }
    }, requested)

  for (const restore of [false, true]) {
    await open(restore)
    await page.locator('.pdfViewer .page[data-page-number="12"]').waitFor()
    await settle()
    if (restore) {
      const initial = await measure(8)
      console.log('RESTORE', JSON.stringify(initial))
      assert(
        Math.abs(initial.actualTop - initial.safeTop) <= 1,
        JSON.stringify(initial)
      )
      assert.deepEqual(
        initial.savedPositions,
        [],
        'restoration must not rewrite saved progress'
      )
    }
    const rows = []
    // Start away from the restored page: Reader deduplicates unchanged saves.
    for (const requested of restore ? [1, 8, 1, 8, 1] : [8, 1, 8, 1, 8]) {
      await page.evaluate(() => {
        window.progressPositions = []
      })
      const box = await page.getByRole('slider').boundingBox()
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + Math.max(0.5, (box.height * (requested - 1)) / 11)
      )
      await settle()
      const row = await measure(requested)
      console.log('SEEK', JSON.stringify({ restore, ...row }))
      rows.push(row)
    }
    for (const row of rows) {
      const message = JSON.stringify(row)
      assert(Math.abs(row.actualTop - row.safeTop) <= 1, message)
      assert.equal(row.indicator, row.requested, message)
      assert(row.savedPositions.length > 0, message)
      for (const saved of row.savedPositions) {
        assert.equal(saved.pageNumber, row.requested, message)
        assert(Math.abs(saved.verticalPercentage) <= 0.1, message)
      }
    }
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS cached PDF seeks: 10; geometry, slider and saved progress agree; restore stays silent'
  )
} finally {
  await browser?.close()
  await server.close()
}
