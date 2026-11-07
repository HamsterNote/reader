import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { webkit } from 'playwright'
import { createServer } from 'vite'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham182-webkit')
const server = await createServer({
  root: repo,
  server: { host: '127.0.0.1', port: 0 }
})
const report = {
  platform:
    'Linux Playwright WebKit; synthetic touch PointerEvents, not iOS WKWebView',
  cases: [],
  gestures: []
}
let browser
try {
  await mkdir(output, { recursive: true })
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = await server.transformIndexHtml(
    '/handles.html',
    '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/pdf-text-handles-harness.jsx"></script></body></html>'
  )
  browser = await webkit.launch({
    headless: true,
    executablePath: process.env.WEBKIT_EXECUTABLE_PATH
  })
  const page = await browser.newPage({
    viewport: { width: 402, height: 874 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/handles.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/handles.html`)
  await page.locator('[data-text-id="end"]').waitFor()
  const settle = () =>
    page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
    })
  const measure = (endTrim = 0) =>
    page.evaluate((endTrim) => {
      const rectFor = (id, end) => {
        const node = document.querySelector(`[data-text-id="${id}"]`).firstChild
        const range = document.createRange()
        const offset = end ? node.length - 1 - endTrim : 0
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        return range.getBoundingClientRect().toJSON()
      }
      const endpoints = [rectFor('start', false), rectFor('end', true)]
      const handles = ['start', 'end'].map((side) => {
        const button = document.querySelector(
          `[data-pdf-handle-hit-target="${side}"]`
        )
        if (!button) return null
        const rect = button.getBoundingClientRect()
        const line = button.querySelector(
          '[data-pdf-handle-visual]'
        )?.firstElementChild
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          lineHeight: line?.getBoundingClientRect().height
        }
      })
      return {
        endpoints,
        handles,
        fontScale: window.pdfTextHandles.fontScale,
        fontSize: getComputedStyle(
          document.querySelector('[data-text-id="start"]')
        ).fontSize,
        viewport: { width: innerWidth, height: innerHeight },
        range: window.pdfTextHandles.ranges[0],
        errors: handles.map((point, index) =>
          point
            ? {
                x:
                  point.x -
                  (index ? endpoints[index].right : endpoints[index].left),
                y:
                  point.y -
                  (index
                    ? endpoints[index].bottom + 10
                    : endpoints[index].top - 10),
                line: point.lineHeight - endpoints[index].height
              }
            : null
        )
      }
    }, endTrim)
  await settle()
  await page
    .locator('[data-pdf-handle-hit-target="start"]')
    .waitFor({ timeout: 5000 })
  for (const unit of ['percent', 'px']) {
    await page.evaluate(
      (unit) => window.pdfTextHandles.setOverlayRectType(unit),
      unit
    )
    for (const width of [402, 320, 740]) {
      await page.setViewportSize({ width, height: 874 })
      for (const scale of [1.5, 1, 1.5]) {
        await page.evaluate(
          (scale) => window.pdfTextHandles.setFontScale(scale),
          scale
        )
        await settle()
        const result = { unit, ...(await measure()) }
        report.cases.push(result)
        await writeFile(
          resolve(output, 'report.json'),
          JSON.stringify(report, null, 2)
        )
        if (report.cases.length === 1)
          await page.screenshot({ path: resolve(output, 'handles.png') })
        for (const error of result.errors) {
          assert.ok(error, 'Both selected source endpoints should be visible')
          assert.ok(
            Math.abs(error.x) < 1 &&
              Math.abs(error.y) < 1 &&
              Math.abs(error.line) < 1,
            JSON.stringify(result)
          )
        }
      }
    }
  }
  await page.evaluate(() => window.pdfTextHandles.reopen())
  await page.locator('[data-text-id="end"]').waitFor()
  await settle()
  await page
    .locator('[data-pdf-handle-hit-target="start"]')
    .waitFor({ timeout: 5000 })
  const restored = { reopened: true, ...(await measure()) }
  report.cases.push(restored)
  for (const error of restored.errors)
    assert.ok(
      error &&
        Math.abs(error.x) < 1 &&
        Math.abs(error.y) < 1 &&
        Math.abs(error.line) < 1
    )
  // Send touch pointer events through the real viewer/library. WebKit supplies
  // the actual reflow/caret geometry; this does not emulate UIKit gestures.
  await page.setViewportSize({ width: 402, height: 874 })
  await settle()
  const beforeDrag = await measure()
  await page.evaluate(() => {
    const node = document.querySelector('[data-text-id="end"]').firstChild
    const rectAt = (offset) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      return range.getBoundingClientRect()
    }
    const current = rectAt(node.length - 1)
    const target = rectAt(node.length - 3)
    const button = document.querySelector('[data-pdf-handle-hit-target="end"]')
    const hit = button.getBoundingClientRect()
    const grab = { x: hit.x + hit.width / 2 + 9, y: hit.y + hit.height / 2 + 9 }
    const release = {
      x: target.right - 0.5 + grab.x - current.right,
      y:
        target.top +
        target.height / 2 +
        grab.y -
        (current.top + current.height / 2)
    }
    const send = (element, type, point) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: 'touch',
          isPrimary: true,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: point.x,
          clientY: point.y
        })
      )
    send(button, 'pointerdown', grab)
    send(document, 'pointermove', release)
    send(document, 'pointerup', release)
  })
  await settle()
  const dragged = await measure(2)
  assert.equal(dragged.range.id, beforeDrag.range.id)
  assert.deepEqual(dragged.range.start, beforeDrag.range.start)
  assert.equal(dragged.range.end.offset, beforeDrag.range.end.offset - 2)
  assert.deepEqual(dragged.range.markerStyle, beforeDrag.range.markerStyle)
  for (const error of dragged.errors)
    assert.ok(
      error &&
        Math.abs(error.x) < 1 &&
        Math.abs(error.y) < 1 &&
        Math.abs(error.line) < 1,
      JSON.stringify(dragged)
    )
  report.gestures.push({
    action: 'touch end handle from corner; release before next frame',
    ...dragged
  })
  await page.evaluate(() => window.pdfTextHandles.draft())
  await settle()
  await page.evaluate(() => {
    const start = document.querySelector('[data-text-id="start"]').firstChild
    const end = document.querySelector('[data-text-id="end"]').firstChild
    const range = document.createRange()
    range.setStart(start, 0)
    range.setEnd(end, end.length)
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.locator('[data-pdf-handle-hit-target="start"]').waitFor()
  await settle()
  const draft = await measure()
  for (const error of draft.errors)
    assert.ok(
      error &&
        Math.abs(error.x) < 1 &&
        Math.abs(error.y) < 1 &&
        Math.abs(error.line) < 1
    )
  report.cases.push({ draft: true, ...draft })
  await page.evaluate(() => window.pdfTextHandles.selection.highlight())
  await page.waitForFunction(() => window.pdfTextHandles.ranges.length === 1)
  const confirmed = await page.evaluate(() => window.pdfTextHandles.ranges[0])
  assert.deepEqual(confirmed.start, beforeDrag.range.start)
  assert.deepEqual(confirmed.end, beforeDrag.range.end)
  report.gestures.push({
    action: 'confirm seeded DOM draft without double conversion',
    range: confirmed
  })
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      cases: report.cases.length,
      maxError: Math.max(
        ...report.cases.flatMap((item) =>
          item.errors.flatMap((error) => [
            Math.abs(error.x),
            Math.abs(error.y),
            Math.abs(error.line)
          ])
        )
      )
    })
  )
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
