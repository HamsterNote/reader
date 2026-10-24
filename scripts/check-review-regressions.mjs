import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(
  process.env.READER_BROWSER_OUTPUT ?? resolve(repo, '../ham91-review-browser')
)
await mkdir(output, { recursive: true })
const server = await createServer({
  root: repo,
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [repo, await realpath(resolve(repo, 'node_modules'))] }
  }
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })
const report = { cases: [] }
async function open(page, format, bytes, props = {}) {
  await page.evaluate(
    ({ format, bytes, props }) =>
      window.readerRegression.open(format, bytes, props),
    { format, bytes: [...bytes], props }
  )
  await page.locator(`[data-engine=${format}]`).waitFor()
}
async function update(page, props) {
  await page.evaluate((props) => window.readerRegression.update(props), props)
}
async function pdfVisible(page) {
  return page
    .locator('.pdfViewer .page')
    .evaluateAll((pages) =>
      pages.flatMap((page, index) =>
        page.getBoundingClientRect().width ? [index + 1] : []
      )
    )
}
async function selectText(page, selector, start, end) {
  await page
    .locator(selector)
    .first()
    .evaluate(
      (span, { start, end }) => {
        const range = document.createRange()
        range.setStart(span.firstChild, start)
        range.setEnd(span.firstChild, end)
        const selection = document.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
        span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      },
      { start, end }
    )
}
async function confirm(page) {
  await page.waitForFunction(() => window.readerRegression.selection.current)
  await page.evaluate(() =>
    window.readerRegression.selection.current.highlight()
  )
  await page.waitForFunction(
    () => window.readerRegression.state.ranges.length > 0
  )
  return page.evaluate(() => window.readerRegression.state.ranges.at(-1))
}
async function run(mobile) {
  const label = mobile ? 'mobile' : 'desktop'
  const page = await browser.newPage({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 },
    hasTouch: mobile
  })
  const errors = []
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  const result = { label, passed: false, checks: [] }
  report.cases.push(result)
  try {
    const html = await server.transformIndexHtml(
      '/review-regressions.html',
      '<html><body style="margin:0"><div id="root"></div><script type="module" src="/test/browser/review-regressions.tsx"></script></body></html>'
    )
    await page.route('**/review-regressions.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: html })
    )
    await page.goto(`${base}/review-regressions.html`)
    await page.waitForFunction(() => window.readerRegression)
    const pdf = await readFile(
      resolve(repo, 'test/compat/fixtures/pdf/two-column.pdf')
    )
    await open(page, 'pdf', pdf, { pageRange: { start: 2, end: 2 } })
    await page.waitForFunction(
      () => document.querySelectorAll('.pdfViewer .page').length === 2
    )
    await page.locator('.pdfViewer .page').nth(1).waitFor({ state: 'visible' })
    assert.deepEqual(await pdfVisible(page), [2])
    await update(page, { edgeCropEditing: true })
    assert.deepEqual(await pdfVisible(page), [2])
    await update(page, { pageRange: { start: 9, end: 10 } })
    assert.deepEqual(await pdfVisible(page), [])
    await update(page, { pageRange: undefined, edgeCropEditing: false })
    assert.deepEqual(await pdfVisible(page), [1, 2])
    result.checks.push(
      'PDF pageRange, crop editing, empty range, clear range; original page IDs'
    )

    const epub = await readFile(
      resolve(repo, 'test/compat/fixtures/epub/duplicate-text.epub')
    )
    await open(page, 'epub', epub, { pageRange: { start: 2, end: 2 } })
    await page.waitForFunction(
      () =>
        document.querySelector('foliate-view')?.renderer?.getContents()[0]
          ?.index === 1
    )
    await update(page, { edgeCropEditing: true })
    await page.waitForFunction(() =>
      document.querySelector('[data-engine-page="page-2"]')
    )
    assert.equal(await page.locator('[data-engine-page="page-1"]').count(), 0)
    assert.equal(
      await page.evaluate(async () => {
        const view = document.querySelector('foliate-view')
        const event = new CustomEvent('link', {
          cancelable: true,
          detail: { href: 'OPS/chapter3.xhtml' }
        })
        view.dispatchEvent(event)
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
        return (
          event.defaultPrevented && view.renderer.getContents()[0]?.index === 1
        )
      }),
      true
    )
    await update(page, { pageRange: { start: 9, end: 10 } })
    await page
      .locator('.hamster-reader__epub-container')
      .waitFor({ state: 'hidden' })
    await update(page, {
      pageRange: { start: 3, end: 3 },
      edgeCropEditing: false
    })
    await page.waitForFunction(
      () =>
        document.querySelector('foliate-view')?.renderer?.getContents()[0]
          ?.index === 2
    )
    result.checks.push(
      'EPUB pageRange, internal link, crop editing, empty range, range update; original chapter IDs'
    )

    const compat = Buffer.from(
      await readFile(resolve(repo, 'test/compat/fixtures/pdf/ligature.pdf'))
    )
    Buffer.from('<2469>').copy(compat, compat.indexOf(Buffer.from('<FB01>')))
    await open(page, 'pdf', compat)
    await page.locator('.textLayer [data-text-id]').first().waitFor()
    const nativeText = await page
      .locator('.textLayer [data-text-id]')
      .allTextContents()
      .then((texts) => texts.join(''))
    assert.equal(nativeText, '⑩ x')
    await page
      .locator('.textLayer [data-text-id]')
      .filter({ hasText: 'x' })
      .evaluate((span) => {
        const offset = span.textContent.indexOf('x')
        const range = document.createRange()
        range.setStart(span.firstChild, offset)
        range.setEnd(span.firstChild, offset + 1)
        const selection = document.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
    const oldRange = await confirm(page)
    assert.equal(oldRange.text, 'x')
    assert.equal(oldRange.start.offset, 2)
    await update(page, {
      ranges: [JSON.parse(JSON.stringify(oldRange))],
      selectedRangeId: oldRange.id
    })
    await page.evaluate(
      (id) => window.readerRegression.selection.current.scrollToRange(id),
      oldRange.id
    )
    await page.waitForFunction(
      () => document.getSelection()?.toString() === 'x'
    )
    result.checks.push(
      'compatibility character: real PDF text layer preserves legacy x offset 2 and restores highlighter'
    )

    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 300
      const context = canvas.getContext('2d')
      context.fillStyle = 'white'
      context.fillRect(0, 0, 400, 300)
      context.fillStyle = 'black'
      context.font = '20px sans-serif'
      context.fillText('Scanned text', 20, 36)
      return canvas.toDataURL('image/png')
    })
    const scan = await PDFDocument.create()
    const image = await scan.embedPng(png)
    for (let index = 0; index < 2; index++)
      scan
        .addPage([400, 300])
        .drawImage(image, { x: 0, y: 0, width: 400, height: 300 })
    await open(page, 'pdf', await scan.save(), {
      ocr: { enabled: true, pages: [1] }
    })
    const span = page.locator('[data-text-id="ocr-1-word"]')
    await span.waitFor()
    assert.equal(
      await span.evaluate((span) => getComputedStyle(span).color),
      'rgba(0, 0, 0, 0)'
    )
    assert.equal(
      await span.evaluate((span) => {
        const box = span.getBoundingClientRect()
        return (
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2
          ) === span
        )
      }),
      true
    )
    await selectText(page, '[data-text-id="ocr-1-word"]', 0, 7)
    await page.waitForFunction(
      () => window.readerRegression.state.segments.join('') === 'Scanned'
    )
    const range = await confirm(page)
    assert.equal(range.text, 'Scanned')
    assert.deepEqual(range.start, { selectionId: 'page-1', offset: 0 })
    await update(page, {
      ranges: [JSON.parse(JSON.stringify(range))],
      selectedRangeId: range.id,
      ocrDebug: true
    })
    await page.evaluate(
      (id) => window.readerRegression.selection.current.scrollToRange(id),
      range.id
    )
    await page.waitForFunction(
      () => document.getSelection()?.toString() === 'Scanned'
    )
    assert.equal(
      await span.evaluate((span) => getComputedStyle(span).color),
      'rgba(0, 0, 0, 0.5)'
    )
    const pixels = await page
      .locator('.pdfViewer canvas')
      .first()
      .evaluate((canvas) => {
        const data = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data
        let ink = 0
        for (let index = 0; index < data.length; index += 4)
          if (data[index] < 180 && data[index + 3]) ink++
        return ink
      })
    assert(pixels > 50)
    const state = await page.evaluate(() => window.readerRegression.state)
    assert.deepEqual(state.ocrPages, [1])
    assert(state.images[0].startsWith('data:image/png;base64,'))
    assert.deepEqual(state.errors, [])
    await page.screenshot({ path: resolve(output, `${label}-ocr.png`) })
    await update(page, { ocr: false })
    await span.waitFor({ state: 'detached' })
    result.checks.push(
      'image-only PDF: real raster input, custom OCR callback, transparent hittable text, legacy selection callbacks, saved range restore, debug, disable; nonblank canvas'
    )
    assert.deepEqual(errors, [])
    result.passed = true
  } catch (error) {
    result.failure = error.stack
    result.errors = errors
    result.debug = await page.locator('.pdfViewer .page').evaluateAll((pages) =>
      pages.map((page) => ({
        html: page.outerHTML.slice(0, 600),
        box: page.getBoundingClientRect().toJSON(),
        parent: page.parentElement.getBoundingClientRect().toJSON()
      }))
    )
    await page.screenshot({ path: resolve(output, `${label}-failed.png`) })
    console.error(label, error)
  } finally {
    await page.close()
  }
}
try {
  await run(false)
  await run(true)
} finally {
  await browser.close()
  await server.close()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
console.log(JSON.stringify(report, null, 2))
if (report.cases.some((result) => !result.passed)) process.exitCode = 1
