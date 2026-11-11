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
try {
  for (const reordered of [false, true]) {
    const pdf = await PDFDocument.create()
    const sheet = pdf.addPage([600, 800])
    sheet.drawText('Heading one', { x: 40, y: 760, size: 12 })
    sheet.drawText('Heading two', { x: 40, y: 730, size: 12 })
    if (reordered) {
      for (let i = alphabet.length - 1; i >= 0; i--)
        sheet.drawText(alphabet[i], { x: 40 + i * 12, y: 700, size: 12 })
    } else sheet.drawText(alphabet, { x: 40, y: 700, size: 12 })
    const bytes = Buffer.from(await pdf.save())
    await writeFile(
      `${output}/${reordered ? 'reordered' : 'normal'}.pdf`,
      bytes
    )
    for (const input of ['mouse', 'touch']) {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 950 },
        hasTouch: true
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.setDefaultTimeout(20000)
      const cdp = await page.context().newCDPSession(page)
      const name = `${reordered ? 'reordered' : 'normal'}-${input}`
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
            return { x: rect.x + 0.2, y: rect.y + rect.height / 2 }
          }
          return {
            start: at(8),
            middle: at(11),
            end: at(18),
            targets: [at(24), at(14), at(22)]
          }
        }, reordered)
        await page.mouse.move(points.start.x, points.start.y)
        await page.mouse.down()
        await page.mouse.move(points.end.x, points.end.y, { steps: 6 })
        await page.mouse.up()
        await page.getByRole('button', { name: '高亮', exact: true }).click()
        await page.waitForFunction(() => window.highlightWrites.at(-1)?.length)
        await page.waitForFunction(
          () => performance.now() - window.lastHighlightWriteAt > 300
        )
        const originalId = await page.evaluate(
          () => window.highlightWrites.at(-1)[0].id
        )
        for (let cycle = 0; cycle < 3; cycle++) {
          const viewer = await page
            .getByTestId('intermediate-document-text-viewer')
            .boundingBox()
          await page.mouse.click(
            viewer.x + viewer.width / 2,
            viewer.y + viewer.height - 80
          )
          const handles = page.locator('[data-pdf-handle-hit-target]')
          await page.waitForFunction(
            () => !document.querySelector('[data-pdf-handle-hit-target]')
          )
          assert.equal(
            await page
              .locator('.hamster-reader__pdf-selection-preview')
              .count(),
            0
          )
          await page.mouse.click(points.middle.x, points.middle.y)
          await handles.first().waitFor()
          const box = await handles.last().boundingBox()
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
              touchPoints: point ? [{ id: 1, ...point }] : []
            })
          if (input === 'touch') await touch('touchStart', grab)
          else {
            await page.mouse.move(grab.x, grab.y)
            await page.mouse.down()
          }
          let maxPreviews = 0
          for (let step = 0; step < 25; step++) {
            const point = step % 2 === 0 ? points.targets[cycle] : points.end
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
          // Read only after that queue has settled, not after the first write.
          await page.waitForFunction(
            () => performance.now() - window.lastHighlightWriteAt > 300
          )
          const saved = await page.evaluate(() => window.highlightWrites.at(-1))
          const end = [24, 14, 22][cycle]
          const result = {
            reordered,
            input,
            cycle,
            expected: reordered ? end - 8 : 1,
            actual: saved.length,
            text: saved.map((range) => range.text).join(''),
            maxPreviews,
            uniqueIds: new Set(saved.map((range) => range.id)).size
          }
          report.cases.push(result)
          console.log(JSON.stringify(result))
          assert.equal(
            saved[0].id,
            originalId,
            'retain logical highlight identity'
          )
          assert.equal(
            result.text,
            alphabet.slice(8, end),
            'remove retired fragments after shrink'
          )
          assert.equal(result.actual, result.expected)
          assert.equal(result.uniqueIds, result.actual)
          assert.equal(await handles.count(), 2)
          assert.equal(
            await page
              .locator('.hsn-selection-percent-rect, .hsn-selection-rect')
              .count(),
            result.actual
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
