import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const output = 'test-results/pdf-text-cross-page'
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
const report = { browser: '', cases: [] }
let browser
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/pdf-text-cross-page.tsx'
  )
  browser = await chromium.launch()
  report.browser = browser.version()
  for (const spaced of [false, true]) {
    for (const controlled of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 900, height: 900 }
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/cross-page.html*', (route) =>
        route.fulfill({ contentType: 'text/html', body: html })
      )
      await page.goto(
        `${base}/cross-page.html?${spaced ? 'spaced&' : ''}${controlled ? 'controlled' : ''}`
      )
      await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
      const handle = page.getByRole('button', { name: '调整高亮终点' })
      await handle.waitFor()
      assert.equal(
        await page.getByRole('button', { name: '调整高亮起点' }).count(),
        0
      )
      assert.equal(
        await page.getByTestId('intermediate-text-page-1').count(),
        0
      )
      const anchors = await page
        .locator('[data-selection-start-offset]')
        .evaluateAll((elements) =>
          elements.map((element) =>
            Number(element.dataset.selectionStartOffset)
          )
        )
      assert.deepEqual(anchors, spaced ? [0, 14] : [0])
      // Use real Chromium caret hit testing. The final character is excluded;
      // DOM end 6 maps to canonical 6 or 16 depending on source whitespace.
      const target = await page
        .locator('[data-selection-start-offset]')
        .last()
        .evaluate(
          (element, offset) => {
            const range = document.createRange()
            range.setStart(element.firstChild, offset)
            range.setEnd(element.firstChild, offset + 1)
            const box = range.getBoundingClientRect()
            return { x: box.left + 0.2, y: box.top + box.height / 2 }
          },
          spaced ? 2 : 6
        )
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(target.x, target.y, { steps: 5 })
      await page.mouse.up()
      await page.waitForFunction(
        (expected) =>
          window.crossPageSnapshots.at(-1)?.items[0]?.end.offset === expected,
        spaced ? 16 : 6
      )
      assert.equal(
        await page.evaluate(() =>
          window.crossPageSnapshots.every((snapshot) =>
            snapshot.items.some((item) => item.id === 'saved')
          )
        ),
        true,
        'no snapshot may delete the highlight'
      )
      const snapshot = await page.evaluate(() =>
        window.crossPageSnapshots.at(-1)
      )
      assert.equal(
        snapshot.items.length,
        1,
        'edit must not delete the saved highlight'
      )
      const item = snapshot.items[0]
      assert.equal(item.id, 'saved')
      assert.deepEqual(item.selectionGroup, { id: 'logical', index: 0 })
      assert.deepEqual(item.start, { selectionId: 'page-1', offset: 0 })
      assert.deepEqual(item.end, {
        selectionId: 'page-2',
        offset: spaced ? 16 : 6
      })
      assert.equal(item.text, spaced ? 'previousabc de' : 'previousabcdef')
      await handle.waitFor()
      assert.deepEqual(errors, [])
      const result = {
        spaced,
        controlled,
        start: item.start,
        end: item.end,
        items: snapshot.items.length
      }
      report.cases.push(result)
      console.log(JSON.stringify(result))
      await page.close()
    }
  }
  console.log(`PASS: ${report.cases.length} PDF cross-page edit/snapshot cases`)
} finally {
  await writeFile(`${output}/chromium.json`, JSON.stringify(report, null, 2))
  await browser?.close()
  await server.close()
}
