import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

// Real PDF Text viewer, selection dependency, layout, capture and mouse input.
const server = await createServer({
  root: resolve(import.meta.dirname, '..'),
  server: { host: '127.0.0.1', port: 0 }
})
let browser
try {
  await server.listen()
  const html = await server.transformIndexHtml(
    '/magnifier.html',
    '<html><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/pdf-text-handles-harness.jsx"></script></body></html>'
  )
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 718 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.closest('.hamster-reader__range-magnifier')) {
        window.magnifierSample = {
          x: args[1] + args[3] / 2,
          y: args[2] + args[4] / 2,
          width: args[0].width,
          height: args[0].height
        }
      }
      return original.apply(this, args)
    }
  })
  await page.route('**/magnifier.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/magnifier.html`
  )
  await page.locator('[data-pdf-handle-hit-target="end"]').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const results = []
  const lens = page.getByTestId('range-magnifier')
  for (const side of ['start', 'end']) {
    const handle = page.locator(`[data-pdf-handle-hit-target="${side}"]`)
    const box = await handle.boundingBox()
    const origin = {
      x: box.x + box.width / 2 + 9,
      y: box.y + box.height / 2 + 9
    }
    await page.mouse.move(origin.x, origin.y)
    await page.mouse.down()
    await lens.waitFor({ state: 'visible' })
    for (const delta of [0, 18, 36]) {
      const point = { x: origin.x + delta, y: origin.y + delta }
      await page.mouse.move(point.x, point.y)
      await page.waitForFunction(() => !!window.magnifierSample)
      const geometry = await page.evaluate(() => {
        const lens = document.querySelector('[data-testid="range-magnifier"]')
        const rect = lens.getBoundingClientRect()
        const source = document
          .querySelector('.hamster-reader__intermediate-text-page')
          .getBoundingClientRect()
        const canvas = lens.querySelector('canvas').getBoundingClientRect()
        const marker = lens
          .querySelector('[data-caret="true"]')
          .getBoundingClientRect()
        return {
          center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
          source: source.toJSON(),
          sample: window.magnifierSample,
          canvas: canvas.toJSON(),
          marker: {
            x: marker.x + marker.width / 2,
            y: marker.y + marker.height / 2
          },
          placement: lens.dataset.placement
        }
      })
      assert.ok(
        Math.abs(geometry.center.x - point.x) < 0.1,
        JSON.stringify(geometry)
      )
      assert.ok(
        Math.abs(geometry.center.y - point.y) < 0.1,
        JSON.stringify(geometry)
      )
      assert.equal(geometry.placement, 'center')
      // Sample centers follow the pointer, subject only to snapshot crop bounds.
      const { source, sample } = geometry
      const expectedX = Math.min(
        Math.max(point.x - source.x, 30),
        source.width - 30
      )
      const expectedY = Math.min(
        Math.max(point.y - source.y, 30),
        source.height - 30
      )
      assert.ok(
        Math.abs((sample.x / sample.width) * source.width - expectedX) < 0.1
      )
      assert.ok(
        Math.abs((sample.y / sample.height) * source.height - expectedY) < 0.1
      )
      const markerX =
        geometry.canvas.x +
        ((point.x - source.x - expectedX + 30) / 60) * geometry.canvas.width
      const markerY =
        geometry.canvas.y +
        ((point.y - source.y - expectedY + 30) / 60) * geometry.canvas.height
      assert.ok(
        Math.abs(geometry.marker.x - markerX) < 0.1,
        JSON.stringify(geometry)
      )
      assert.ok(
        Math.abs(geometry.marker.y - markerY) < 0.1,
        JSON.stringify(geometry)
      )
      results.push({ side, point, center: geometry.center })
    }
    await page.mouse.up()
    await lens.waitFor({ state: 'hidden' })
    await page.evaluate(() => {
      window.magnifierSample = null
    })
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ platform: 'Chromium mouse', results }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
