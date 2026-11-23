import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Simulates a host header bar painted over the reader's top edge, like the
// WebBase/native shell: the bar covers `inset` px and containMarginTop matches it.
const inset = Math.max(0, Number(process.env.READER_POPOVER_INSET) || 90)
const output = resolve('test-results/popover-top-inset')
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser
let page
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/demo/selection-harness.html?inset=${inset}`)
  await page
    .getByLabel('Book', { exact: true })
    .setInputFiles(resolve('test/compat/fixtures/pdf/two-column.pdf'))
  await page.locator('.textLayer span').first().waitFor()
  // After upload the viewer may or may not scroll the page under the host bar,
  // so the first line's initial position is nondeterministic. Drive the scroller
  // until the first line sits just under the bar, which is the band where an
  // unclamped above-the-selection popover lands under host chrome.
  const target = inset + 10
  const samples = []
  let stable = 0
  const deadline = Date.now() + 15000
  const nextFrames = () =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    )
  while (Date.now() < deadline && stable < 2) {
    const sample = await page.evaluate(() => {
      const scroller = document.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      const span = document.querySelector('.textLayer span')
      if (!span) return null
      return {
        top: span.getBoundingClientRect().top,
        scrollTop: scroller?.scrollTop ?? null
      }
    })
    if (sample) {
      samples.push(sample)
      const delta = sample.top - target
      stable = Math.abs(delta) <= 2 ? stable + 1 : 0
      if (stable < 2 && Math.abs(delta) > 2) {
        await page.evaluate((value) => {
          const scroller = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          if (scroller) scroller.scrollTop += value
        }, delta)
      }
    } else {
      stable = 0
    }
    await nextFrames()
  }
  assert(
    stable >= 2,
    `first text line must settle at ${target}px: ${JSON.stringify(samples.slice(-6))}`
  )
  const point = await page.evaluate(() => {
    const span = document.querySelector('.textLayer span')
    const node = span.firstChild
    const word = node.textContent.match(/\w{4}/)
    const range = document.createRange()
    range.setStart(node, word.index + 1)
    range.setEnd(node, word.index + 2)
    const box = range.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 40, point.y, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('toolbar', { name: '选区操作' }).waitFor()
  const measured = await page.evaluate(() => {
    const rect = (value) => {
      const box = value.getBoundingClientRect()
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        height: box.height
      }
    }
    return {
      bar: rect(document.querySelector('[data-testid=host-top-bar]')),
      popup: rect(document.querySelector('.hamster-reader__engine-popover')),
      selection: rect(getSelection().getRangeAt(0)),
      viewportHeight: innerHeight
    }
  })
  await page.screenshot({
    path: resolve(output, `popover-top-inset-${inset}.png`)
  })
  assert(measured.bar, 'host top bar must be rendered')
  assert.equal(Math.round(measured.bar.height), inset)
  assert(
    measured.popup.top >= measured.bar.bottom - 0.5,
    `toolbar must sit below the host bar: ${JSON.stringify(measured)}`
  )
  assert(
    measured.popup.bottom <= measured.viewportHeight + 0.5,
    `toolbar must stay inside the viewport: ${JSON.stringify(measured)}`
  )
  assert(
    measured.selection.top - measured.popup.height < measured.bar.bottom,
    `fixture must select a line with no room above the bar: ${JSON.stringify(measured)}`
  )
  assert(
    measured.popup.top >= measured.selection.bottom - 0.5,
    `no room above, so the toolbar flips below the selection: ${JSON.stringify(measured)}`
  )
  assert.deepEqual(errors, [])
  console.log(
    `Popover clears a ${inset}px host bar and flips below a first line at ${measured.selection.top.toFixed(1)}px`
  )
  console.log(JSON.stringify(measured))
} finally {
  await page?.close()
  await browser?.close()
  await server.close()
}
