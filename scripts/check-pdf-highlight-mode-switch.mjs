import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham147-browser')
await mkdir(output, { recursive: true })
const externalBase = process.env.READER_BROWSER_URL
const server = externalBase
  ? null
  : await createServer({
      root: repo,
      server: { host: '127.0.0.1', port: 0 }
    })
let browser
try {
  await server?.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await page.goto(
    externalBase ?? `http://127.0.0.1:${server.httpServer.address().port}`
  )
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(resolve(repo, 'test/compat/fixtures/pdf/two-column.pdf'))
  await page.getByRole('button', { name: '加载文件', exact: true }).click()
  const span = page
    .locator('.pdfViewer .page[data-page-number="1"] .textLayer span')
    .filter({ hasText: /\w{5}/ })
    .first()
  await span.waitFor().catch(async (error) => {
    console.log((await page.locator('body').innerText()).slice(0, 6000))
    await page.screenshot({ path: resolve(output, 'failure.png') })
    throw error
  })
  await span.evaluate((span) => {
    const range = document.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, Math.min(10, span.textContent.length))
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  const readRanges = () =>
    page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            'hamster-reader-demo:annotations:v5:two-column.pdf'
          )
        )?.ranges
    )
  await page.waitForFunction(
    () =>
      JSON.parse(
        localStorage.getItem(
          'hamster-reader-demo:annotations:v5:two-column.pdf'
        )
      )?.ranges.length === 1
  )
  const before = await readRanges()
  // Show the persisted marker rather than the temporary native selection.
  await page
    .locator('.pdfViewer .page')
    .first()
    .click({ position: { x: 400, y: 240 } })
  await page.screenshot({ path: resolve(output, 'layout-before.png') })
  await page.getByTestId('render-mode-select').selectOption('text')
  await page
    .locator('.hamster-reader__pdf-text-viewport .hsn-selection-content')
    .waitFor()
  await page.screenshot({ path: resolve(output, 'text.png') })
  assert.deepEqual(
    await readRanges(),
    before,
    'Text mode must not persist display geometry'
  )
  await page.getByTestId('render-mode-select').selectOption('layout')
  await span.waitFor()
  await page
    .locator('.hamster-reader__pdf-viewer-container')
    .evaluate((element) => {
      element.scrollTop = 0
    })
  // Deselect the annotation so the persisted yellow marker is visible.
  await page
    .locator('.pdfViewer .page')
    .first()
    .click({ position: { x: 400, y: 240 } })
  await page.locator('.hamster-reader__pdf-highlight-rect').first().waitFor()
  await page.screenshot({ path: resolve(output, 'layout-after.png') })
  const after = await readRanges()
  assert.deepEqual(
    after,
    before,
    'mode switches must preserve the stored PDF geometry'
  )
  const alignment = await span.evaluate((span) => {
    const range = document.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, 10)
    const text = range.getBoundingClientRect()
    const marker = document
      .querySelector('.hamster-reader__pdf-highlight-rect')
      .getBoundingClientRect()
    return Object.fromEntries(
      ['left', 'top', 'width', 'height'].map((key) => [
        key,
        Math.abs(text[key] - marker[key])
      ])
    )
  })
  assert(
    Object.values(alignment).every((delta) => delta < 2),
    `PDF marker must align with text: ${JSON.stringify(alignment)}`
  )
  const marker = await page
    .locator('.hamster-reader__pdf-highlight-rect')
    .first()
    .boundingBox()
  await page.mouse.click(
    marker.x + marker.width / 2,
    marker.y + marker.height / 2
  )
  await page.waitForFunction(
    (text) => document.getSelection()?.toString() === text,
    before[0].text
  )
  const textCreated = []
  for (const crossSpan of [false, true]) {
    await page.getByTestId('render-mode-select').selectOption('text')
    const textSpan = page
      .locator('.hsn-selection-content [data-selection-start-offset]')
      .filter({ hasText: 'Right column line one' })
      .first()
    await textSpan.waitFor()
    await textSpan.evaluate((span, crossSpan) => {
      const range = document.createRange()
      const first = document.querySelector(
        '.hsn-selection-content [data-selection-start-offset]'
      )
      range.setStart(crossSpan ? first.firstChild : span.firstChild, 0)
      range.setEnd(span.firstChild, 5)
      const selection = document.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    }, crossSpan)
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    await page.waitForFunction(
      (count) =>
        JSON.parse(
          localStorage.getItem(
            'hamster-reader-demo:annotations:v5:two-column.pdf'
          )
        )?.ranges.length === count,
      crossSpan ? 4 : 2,
      { timeout: 5000 }
    )
    const saved = await readRanges()
    assert.deepEqual(
      saved[0],
      before[0],
      'creating a Text highlight must preserve existing PDF geometry'
    )
    const added = saved.slice(crossSpan ? 2 : 1)
    assert.deepEqual(
      added.map((range) => [range.start.offset, range.end.offset]),
      crossSpan
        ? [
            [0, 20],
            [40, 45]
          ]
        : [[40, 45]],
      'source ranges must describe only the selected text, excluding Left column line two'
    )
    for (const range of added) {
      assert(
        range.rectsBySelectionId['page-1']?.length > 0,
        'Text-created highlights must persist PDF-page rectangles in the shared annotations'
      )
    }
    await page.screenshot({
      path: resolve(
        output,
        `text-created-${crossSpan ? 'split' : 'single'}.png`
      )
    })
    await page.getByTestId('render-mode-select').selectOption('layout')
    await span.waitFor()
    await page
      .locator('.hamster-reader__pdf-viewer-container')
      .evaluate((element) => {
        element.scrollTop = 0
      })
    await page
      .locator('.pdfViewer .page')
      .first()
      .click({ position: { x: 400, y: 240 } })
    for (const range of added) {
      const highlight = page.locator(`[data-range-id="${range.id}"]`).first()
      await highlight.waitFor({ state: 'visible' })
      const box = await highlight.boundingBox()
      assert(box.width > 0 && box.height > 0)
      await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2)
      await page.waitForFunction(
        (expected) =>
          document.getSelection()?.toString().replace(/\n/g, '') === expected,
        range.text
      )
      await page
        .locator('.pdfViewer .page')
        .first()
        .click({ position: { x: 400, y: 240 } })
    }
    assert.deepEqual(
      await readRanges(),
      saved,
      'PDF must use the same persisted annotations'
    )
    await page.screenshot({
      path: resolve(
        output,
        `text-created-pdf-${crossSpan ? 'split' : 'single'}.png`
      )
    })
    textCreated.push({
      crossSpan,
      ranges: added.map(({ text, start, end }) => ({ text, start, end }))
    })
  }
  assert.deepEqual(errors, [], 'Demo must have no uncaught browser errors')
  const report = {
    passed: true,
    browser: 'Chromium',
    scenario:
      'PDF Demo: Layout highlight → Text → Layout; Text single/split highlights → Layout → click highlights',
    alignmentDeltaPx: alignment,
    storedGeometryPreserved: true,
    textCreated,
    selectedText: before[0].text
  }
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server?.close()
}
