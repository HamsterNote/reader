import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham147-browser')
const externalBase = process.env.READER_BROWSER_URL
const server = externalBase ? null : await createServer({ root: repo })
let browser
try {
  await mkdir(output, { recursive: true })
  await server?.listen()
  const base =
    externalBase ?? `http://127.0.0.1:${server.httpServer.address().port}`
  const html = externalBase
    ? (await (await fetch(base)).text()).replace(
        '/demo/main.tsx',
        '/test/browser/review-regressions.tsx'
      )
    : await server.transformIndexHtml(
        '/selection-group.html',
        '<html><body style="margin:0"><div id="root"></div><script type="module" src="/test/browser/review-regressions.tsx"></script></body></html>'
      )
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/selection-group.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/selection-group.html`)
  await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
  await page.waitForFunction(() => window.readerRegression)
  // Source order differs from paragraph reading order, with a genuinely
  // unselected source item between the two selected paragraphs.
  const fixture = await PDFDocument.create()
  const font = await fixture.embedFont(StandardFonts.Helvetica)
  const pdfPage = fixture.addPage([600, 800])
  for (const [text, y] of [
    ['First paragraph text', 720],
    ['Unselected source gap', 500],
    ['Second paragraph text', 620]
  ])
    pdfPage.drawText(text, { x: 40, y, font, size: 20 })
  const bytes = [...(await fixture.save())]
  await page.evaluate(
    (bytes) =>
      window.readerRegression.open('pdf', bytes, {
        renderMode: 'text',
        isPdf: true
      }),
    bytes
  )
  const anchors = page.locator(
    '.hsn-selection-content [data-selection-start-offset]'
  )
  await anchors.first().waitFor()
  const original = await anchors.first().evaluate((first) => {
    const last = [
      ...document.querySelectorAll(
        '.hsn-selection-content [data-selection-start-offset]'
      )
    ].find((node) => node.textContent === 'Second paragraph text')
    const paragraphs = [
      ...document.querySelectorAll('.hamster-reader__pdf-text-paragraph')
    ].map((node) => node.textContent)
    if (
      !first.closest('.hamster-reader__pdf-text-paragraph') ||
      first.closest('.hamster-reader__pdf-text-paragraph') ===
        last.closest('.hamster-reader__pdf-text-paragraph')
    )
      throw new Error(
        `Fixture must span different paragraphs: ${JSON.stringify(paragraphs)}`
      )
    const range = document.createRange()
    range.setStart(first.firstChild, 2)
    range.setEnd(last.firstChild, 5)
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    last.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    last.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return { text: range.toString(), paragraphs }
  })
  const originalSegments = await page.evaluate(() =>
    window.readerRegression.state.sourceSegments.map(
      ({ id, pageNumber, startCharIndex, endCharIndex, selectedText }) => ({
        id,
        pageNumber,
        startCharIndex,
        endCharIndex,
        selectedText
      })
    )
  )
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  await page.waitForFunction(
    () => window.readerRegression.state.ranges.length === 2
  )
  const saved = await page.evaluate(() => window.readerRegression.state.ranges)
  const expectedSources = [
    [2, 20],
    [41, 46]
  ]
  assert.deepEqual(
    saved.map(({ start, end }) => [start.offset, end.offset]),
    expectedSources
  )
  assert.deepEqual(
    saved.map(({ selectionGroup }) => selectionGroup),
    [
      { id: saved[0].id, index: 0 },
      { id: saved[0].id, index: 1 }
    ]
  )
  assert.equal(
    originalSegments.map((segment) => segment.selectedText).join(''),
    'rst paragraph textSecon'
  )
  const checks = []
  // Reopen from JSON, deliberately reversing storage order; group order is explicit.
  for (const reopen of [false, true]) {
    if (reopen)
      await page.evaluate(
        ({ bytes, saved }) =>
          window.readerRegression.open('pdf', bytes, {
            ranges: JSON.parse(JSON.stringify(saved)).reverse(),
            isPdf: true
          }),
        { bytes, saved }
      )
    for (const mode of ['layout', 'text']) {
      await page.evaluate(
        ({ mode, saved, reopen }) =>
          window.readerRegression.update({
            renderMode: mode,
            ranges: reopen ? [...saved].reverse() : saved,
            selectedRangeId: null,
            onSelectRange: (id) =>
              window.readerRegression.update({ selectedRangeId: id })
          }),
        { mode, saved, reopen }
      )
      const selector =
        mode === 'layout'
          ? '.hamster-reader__pdf-highlight-rect'
          : '.hsn-selection-percent-rect-highlight'
      await page.locator(selector).first().waitFor()
      for (const member of saved) {
        await page.evaluate(() => {
          window.readerRegression.state.sourceSegments = []
          document.getSelection()?.removeAllRanges()
        })
        const marker =
          mode === 'layout'
            ? page.locator(`${selector}[data-range-id="${member.id}"]`).first()
            : page.locator(selector).nth(member.selectionGroup.index)
        const box = await marker.boundingBox()
        assert(box && box.width > 0 && box.height > 0)
        await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2)
        await page
          .waitForFunction(
            () => window.readerRegression.state.sourceSegments.length === 2,
            null,
            { timeout: 5000 }
          )
          .catch(async (error) => {
            console.error({
              reopen,
              mode,
              clicked: member.id,
              debug: await page.evaluate(() => ({
                segments: window.readerRegression.state.sourceSegments,
                selection: document.getSelection()?.toString(),
                body: document.body.innerText,
                markers: [
                  ...document.querySelectorAll(
                    '.hsn-selection-percent-rect-highlight'
                  )
                ].map((node) => node.outerHTML)
              }))
            })
            await page.screenshot({
              path: resolve(output, 'group-failure.png')
            })
            throw error
          })
        const segments = await page.evaluate(() =>
          window.readerRegression.state.sourceSegments.map(
            ({
              id,
              pageNumber,
              startCharIndex,
              endCharIndex,
              selectedText
            }) => ({
              id,
              pageNumber,
              startCharIndex,
              endCharIndex,
              selectedText
            })
          )
        )
        assert.deepEqual(
          segments,
          originalSegments,
          `${mode}: clicking either paragraph restores exactly the original source fragments`
        )
        if (mode === 'layout') {
          assert.equal(
            await page.locator(`${selector}[data-selected="true"]`).count(),
            2
          )
          const copied = await page.evaluate(() => {
            const data = new DataTransfer()
            document.dispatchEvent(
              new ClipboardEvent('copy', {
                clipboardData: data,
                cancelable: true
              })
            )
            return data.getData('text/plain')
          })
          assert.equal(
            copied,
            originalSegments.map((segment) => segment.selectedText).join('')
          )
        } else {
          assert.equal(
            await page.locator('.hsn-selection-percent-rect-selected').count(),
            2,
            'Text selection overlay must select both paragraphs'
          )
          assert.equal(
            await page.locator('.hsn-selection-percent-rect-active').count(),
            0,
            'restoring an existing group must not create a new highlight draft'
          )
        }
        checks.push({
          reopen,
          mode,
          clickedIndex: member.selectionGroup.index,
          segments
        })
        await page.screenshot({
          path: resolve(
            output,
            `group-${reopen ? 'reopened' : 'created'}-${mode}-${member.selectionGroup.index}.png`
          )
        })
        // Deselect without modifying annotations before clicking the other part.
        await page.evaluate(() =>
          window.readerRegression.update({ selectedRangeId: null })
        )
      }
    }
  }
  assert.deepEqual(errors, [])
  const report = {
    passed: true,
    browser: 'Chromium',
    original,
    sourceRanges: expectedSources,
    gapExcluded: [20, 41],
    checks
  }
  await writeFile(
    resolve(output, 'selection-group-report.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server?.close()
}
