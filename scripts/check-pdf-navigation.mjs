import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham160-browser')
await mkdir(output, { recursive: true })
const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
for (let p = 1; p <= 5; p++) {
  const sheet = doc.addPage([600, 1800])
  if (p !== 3) {
    for (let line = 0; line < 100; line++)
      sheet.drawText(
        `PAGE ${p} LINE ${String(line).padStart(3, '0')} repeated words for reading`,
        {
          x: 45,
          y: 1750 - line * 17,
          font,
          size: 12
        }
      )
  } else
    sheet.drawRectangle({
      x: 40,
      y: 60,
      width: 520,
      height: 1640,
      color: rgb(0.7, 0.8, 0.9)
    })
}
const file = resolve(output, 'navigation.pdf')
await writeFile(file, await doc.save())
const server = await createServer({
  root: repo,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'pdf-navigation-fixture',
      configureServer(server) {
        server.middlewares.use(
          '/navigation.pdf',
          async (_request, response) => {
            response.setHeader('Content-Type', 'application/pdf')
            response.end(Buffer.from(await doc.save()))
          }
        )
        server.middlewares.use(
          '/pdf-navigation',
          async (_request, response) => {
            response.setHeader('Content-Type', 'text/html')
            response.end(
              await server.transformIndexHtml(
                '/pdf-navigation',
                `
          <html><body style="margin:0"><div id="root"></div>
          <script type="module" src="/scripts/pdf-navigation-harness.jsx"></script></body></html>`
              )
            )
          }
        )
      }
    }
  ]
})
let browser
const report = { checks: [], errors: [] }
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/pdf-navigation`
  )
  const viewer = page.locator('.hamster-reader__pdf-viewer-container')
  await page
    .locator('.pdfViewer [data-selection-start-offset]')
    .first()
    .waitFor()
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()
  await page.getByTestId('page-browser-page-1').locator('img').waitFor()
  const lastPreview = page.getByTestId('page-browser-page-5')
  await lastPreview.scrollIntoViewIfNeeded()
  await lastPreview.locator('img').waitFor()
  const preview = await lastPreview.locator('img').evaluate((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight
  }))
  assert(Math.abs(preview.width / preview.height - 1 / 3) < 0.01)
  await lastPreview.click()
  await page
    .locator(
      '.pdfViewer .page[data-page-number="5"] [data-selection-start-offset]'
    )
    .first()
    .waitFor()
  await page.screenshot({ path: resolve(output, 'previews.png') })
  report.checks.push({ name: 'unvisited preview and page navigation', preview })
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()
  await page.getByTestId('page-browser-page-1').scrollIntoViewIfNeeded()
  await page.getByTestId('page-browser-page-1').locator('img').waitFor()
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()

  const installMeasurement = () =>
    page.evaluate(() => {
      // eslint-disable-next-line sonarjs/cognitive-complexity -- independent character-level browser measurement oracle
      window.sourceCharacter = (mode, source) => {
        const host = document.querySelector(
          mode === 'layout'
            ? '.hamster-reader__pdf-viewer-container'
            : '.hamster-reader__pdf-text-viewport'
        )
        if (!host) return null
        const box = host.getBoundingClientRect()
        const top = box.top + window.pdfNavigationInset
        let first = null
        for (const span of host.querySelectorAll(
          '[data-selection-start-offset][data-text-id]'
        )) {
          const pageNumber = Number(
            span.dataset.textId.match(/^page-(\d+)/)?.[1]
          )
          if (source && pageNumber !== source.pageNumber) continue
          const start = Number(span.dataset.selectionStartOffset)
          const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
          let consumed = 0
          while (walker.nextNode()) {
            const node = walker.currentNode
            for (let local = 0; local < node.length; local++) {
              const offset = start + consumed + local
              if (source && source.offset !== offset) continue
              if (!source && !node.textContent[local].trim()) continue
              const range = document.createRange()
              range.setStart(node, local)
              range.setEnd(node, local + 1)
              const rect = range.getBoundingClientRect()
              const result = {
                pageNumber,
                offset,
                textId: span.dataset.textId,
                text: span.textContent.slice(local, local + 60),
                top: rect.top,
                safeTop: top,
                scrollTop: host.scrollTop,
                maxScroll: host.scrollHeight - host.clientHeight,
                delta: rect.top - top,
                left: rect.left,
                visible:
                  rect.bottom > top &&
                  rect.top < box.bottom - 80 &&
                  rect.right > box.left &&
                  rect.left < box.right
              }
              if (source) return result
              if (result.visible && (!first || rect.top < first.top - 0.5))
                first = result
            }
            consumed += node.length
          }
        }
        return first
      }
      window.pdfNavigationInset = 36
    })
  await installMeasurement()
  const capture = (mode) =>
    page.evaluate((mode) => window.sourceCharacter(mode), mode)
  const waitSource = async (mode, source, align = false) => {
    await page.waitForFunction(
      ({ mode, source, align }) => {
        const result = window.sourceCharacter(mode, source)
        return result?.visible && (!align || Math.abs(result.delta) < 2)
      },
      { mode, source, align }
    )
    return page.evaluate(
      ({ mode, source }) => window.sourceCharacter(mode, source),
      { mode, source }
    )
  }
  const mode = () => page.getByTestId('tool-bottom-bar-render-mode').click()
  const goLine = async (line) => {
    await viewer.evaluate((element, line) => {
      const span = [
        ...element.querySelectorAll('[data-selection-start-offset]')
      ].find((span) =>
        span.textContent.includes(
          `PAGE 1 LINE ${String(line).padStart(3, '0')}`
        )
      )
      element.scrollTop +=
        span.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        36
    }, line)
  }
  await goLine(60)
  const sourceA = await capture('layout')
  assert(sourceA.offset > 1000)
  await page.waitForFunction((source) => {
    const saved = window.pdfNavigationTest.data.layoutReadingProgress
    return (
      saved?.pageNumber === source.pageNumber && saved.offset === source.offset
    )
  }, sourceA)
  await mode()
  await page
    .locator('.hamster-reader__pdf-text-viewport .hsn-selection-content')
    .waitFor()
  const inText = await waitSource('text', sourceA)
  const sourceB = await capture('text')
  await page.screenshot({ path: resolve(output, 'text.png') })
  await mode()
  const inLayout = await waitSource('layout', sourceB, true)
  report.checks.push({
    name: 'bidirectional source character and safe alignment',
    sourceA,
    inText,
    sourceB,
    inLayout
  })
  await page.screenshot({ path: resolve(output, 'layout-restored.png') })

  // Select a deep range and navigate back from page 1's top using the real list.
  await goLine(70)
  const selected = page
    .locator('.pdfViewer [data-selection-start-offset]')
    .filter({ hasText: 'PAGE 1 LINE 070' })
    .first()
  await selected.evaluate((span) => {
    const range = document.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, 15)
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  await page.waitForFunction(
    () => window.pdfNavigationTest.data.ranges.length === 1
  )
  const highlight = await page.evaluate(
    () => window.pdfNavigationTest.data.ranges[0]
  )
  await viewer.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()
  await page.getByRole('tab', { name: '高亮', exact: true }).click()
  await page.getByTestId(`page-browser-highlight-${highlight.id}`).click()
  const highlightPosition = await waitSource(
    'layout',
    { pageNumber: 1, offset: highlight.start.offset },
    true
  )
  report.checks.push({
    name: 'deep highlight list destination',
    highlightPosition
  })
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()

  // Bookmark captures the source first line at the instant the button is used.
  await goLine(50)
  const bookmarkSource = await capture('layout')
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()
  await page.getByRole('tab', { name: '书签', exact: true }).click()
  await page.getByRole('button', { name: '新增书签', exact: true }).click()
  await page.waitForFunction(
    () => window.pdfNavigationTest.data.bookmarks.length === 1
  )
  const bookmark = await page.evaluate(
    () => window.pdfNavigationTest.data.bookmarks[0]
  )
  assert.equal(bookmark.offset, bookmarkSource.offset)
  assert(
    await page
      .getByRole('button', { name: '新增书签', exact: true })
      .isDisabled()
  )
  await viewer.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.locator('.hamster-reader__bookmark-link').first().click()
  const bookmarkPosition = await waitSource('layout', bookmark, true)
  await page.screenshot({ path: resolve(output, 'bookmark.png') })
  report.checks.push({
    name: 'instant bookmark capture, deduplication and restore',
    bookmark,
    bookmarkPosition
  })
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()

  // A scanned page has no text context to wait for; retain the 60% handoff.
  await viewer.evaluate((element) => {
    const sheet = element.querySelector('.page[data-page-number="3"]')
    element.scrollTop +=
      sheet.getBoundingClientRect().top -
      element.getBoundingClientRect().top +
      sheet.clientHeight * 0.6 -
      36
  })
  await page.waitForFunction(
    () => window.pdfNavigationTest.data.layoutReadingProgress?.pageNumber === 3
  )
  await mode()
  await page.waitForFunction(
    () =>
      window.pdfNavigationTest.data.textReadingProgress?.currentPageNumber === 3
  )
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '.hamster-reader__viewport-pagination button[aria-label="下一页"]'
      )?.disabled
  )
  const noText = await page.evaluate(
    () => window.pdfNavigationTest.data.textReadingProgress
  )
  assert(Math.abs(noText.verticalPercentage - 60) < 1)
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()
  await page.getByRole('tab', { name: '书签', exact: true }).click()
  await page.getByRole('button', { name: '新增书签', exact: true }).click()
  const scanBookmark = await page.evaluate(() =>
    window.pdfNavigationTest.data.bookmarks.at(-1)
  )
  assert(Math.abs(scanBookmark.verticalPercentage - 60) < 1)
  await page.getByRole('button', { name: '页面浏览', exact: true }).click()
  await page.getByRole('button', { name: '外部模式切换', exact: true }).click()
  await page.waitForFunction(() => {
    const host = document.querySelector('.hamster-reader__pdf-viewer-container')
    const sheet = host?.querySelector('.page[data-page-number="3"]')
    if (!sheet) return false
    const ratio =
      (100 *
        (host.getBoundingClientRect().top +
          36 -
          sheet.getBoundingClientRect().top)) /
      sheet.clientHeight
    return Math.abs(ratio - 60) < 1
  })
  report.checks.push({ name: 'scanned page 60% round trip', noText })
  await page.screenshot({ path: resolve(output, 'scanned-60.png') })

  for (const zoom of ['50%', '100%', '200%']) {
    await page.getByTestId('tool-bottom-bar-layout-zoom').click()
    await page.getByRole('menuitem', { name: zoom, exact: true }).click()
    await goLine(55)
    const first = await capture('layout')
    await mode()
    await waitSource('text', first)
    const textFirst = await capture('text')
    await mode()
    const restored = await waitSource('layout', textFirst, true)
    report.checks.push({
      name: `source alignment at ${zoom}`,
      first,
      textFirst,
      restored
    })
  }
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 720, height: 320 }
  ]) {
    await page.setViewportSize(viewport)
    await goLine(55)
    const first = await capture('layout')
    assert(first)
    await mode()
    await waitSource('text', first)
    const textFirst = await capture('text')
    await mode()
    const restored = await waitSource('layout', textFirst, true)
    report.checks.push({
      name: `responsive ${viewport.width}x${viewport.height}`,
      first,
      textFirst,
      restored
    })
    await page.screenshot({
      path: resolve(output, `viewport-${viewport.width}.png`)
    })
  }
  await page.setViewportSize({ width: 1000, height: 800 })
  for (const fixture of ['two-column', 'ligature', 'rotated']) {
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/pdf-navigation?fixture=/test/compat/fixtures/pdf/${fixture}.pdf`
    )
    await page
      .locator('.pdfViewer [data-selection-start-offset]')
      .first()
      .waitFor()
    await installMeasurement()
    const original = await capture('layout')
    assert(original, `${fixture} must expose a visible source character`)
    await mode()
    await waitSource('text', original)
    const textFirst = await capture('text')
    await mode()
    const restored = await waitSource('layout', textFirst, false)
    assert(
      Math.abs(restored.delta) < 2 ||
        Math.abs(restored.scrollTop - restored.maxScroll) < 2,
      `${fixture} must align its source character or reach the document boundary`
    )
    report.checks.push({
      name: `${fixture} fixture source mapping`,
      original,
      textFirst,
      restored
    })
    await page.screenshot({ path: resolve(output, `${fixture}.png`) })
  }
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.failure = error.stack
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0]
    await page?.screenshot({ path: resolve(output, 'failure.png') })
    report.body = (await page?.locator('body').innerText())?.slice(-1000)
    report.state = await page?.evaluate(() => window.pdfNavigationTest?.data)
  }
  throw error
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
