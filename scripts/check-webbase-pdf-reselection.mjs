import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'

// Run against WebBase's real BrowserDemo, ReaderEditorPane and persistence bridge.
// The server determines which reader artifact is exercised; no reader harness
// or full linked-state callback is injected into the host.
const base = process.env.WEBBASE_BROWSER_URL ?? 'http://127.0.0.1:6228/?demo=1'
const output =
  process.env.WEBBASE_TEST_OUTPUT ?? 'test-results/webbase-reselection'
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const report = { url: base, browser: browser.version(), cases: [] }
const alphabet = 'abcdefghijklmnopqrstuvwxyz'
const headings = ['Heading one', 'Heading two']
const canonicalBase = headings.join('').length
const gestures = ['mouse', 'touch'].flatMap((input) =>
  ['end', 'start'].map((side) => ({ input, side }))
)
const endpoints = (range) => ({
  text: range.text,
  startPage: range.start.selectionId,
  startOffset: range.start.offset,
  endPage: range.end.selectionId,
  endOffset: range.end.offset
})
// Upsert-only hosts append newly exposed fragments after existing ones. This
// fixture has unique letters: compare each source fragment in visual alphabet
// order, independently of insertion order and selectionGroup.index metadata.
const targetFragments = (ranges, independentId) =>
  ranges
    .filter((item) => item.id !== independentId)
    .sort((a, b) => alphabet.indexOf(a.text[0]) - alphabet.indexOf(b.text[0]))
// Independent oracle: offsets follow the PDF drawing/source order below, not
// the reader's DOM-to-canonical conversion or the returned annotation values.
const expectedFragments = (start, end, reordered) => {
  const fragment = (text, offset, length) => ({
    text,
    startPage: 'page-1',
    startOffset: offset,
    endPage: 'page-1',
    endOffset: offset + length
  })
  if (!reordered)
    return [
      fragment(alphabet.slice(start, end), canonicalBase + start, end - start)
    ]
  return Array.from({ length: end - start }, (_, index) =>
    fragment(alphabet[start + index], canonicalBase + 25 - start - index, 1)
  )
}
try {
  for (const reordered of [false, true]) {
    const pdf = await PDFDocument.create()
    const sheet = pdf.addPage([600, 800])
    sheet.drawText(headings[0], { x: 40, y: 760, size: 12 })
    sheet.drawText(headings[1], { x: 40, y: 730, size: 12 })
    if (reordered) {
      for (let i = alphabet.length - 1; i >= 0; i--)
        sheet.drawText(alphabet[i], { x: 40 + i * 12, y: 700, size: 12 })
    } else sheet.drawText(alphabet, { x: 40, y: 700, size: 12 })
    const bytes = Buffer.from(await pdf.save())
    await writeFile(
      `${output}/${reordered ? 'reordered' : 'normal'}.pdf`,
      bytes
    )
    for (const { input, side } of gestures) {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 950 },
        hasTouch: true
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.setDefaultTimeout(20000)
      const cdp = await page.context().newCDPSession(page)
      const name = `${reordered ? 'reordered' : 'normal'}-${input}-${side}`
      try {
        await page.goto(base)
        await page.getByRole('heading', { name: 'WebView Demo' }).waitFor()
        await page.evaluate(() => {
          window.highlightWrites = []
          window.lastHighlightWriteAt = performance.now()
          const host = window.ReactNativeWebView
          const send = host.postMessage.bind(host)
          host.postMessage = (text) => {
            try {
              const message = JSON.parse(text)
              if (['file.write', 'file.create'].includes(message.request)) {
                const doc = JSON.parse(message.payload.contents)
                if (doc.highlights) {
                  window.highlightWrites.push(doc.highlights)
                  window.lastHighlightWriteAt = performance.now()
                }
              }
            } catch {
              /* Other bridge messages are not annotation writes. */
            }
            send(text)
          }
        })
        await page
          .locator('.browser-demo__controls input[type=file]')
          .setInputFiles({
            name: 'ham226.pdf',
            mimeType: 'application/pdf',
            buffer: bytes
          })
        await page
          .getByRole('button', { name: '写入并打开', exact: true })
          .click()
        await page
          .getByRole('button', { name: '切换到文字渲染模式', exact: true })
          .click()
        const text = page
          .locator('.hsn-selection-content [data-text-id]')
          .nth(2)
        await text.waitFor()
        await page.evaluate(async () => {
          await document.fonts.ready
          await new Promise(requestAnimationFrame)
          await new Promise(requestAnimationFrame)
        })
        const points = await text.evaluate((element, reordered) => {
          const at = (offset) => {
            const glyph = reordered
              ? element
                  .closest('.hsn-selection-content')
                  .querySelectorAll('[data-text-id]')[offset + 2]
              : element
            const range = document.createRange()
            range.setStart(glyph.firstChild, reordered ? 0 : offset)
            range.setEnd(glyph.firstChild, reordered ? 1 : offset + 1)
            const rect = range.getBoundingClientRect()
            return {
              x: rect.x + 0.2,
              hitX: rect.x + rect.width / 2,
              rightX: rect.right - 0.2,
              y: rect.y + rect.height / 2
            }
          }
          const heading = element
            .closest('.hsn-selection-content')
            .querySelectorAll('[data-text-id]')[1]
          const headingAt = (offset) => {
            const range = document.createRange()
            range.setStart(heading.firstChild, offset)
            range.setEnd(heading.firstChild, offset + 1)
            const rect = range.getBoundingClientRect()
            return { x: rect.x + 0.2, y: rect.y + rect.height / 2 }
          }
          return {
            letters: Array.from({ length: 26 }, (_, offset) => at(offset)),
            independentStart: headingAt(2),
            independentEnd: headingAt(7)
          }
        }, reordered)
        const settleWrites = () =>
          page.waitForFunction(
            () => performance.now() - window.lastHighlightWriteAt > 300
          )
        const deselect = async () => {
          const viewer = await page
            .getByTestId('intermediate-document-text-viewer')
            .boundingBox()
          await page.mouse.click(
            viewer.x + viewer.width / 2,
            viewer.y + viewer.height - 80
          )
          await page.waitForFunction(
            () => !document.querySelector('[data-pdf-handle-hit-target]')
          )
          assert.equal(
            await page
              .locator('.hamster-reader__pdf-selection-preview')
              .count(),
            0
          )
        }
        const createHighlight = async (start, end) => {
          const count = await page.evaluate(() => window.highlightWrites.length)
          await page.mouse.move(start.x, start.y)
          await page.mouse.down()
          await page.mouse.move(end.x, end.y, { steps: 6 })
          await page.mouse.up()
          await page.getByRole('button', { name: '高亮', exact: true }).click()
          await page.waitForFunction(
            (count) => window.highlightWrites.length > count,
            count
          )
          await settleWrites()
        }
        await createHighlight(points.independentStart, points.independentEnd)
        const independent = await page.evaluate(
          () => window.highlightWrites.at(-1)[0]
        )
        assert.deepEqual(endpoints(independent), {
          text: 'ading',
          startPage: 'page-1',
          startOffset: 13,
          endPage: 'page-1',
          endOffset: 18
        })
        await deselect()
        const endpointPoint = (offset, side) => {
          // Reordered glyphs have synthetic DOM spaces between them. An end
          // offset means the right edge of the preceding source character,
          // not the left edge of the next glyph beyond that synthetic space.
          const glyph = points.letters[side === 'end' ? offset - 1 : offset]
          return { x: side === 'end' ? glyph.rightX : glyph.x, y: glyph.y }
        }
        await createHighlight(points.letters[8], endpointPoint(18, 'end'))
        const originalId = await page.evaluate(
          (id) =>
            window.highlightWrites.at(-1).find((item) => item.id !== id).id,
          independent.id
        )
        let currentStart = 8,
          currentEnd = 18
        const initial = await page.evaluate(() => window.highlightWrites.at(-1))
        assert.deepEqual(
          initial.find((item) => item.id === independent.id),
          independent
        )
        assert.deepEqual(
          targetFragments(initial, independent.id).map(endpoints),
          expectedFragments(8, 18, reordered)
        )
        for (let cycle = 0; cycle < 3; cycle++) {
          await deselect()
          const handles = page.locator('[data-pdf-handle-hit-target]')
          const middle =
            points.letters[Math.floor((currentStart + currentEnd) / 2)]
          await page.mouse.click(middle.hitX, middle.y)
          await handles.first().waitFor()
          const box = await page
            .locator(`[data-pdf-handle-hit-target="${side}"]`)
            .boundingBox()
          const targetOffset = (side === 'end' ? [24, 14, 9] : [4, 12, 17])[
            cycle
          ]
          const oldOffset = side === 'end' ? currentEnd : currentStart
          const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          assert.ok(
            await page.evaluate(
              ({ x, y }) =>
                !!document
                  .elementFromPoint(x, y)
                  ?.closest('[data-pdf-handle-hit-target]'),
              grab
            ),
            'the actual handle must receive the gesture (not the floating menu)'
          )
          const touch = (type, point) =>
            cdp.send('Input.dispatchTouchEvent', {
              type,
              touchPoints: point ? [{ id: 1, x: point.x, y: point.y }] : []
            })
          if (input === 'touch') await touch('touchStart', grab)
          else {
            await page.mouse.move(grab.x, grab.y)
            await page.mouse.down()
          }
          let maxPreviews = 0
          for (let step = 0; step < 25; step++) {
            const point = endpointPoint(
              step % 2 === 0 ? targetOffset : oldOffset,
              side
            )
            if (input === 'touch') await touch('touchMove', point)
            else await page.mouse.move(point.x, point.y)
            const previews = await page
              .locator('.hamster-reader__pdf-selection-preview')
              .count()
            maxPreviews = Math.max(maxPreviews, previews)
            assert.ok(previews <= 1, 'reuse a single preview')
          }
          const writesBeforeRelease = await page.evaluate(
            () => window.highlightWrites.length
          )
          if (input === 'touch') await touch('touchEnd')
          else await page.mouse.up()
          await page.evaluate(() => new Promise(requestAnimationFrame))
          // Managed handles commit on release. Wait for the new write before
          // waiting for silence; the last write from the previous gesture may
          // already be old enough to satisfy the silence check.
          if (maxPreviews > 0)
            await page.waitForFunction(
              (count) => window.highlightWrites.length > count,
              writesBeforeRelease
            )
          // The real host serializes sidecar writes through its async bridge.
          // Require a quiet window after a new commit write; this is not a
          // strict host-side queue drain acknowledgement.
          await page.waitForFunction(
            () => performance.now() - window.lastHighlightWriteAt > 300
          )
          const saved = await page.evaluate(() => window.highlightWrites.at(-1))
          if (side === 'end') currentEnd = targetOffset
          else currentStart = targetOffset
          const fragments = targetFragments(saved, independent.id)
          const expected = expectedFragments(
            currentStart,
            currentEnd,
            reordered
          )
          assert.deepEqual(
            saved.find((item) => item.id === independent.id),
            independent,
            'the independent highlight must remain completely unchanged'
          )
          const result = {
            reordered,
            input,
            side,
            cycle,
            expected: expected.length,
            actual: fragments.length,
            fragments: fragments.map(endpoints),
            independent: endpoints(independent),
            maxPreviews,
            uniqueIds: new Set(saved.map((range) => range.id)).size
          }
          report.cases.push(result)
          console.log(JSON.stringify(result))
          assert.equal(
            fragments[0].id,
            originalId,
            'retain logical highlight identity'
          )
          assert.deepEqual(
            result.fragments,
            expected,
            'every fragment must retain its exact source page and canonical endpoints'
          )
          assert.equal(result.actual, result.expected)
          assert.equal(result.uniqueIds, saved.length)
          assert.equal(await handles.count(), 2)
          assert.equal(
            await page
              .locator('.hsn-selection-percent-rect, .hsn-selection-rect')
              .count(),
            saved.length
          )
        }
        assert.deepEqual(errors, [])
      } finally {
        await page.screenshot({ path: `${output}/${name}.png` })
        await writeFile(
          `${output}/${name}-writes.json`,
          JSON.stringify(
            await page.evaluate(() => window.highlightWrites),
            null,
            2
          )
        )
        await page.close()
      }
    }
  }
  console.log(`PASS: ${report.cases.length} WebBase PDF reselection/drag cases`)
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
