import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'

const base = process.env.WEBBASE_BROWSER_URL ?? 'http://127.0.0.1:6229/?demo=1'
const output = process.env.WEBBASE_TEST_OUTPUT ?? 'test-results/webbase-draft'
await mkdir(output, { recursive: true })
const alphabet = 'abcdefghijklmnopqrstuvwxyz'
const reordered = process.env.REORDERED === '1'
const headings = ['Heading one', 'Heading two']
const pdf = await PDFDocument.create()
const sheet = pdf.addPage([600, 800])
headings.forEach((line, i) =>
  sheet.drawText(line, { x: 40, y: 760 - i * 30, size: 12 })
)
if (reordered) {
  for (let i = 25; i >= 0; i--)
    sheet.drawText(alphabet[i], { x: 40 + i * 12, y: 700, size: 12 })
} else sheet.drawText(alphabet, { x: 40, y: 700, size: 12 })
const bytes = Buffer.from(await pdf.save())
await writeFile(`${output}/draft.pdf`, bytes)
const browser = await chromium.launch()
const report = { browser: browser.version(), url: base, reordered, cases: [] }
try {
  for (const input of ['mouse', 'touch'])
    for (const firstSide of ['end', 'start']) {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 950 },
        hasTouch: true
      })
      page.setDefaultTimeout(20000)
      const cdp = await page.context().newCDPSession(page)
      const label = `${input}-${firstSide}`
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
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
              /* Ignore bridge payloads that are not document JSON. */
            }
            send(text)
          }
        })
        await page
          .locator('.browser-demo__controls input[type=file]')
          .setInputFiles({
            name: 'draft.pdf',
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
        const points = await text.evaluate(
          (element, reordered) =>
            Array.from({ length: 26 }, (_, offset) => {
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
                right: rect.right - 0.2,
                middle: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2
              }
            }),
          reordered
        )
        const pointAt = (offset, side) => {
          const glyph = points[side === 'end' ? offset - 1 : offset]
          return { x: side === 'end' ? glyph.right : glyph.x, y: glyph.y }
        }
        await page.mouse.move(points[8].x, points[8].y)
        await page.mouse.down()
        const initialEnd = pointAt(18, 'end')
        await page.mouse.move(initialEnd.x, initialEnd.y, { steps: 6 })
        await page.mouse.up()
        const handles = page.locator('[data-pdf-handle-hit-target]')
        await handles.first().waitFor()
        let start = 8,
          end = 18
        const sides = firstSide === 'end' ? ['end', 'start'] : ['start', 'end']
        for (const side of sides)
          for (const target of side === 'end'
            ? [24, 14, reordered ? 13 : 22]
            : [4, 10, 12]) {
            const box = await page
              .locator(`[data-pdf-handle-hit-target="${side}"]`)
              .boundingBox()
            const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            assert.ok(
              await page.evaluate(
                ({ x, y }) =>
                  !!document
                    .elementFromPoint(x, y)
                    ?.closest('[data-pdf-handle-hit-target]'),
                grab
              ),
              'gesture must hit the handle'
            )
            const touch = (type, point) =>
              cdp.send('Input.dispatchTouchEvent', {
                type,
                touchPoints: point ? [{ id: 1, x: point.x, y: point.y }] : []
              })
            const originalOffset = side === 'end' ? end : start
            if (input === 'touch') await touch('touchStart', grab)
            else {
              await page.mouse.move(grab.x, grab.y)
              await page.mouse.down()
            }
            for (let frame = 0; frame < 25; frame++) {
              const point = pointAt(
                frame % 2 === 0 ? target : originalOffset,
                side
              )
              if (input === 'touch') await touch('touchMove', point)
              else await page.mouse.move(point.x, point.y)
              assert.equal(await handles.count(), 2)
              assert.equal(
                await page
                  .locator('.hamster-reader__pdf-selection-preview')
                  .count(),
                1
              )
              assert.ok(
                await page.evaluate(() =>
                  window.highlightWrites.every((ranges) => ranges.length === 0)
                ),
                'draft motion must not persist intermediate ranges'
              )
            }
            if (input === 'touch') await touch('touchEnd')
            else await page.mouse.up()
            await page.evaluate(() => new Promise(requestAnimationFrame))
            if (side === 'end') end = target
            else start = target
            console.log(
              JSON.stringify({
                input,
                firstSide,
                side,
                start,
                end,
                persisted: await page.evaluate(
                  () => window.highlightWrites.at(-1)?.length ?? 0
                )
              })
            )
            assert.equal(await handles.count(), 2)
            assert.ok(
              await page.evaluate(() =>
                window.highlightWrites.every((ranges) => ranges.length === 0)
              ),
              'releasing an unconfirmed draft must not create annotations'
            )
          }
        const before = await page.evaluate(() => window.highlightWrites.length)
        const confirm = page.getByRole('button', { name: '高亮', exact: true })
        if (input === 'touch') await confirm.tap()
        else await confirm.click()
        await page.waitForFunction(
          (count) => window.highlightWrites.length > count,
          before
        )
        await page.waitForFunction(
          () => performance.now() - window.lastHighlightWriteAt > 300
        )
        const saved = await page.evaluate(() => window.highlightWrites.at(-1))
        console.log('commit', JSON.stringify(saved))
        assert.equal(saved.length, 1, 'confirm only the final draft range')
        const project = (range) => ({
          text: range.text,
          start: range.start,
          end: range.end
        })
        const expected = {
          text: alphabet.slice(start, end),
          start: {
            selectionId: 'page-1',
            offset: headings.join('').length + (reordered ? 25 - start : start)
          },
          end: {
            selectionId: 'page-1',
            offset: headings.join('').length + (reordered ? 26 - start : end)
          }
        }
        assert.deepEqual(project(saved[0]), expected)
        const viewer = await page
          .getByTestId('intermediate-document-text-viewer')
          .boundingBox()
        if (input === 'touch')
          await page.touchscreen.tap(
            viewer.x + viewer.width / 2,
            viewer.y + viewer.height - 80
          )
        else
          await page.mouse.click(
            viewer.x + viewer.width / 2,
            viewer.y + viewer.height - 80
          )
        await page.waitForFunction(
          () => !document.querySelector('[data-pdf-handle-hit-target]')
        )
        const middle = points[Math.floor((start + end) / 2)]
        if (input === 'touch')
          await page.touchscreen.tap(middle.middle, middle.y)
        else await page.mouse.click(middle.middle, middle.y)
        await handles.first().waitFor()
        const after = await page.evaluate(() => window.highlightWrites.at(-1))
        assert.deepEqual(
          after,
          saved,
          'reselecting must not materialize intermediate drafts'
        )
        assert.equal(await handles.count(), 2)
        assert.equal(
          await page
            .locator('.hsn-selection-percent-rect, .hsn-selection-rect')
            .count(),
          1
        )
        assert.equal(
          await page.locator('.hamster-reader__pdf-selection-preview').count(),
          1
        )
        assert.deepEqual(errors, [])
        const result = {
          input,
          firstSide,
          gestures: 6,
          movesPerGesture: 25,
          persisted: saved.length,
          ...expected,
          overlays: 1
        }
        report.cases.push(result)
        console.log(JSON.stringify(result))
      } finally {
        await page.screenshot({ path: `${output}/${label}.png` })
        await writeFile(
          `${output}/${label}-writes.json`,
          JSON.stringify(
            await page.evaluate(() => window.highlightWrites),
            null,
            2
          )
        )
        await page.close()
      }
    }
  console.log(
    `PASS: ${report.cases.length} WebBase PDF draft drag/confirm/reselect cases`
  )
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
