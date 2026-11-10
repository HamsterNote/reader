import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
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
    const offset = await handle.evaluate(
      (handle, origin) => ({
        x: Number(handle.dataset.pdfTextTargetX) - origin.x,
        y: Number(handle.dataset.pdfTextTargetY) - origin.y
      }),
      origin
    )
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
          placement: lens.dataset.placement,
          root: lens.parentElement.getBoundingClientRect().toJSON()
        }
      })
      // Compare against the 17c3542 layout contract, independently of sampling.
      const { root } = geometry
      const anchor = {
        x: point.x + offset.x - root.x,
        y: point.y + offset.y - root.y
      }
      const above = anchor.y - 138
      const desiredTop = above >= 8 ? above : anchor.y + 18
      const expectedLeft = Math.min(
        Math.max(anchor.x - 60, 8),
        Math.max(8, root.width - 128)
      )
      const expectedTop = Math.min(
        Math.max(desiredTop, 8),
        Math.max(8, root.height - 128)
      )
      assert.ok(
        Math.abs(geometry.center.x - (root.x + expectedLeft + 60)) < 0.1
      )
      assert.ok(Math.abs(geometry.center.y - (root.y + expectedTop + 60)) < 0.1)
      assert.equal(geometry.placement, above >= 8 ? 'above' : 'below')
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
      results.push({
        mode: 'Text',
        side,
        point,
        lensCenter: geometry.center,
        sampleOffset: {
          x: (sample.x / sample.width) * source.width - (point.x - source.x),
          y: (sample.y / sample.height) * source.height - (point.y - source.y)
        }
      })
    }
    if (side === 'end') {
      for (const delta of [200, 220]) {
        const point = { x: origin.x, y: origin.y + delta }
        await page.mouse.move(point.x, point.y)
        const box = await lens.boundingBox()
        results.push({
          mode: 'Text clearance',
          point,
          bottomGap: point.y - box.y - box.height,
          offset
        })
      }
    }
    await page.mouse.up()
    await lens.waitFor({ state: 'hidden' })
    await page.evaluate(() => {
      window.magnifierSample = null
    })
  }
  // Reference: the actual desktop PDF preview renderer and its mouse handles.
  const previewHtml = await server.transformIndexHtml(
    '/preview.html',
    '<html><body style="margin:0"><div id="root"></div><script type="module" src="/test/browser/review-regressions.tsx"></script></body></html>'
  )
  await page.route('**/preview.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: previewHtml })
  )
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/preview.html`
  )
  await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
  await page.waitForFunction(() => window.readerRegression)
  const pdf = await PDFDocument.create()
  const sheet = pdf.addPage([400, 600])
  sheet.drawText('Alpha beta gamma delta', { x: 50, y: 400, size: 16 })
  await page.evaluate(
    (bytes) => window.readerRegression.open('pdf', bytes, { isPdf: true }),
    [...(await pdf.save())]
  )
  await page
    .locator('.textLayer [data-selection-start-offset]')
    .first()
    .waitFor()
  await page.evaluate(() =>
    window.readerRegression.selection.current.scrollToPosition({
      x: 0,
      y: 0,
      scale: 0.5
    })
  )
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="tool-bottom-bar-layout-zoom"]')
        ?.textContent === '50%'
  )
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done))
    )
  })
  const selectionBox = await page.evaluate(() => {
    const text = document.querySelector(
      '.textLayer [data-selection-start-offset]'
    )
    const range = document.createRange()
    range.setStart(text.firstChild, 0)
    range.setEnd(text.firstChild, 10)
    const rect = range.getBoundingClientRect()
    window.magnifierSample = null
    return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }
  })
  if (
    (await page
      .getByTestId('tool-bottom-bar-text-selection')
      .getAttribute('aria-pressed')) !== 'true'
  )
    await page.getByTestId('tool-bottom-bar-text-selection').click()
  await page.mouse.move(selectionBox.left + 1, selectionBox.y)
  await page.mouse.down()
  await page.mouse.move(selectionBox.right - 1, selectionBox.y, { steps: 8 })
  await page.mouse.up()
  await page.locator('button[data-pdf-handle-hit-target="end"]').waitFor()
  const grab = await page.evaluate(() => {
    const rect = getSelection().getRangeAt(0).getBoundingClientRect()
    return { x: rect.right, y: rect.top + rect.height / 2 }
  })
  // Grab at the line center inside the hit square: no intentional grab offset.
  assert.ok(
    await page.evaluate(
      (point) =>
        !!document
          .elementFromPoint(point.x, point.y)
          ?.closest('button[data-pdf-handle-hit-target="end"]'),
      grab
    ),
    'reference grab must hit the PDF handle'
  )
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await lens.waitFor({ state: 'visible' })
  for (const delta of [1, 11, 21]) {
    const point = { x: grab.x + delta, y: grab.y }
    await page.mouse.move(point.x, point.y)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    )
    await page.waitForFunction(() => !!window.magnifierSample)
    const sampleOffset = await page.evaluate((point) => {
      const rect = document
        .querySelector('.pdfViewer .page')
        .getBoundingClientRect()
      const sample = window.magnifierSample
      return {
        x: (sample.x / sample.width) * rect.width + rect.x - point.x,
        y: (sample.y / sample.height) * rect.height + rect.y - point.y
      }
    }, point)
    assert.ok(Math.abs(sampleOffset.x) < 0.1, JSON.stringify(sampleOffset))
    assert.ok(Math.abs(sampleOffset.y) < 0.1, JSON.stringify(sampleOffset))
    results.push({ mode: 'PDF preview', point, sampleOffset })
  }
  await page.mouse.up()
  await lens.waitFor({ state: 'hidden' })
  const handleBox = await page
    .locator('button[data-pdf-handle-hit-target="end"]')
    .boundingBox()
  const corner = {
    x: handleBox.x + handleBox.width / 2 + 9,
    y: handleBox.y + handleBox.height / 2 + 9
  }
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  for (const delta of [200, 220]) {
    const point = { x: corner.x, y: corner.y + delta }
    await page.mouse.move(point.x, point.y)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    )
    const box = await lens.boundingBox()
    results.push({
      mode: 'PDF clearance',
      point,
      bottomGap: point.y - box.y - box.height
    })
  }
  // Exercise the preview's own edge rules with the lifted anchor.
  const rootBox = await page
    .locator('.hamster-reader__engine-viewer')
    .boundingBox()
  for (const side of ['left', 'right']) {
    const point = {
      x: side === 'left' ? rootBox.x + 1 : rootBox.x + rootBox.width - 1,
      y: rootBox.y + 40
    }
    await page.mouse.move(point.x, point.y)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    )
    const box = await lens.boundingBox()
    const edge =
      side === 'left'
        ? box.x - rootBox.x
        : rootBox.x + rootBox.width - box.x - box.width
    assert.ok(Math.abs(edge - 8) < 0.1, JSON.stringify({ side, box, rootBox }))
    assert.equal(await lens.getAttribute('data-placement'), 'below')
    results.push({ mode: 'PDF edge', side, point, box, placement: 'below' })
  }
  await page.mouse.up()
  await lens.waitFor({ state: 'hidden' })
  const textClearance = results.filter(
    (result) => result.mode === 'Text clearance'
  )
  const pdfClearance = results.filter(
    (result) => result.mode === 'PDF clearance'
  )
  for (let index = 0; index < textClearance.length; index++)
    assert.ok(
      Math.abs(textClearance[index].bottomGap - pdfClearance[index].bottomGap) <
        1,
      JSON.stringify({ text: textClearance[index], pdf: pdfClearance[index] })
    )
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ platform: 'Chromium mouse', results }, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
