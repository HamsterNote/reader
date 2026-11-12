import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
import { createServer } from 'vite'

const output = 'test-results/pdf-text-reselection'
await mkdir(output, { recursive: true })
const server = process.env.READER_BROWSER_URL
  ? null
  : await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser
const report = { browser: '', cases: [] }
const line = 'abcdefghijklmnopqrstuvwxyz'
try {
  await server?.listen()
  const base =
    process.env.READER_BROWSER_URL ??
    `http://127.0.0.1:${server.httpServer.address().port}`
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  browser = await chromium.launch()
  report.browser = browser.version()
  for (const reordered of [false, true]) {
    const pdf = await PDFDocument.create()
    const sheet = pdf.addPage([600, 800])
    if (reordered) {
      for (let i = line.length - 1; i >= 0; i--)
        sheet.drawText(line[i], { x: 20 + i * 12, y: 700, size: 12 })
    } else sheet.drawText(line, { x: 20, y: 700, size: 12 })
    const bytes = Array.from(await pdf.save())
    for (const controlled of [false, true]) {
      for (const input of ['mouse', 'touch']) {
        const page = await browser.newPage({
          viewport: { width: 900, height: 900 },
          hasTouch: true
        })
        page.setDefaultTimeout(15000)
        const cdp = await page.context().newCDPSession(page)
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.route('**/reselection.html', (route) =>
          route.fulfill({ contentType: 'text/html', body: html })
        )
        await page.goto(`${base}/reselection.html`)
        await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
        await page.waitForFunction(() => window.readerRegression)
        await page.evaluate(
          async ({ bytes, controlled }) => {
            window.reselection = { adds: [], snapshots: [] }
            await window.readerRegression.open(
              'pdf',
              bytes,
              {
                renderMode: 'text',
                isPdf: true,
                selectedTool: 'text-selection',
                onSelect: (range) => window.reselection.adds.push(range.id),
                onLinkedDataChange: (data) =>
                  window.reselection.snapshots.push({
                    ids: data.items.map((item) => item.id),
                    texts: data.items.map((item) => item.text),
                    active: data.activeRange?.id,
                    selected: data.selectedRangeId
                  })
              },
              controlled
            )
          },
          { bytes, controlled }
        )
        const text = page.locator('.hsn-selection-content [data-text-id]')
        await text.first().waitFor()
        await page.evaluate(async () => {
          await document.fonts.ready
          await new Promise(requestAnimationFrame)
          await new Promise(requestAnimationFrame)
        })
        const points = await text.first().evaluate((element, reordered) => {
          const at = (offset) => {
            const glyph = reordered
              ? element.parentElement.querySelectorAll('[data-text-id]')[offset]
              : element
            const range = document.createRange()
            range.setStart(glyph.firstChild, reordered ? 0 : offset)
            range.setEnd(glyph.firstChild, reordered ? 1 : offset + 1)
            const rect = range.getBoundingClientRect()
            return { x: rect.left + 0.3, y: rect.top + rect.height / 2 }
          }
          return {
            start: at(8),
            middle: at(13),
            end: at(18),
            targets: [at(24), at(14), at(22)]
          }
        }, reordered)
        // Establish a native draft deterministically; subsequent deselection,
        // reselection and every handle gesture use browser input events.
        await text.first().evaluate((element, reordered) => {
          const glyphs =
            element.parentElement.querySelectorAll('[data-text-id]')
          const range = document.createRange()
          range.setStart(
            reordered ? glyphs[8].firstChild : element.firstChild,
            reordered ? 0 : 8
          )
          range.setEnd(
            reordered ? glyphs[17].firstChild : element.firstChild,
            reordered ? 1 : 18
          )
          getSelection().removeAllRanges()
          getSelection().addRange(range)
          document.dispatchEvent(new Event('selectionchange'))
        }, reordered)
        const handles = page.locator('.hamster-reader__engine-handle')
        await handles.first().waitFor()
        await page.evaluate(() =>
          window.readerRegression.selection.current.confirm()
        )
        await page.waitForFunction(() => window.reselection.adds.length > 0)
        const additions = await page.evaluate(() => window.reselection.adds)
        for (let cycle = 0; cycle < 3; cycle++) {
          await page.mouse.click(700, 500)
          await page.waitForFunction(
            () => !document.querySelector('.hamster-reader__engine-handle')
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
          const savedCount = await page.evaluate(
            () => window.reselection.snapshots.at(-1).ids.length
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
          for (let step = 0; step < 25; step++) {
            const target = step % 2 === 0 ? points.targets[cycle] : points.end
            if (input === 'touch') await touch('touchMove', target)
            else await page.mouse.move(target.x, target.y)
            const during = await page.evaluate(() => ({
              saved: window.reselection.snapshots.at(-1).ids.length,
              previews: document.querySelectorAll(
                '.hamster-reader__pdf-selection-preview'
              ).length,
              handles: document.querySelectorAll(
                '.hamster-reader__engine-handle'
              ).length
            }))
            assert.equal(
              during.saved,
              savedCount,
              'dragging must not append saved annotations'
            )
            assert.equal(during.previews, 1, 'dragging must reuse one preview')
            assert.equal(
              during.handles,
              2,
              'dragging must reuse one handle pair'
            )
          }
          if (input === 'touch') await touch('touchEnd')
          else await page.mouse.up()
          await page.evaluate(() => new Promise(requestAnimationFrame))
          const after = await page.evaluate(() => ({
            adds: window.reselection.adds,
            last: window.reselection.snapshots.at(-1),
            overlays: document.querySelectorAll(
              '.hsn-selection-percent-rect, .hsn-selection-rect'
            ).length
          }))
          const end = [24, 14, 22][cycle]
          assert.deepEqual(
            after.adds,
            additions,
            'reselection must not create annotations'
          )
          assert.equal(
            after.last.texts.join(''),
            line.slice(8, end),
            'retire old range fragments on shrink'
          )
          assert.equal(after.last.ids.length, reordered ? end - 8 : 1)
          assert.equal(new Set(after.last.ids).size, after.last.ids.length)
          assert.equal(
            after.last.ids[0],
            additions[0],
            'keep the original highlight identity'
          )
          assert.equal(
            after.overlays,
            after.last.ids.length,
            'no residual highlight overlays'
          )
          assert.equal(await handles.count(), 2)
          const result = {
            reordered,
            controlled,
            input,
            cycle,
            annotations: after.last.ids.length,
            previewsDuringDrag: 1,
            handlePairs: 1,
            newHighlights: 0
          }
          report.cases.push(result)
          console.log(JSON.stringify(result))
        }
        assert.deepEqual(errors, [])
        await page.close()
      }
    }
  }
  console.log(`PASS: ${report.cases.length} PDF text reselection/drag cases`)
} finally {
  await writeFile(`${output}/chromium.json`, JSON.stringify(report, null, 2))
  await browser?.close()
  await server?.close()
}
