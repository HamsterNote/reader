import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
import { createServer } from 'vite'

const repo = resolve(import.meta.dirname, '..')
const server = await createServer({
  root: repo,
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [repo, await realpath(resolve(repo, 'node_modules'))] }
  }
})
let browser
const savedMode = process.argv.includes('--saved')
const report = {
  platform: 'Chromium trusted mouse',
  surface: savedMode ? 'saved highlight' : 'draft',
  trials: []
}
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.dragEvents = []
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture'
    ])
      document.addEventListener(
        type,
        (event) => {
          window.dragEvents.push({
            type,
            id: event.pointerId,
            trusted: event.isTrusted,
            target: event.target.tagName,
            handle: event.target.closest?.('[data-pdf-handle-hit-target]')
              ?.dataset.pdfHandleHitTarget,
            captured: event.target.hasPointerCapture?.(event.pointerId) ?? false
          })
        },
        true
      )
    const original = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.closest('.hamster-reader__range-magnifier'))
        window.magnifierSample = {
          x: args[1] + args[3] / 2,
          y: args[2] + args[4] / 2,
          width: args[0].width,
          height: args[0].height
        }
      return original.apply(this, args)
    }
  })
  const html = await server.transformIndexHtml(
    '/preview.html',
    '<html><body style="margin:0"><div id="root"></div><script type="module" src="/test/browser/review-regressions.tsx"></script></body></html>'
  )
  await page.route('**/preview.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/preview.html`
  )
  await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
  await page.waitForFunction(() => window.readerRegression)
  const pdf = await PDFDocument.create()
  const sheet = pdf.addPage([760, 1100])
  for (let row = 0; row < 26; row++)
    sheet.drawText(
      `Row${String(row).padStart(2, '0')} Alpha beta gamma delta epsilon zeta eta theta`,
      {
        x: 60,
        y: 1050 - row * 36,
        size: 16
      }
    )
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
      scale: 0.75
    })
  )
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="tool-bottom-bar-layout-zoom"]')
        ?.textContent === '75%'
  )
  const settle = () =>
    page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
      )
    })
  await settle()
  // Managed selections intentionally clear window.Selection before the first
  // handle drag. Read the rendered endpoints through the real PDF hit tester.
  await page.evaluate(async () => {
    const { pdfCaretAtPoint } = await import('/src/pdf/pdfTouchSelection.ts')
    window.previewRange = () => {
      const root = document.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      const points = ['start', 'end'].map((side) => {
        const handle = document.querySelector(
          `[data-pdf-handle-hit-target="${side}"]`
        )
        const b = handle.getBoundingClientRect()
        const height = parseFloat(
          handle.querySelector('[data-pdf-handle-visual] > span').style.height
        )
        const x = b.x + b.width / 2
        const y =
          b.y +
          b.height / 2 +
          (side === 'end' ? -10 - height / 2 : 10 + height / 2)
        return pdfCaretAtPoint(root, x, y, true)
      })
      if (!points[0] || !points[1]) return null
      const range = document.createRange()
      range.setStart(points[0].startContainer, points[0].startOffset)
      range.setEnd(points[1].startContainer, points[1].startOffset)
      return range
    }
  })
  if (
    (await page
      .getByTestId('tool-bottom-bar-text-selection')
      .getAttribute('aria-pressed')) !== 'true'
  )
    await page.getByTestId('tool-bottom-bar-text-selection').click()
  for (let iteration = 0; iteration < 48; iteration++) {
    const scenario = ['text', 'line-gap', 'cross-anchor'][
      Math.floor(iteration / 16)
    ]
    const side = iteration % 2 ? 'start' : 'end'
    const grabOffset = [0, 9, -9, 18][Math.floor(iteration / 2) % 4]
    const steps = Math.floor(iteration / 8) % 2 ? 24 : 1
    await page.evaluate(() => window.readerRegression.selection.current.clear())
    if (savedMode)
      await page.evaluate(() =>
        window.readerRegression.update({ ranges: [], selectedRangeId: null })
      )
    await page.evaluate(() => {
      getSelection().removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })
    await settle()
    const down = (side === 'end') !== (scenario === 'cross-anchor')
    const row = down ? 3 : 13
    const targetRow = down ? 13 : 3
    const geometry = await page.evaluate(
      ({ row, targetRow, side }) => {
        const spans = [
          ...document.querySelectorAll(
            '.textLayer [data-selection-start-offset]'
          )
        ]
        const span = spans.find((el) =>
          el.textContent.startsWith(`Row${String(row).padStart(2, '0')} `)
        )
        const target = spans.find((el) =>
          el.textContent.startsWith(`Row${String(targetRow).padStart(2, '0')} `)
        )
        const char = (el, offset) => {
          const range = document.createRange()
          range.setStart(el.firstChild, offset)
          range.setEnd(el.firstChild, offset + 1)
          const rect = range.getBoundingClientRect()
          return { x: rect.left + 0.1, y: rect.top + rect.height / 2 }
        }
        return {
          start: char(span, 8),
          end: char(span, 22),
          target: char(target, side === 'end' ? 22 : 8)
        }
      },
      { row, targetRow, side }
    )
    await page.mouse.move(geometry.start.x, geometry.start.y)
    await page.mouse.down()
    await page.mouse.move(geometry.end.x, geometry.end.y, { steps: 8 })
    await page.mouse.up()
    const handle = page.locator(`button[data-pdf-handle-hit-target="${side}"]`)
    await handle.waitFor()
    let stored
    if (savedMode) {
      stored = await page.evaluate(() => {
        const api = window.readerRegression
        api.selection.current.highlight()
        const stored = structuredClone(api.state.ranges.at(-1))
        api.update({ ranges: [stored], selectedRangeId: stored.id })
        return { ...stored, updates: api.state.updates }
      })
    }
    await settle()
    const box = await handle.boundingBox()
    const origin = {
      x: box.x + box.width / 2 + grabOffset,
      y: box.y + box.height / 2 + grabOffset
    }
    const before = await page.evaluate(
      ({ origin, side }) => {
        const r = window.previewRange()
        const rects = r.getClientRects()
        const rect = side === 'end' ? rects[rects.length - 1] : rects[0]
        window.dragEvents = []
        window.magnifierSample = null
        return {
          start: r.startContainer.textContent,
          startOffset: r.startOffset,
          end: r.endContainer.textContent,
          endOffset: r.endOffset,
          offsetX: (side === 'end' ? rect.right : rect.left) - origin.x,
          offsetY: rect.top + rect.height / 2 - origin.y,
          hit: document
            .elementFromPoint(origin.x, origin.y)
            ?.closest('[data-pdf-handle-hit-target]')?.dataset
            .pdfHandleHitTarget
        }
      },
      { origin, side }
    )
    const point = {
      x: geometry.target.x,
      y: geometry.target.y + (scenario === 'line-gap' ? 11 : 0)
    }
    assert.ok(
      Math.hypot(point.x - origin.x, point.y - origin.y) > 200,
      JSON.stringify({ iteration, point, origin, before, geometry })
    )
    await page.mouse.move(origin.x, origin.y)
    await page.mouse.down()
    await settle()
    await page.mouse.move(point.x, point.y, { steps })
    await settle()
    const during = await page.evaluate(
      ({ point }) => {
        const r = window.previewRange()
        const lens = document.querySelector('[data-testid="range-magnifier"]')
        const source = document
          .querySelector('.pdfViewer .page')
          .getBoundingClientRect()
        const sample = window.magnifierSample
        const caret = document.caretRangeFromPoint(point.x, point.y)
        return {
          start: r?.startContainer.textContent,
          startOffset: r?.startOffset,
          end: r?.endContainer.textContent,
          endOffset: r?.endOffset,
          lensVisible: !lens.hidden,
          lensPointerEvents: getComputedStyle(lens).pointerEvents,
          lensHit: !!document
            .elementFromPoint(point.x, point.y)
            ?.closest('[data-testid="range-magnifier"]'),
          nativeCaret: caret?.startContainer.parentElement?.className,
          sampleOffset: sample
            ? {
                x:
                  (sample.x / sample.width) * source.width + source.x - point.x,
                y:
                  (sample.y / sample.height) * source.height +
                  source.y -
                  point.y
              }
            : null,
          events: window.dragEvents
        }
      },
      { point, before }
    )
    await page.mouse.up()
    await settle()
    const after = await page.evaluate(() => {
      const r = window.previewRange()
      return {
        start: r?.startContainer.textContent,
        startOffset: r?.startOffset,
        end: r?.endContainer.textContent,
        endOffset: r?.endOffset,
        canonicalStart: r
          ? Number(
              r.startContainer.parentElement.dataset.selectionStartOffset
            ) + r.startOffset
          : null,
        canonicalEnd: r
          ? Number(r.endContainer.parentElement.dataset.selectionStartOffset) +
            r.endOffset
          : null,
        updated: window.readerRegression.state.ranges.at(-1),
        updates: window.readerRegression.state.updates,
        events: window.dragEvents
      }
    })
    const prefix = `Row${String(targetRow).padStart(2, '0')} `
    const other = side === 'end' ? 'start' : 'end'
    const moving = scenario === 'cross-anchor' ? other : side
    const moved = during[moving]?.startsWith(prefix) ?? false
    const saved = after[moving]?.startsWith(prefix) ?? false
    const fixed = side === 'end' ? 'start' : 'end'
    const fixedAfter = scenario === 'cross-anchor' ? side : fixed
    const stable =
      before[fixed] === after[fixedAfter] &&
      before[`${fixed}Offset`] === after[`${fixedAfter}Offset`]
    const persisted =
      !savedMode ||
      (after.updates === stored.updates + 1 &&
        after.updated?.id === stored.id &&
        after.updated?.start.offset === after.canonicalStart &&
        after.updated?.end.offset === after.canonicalEnd)
    report.trials.push({
      iteration,
      scenario,
      side,
      grabOffset,
      steps,
      origin,
      point,
      before,
      during,
      after,
      moved,
      saved,
      stable,
      persisted,
      failed: !moved || !saved || !stable || !persisted
    })
  }
  report.failures = report.trials.filter((trial) => trial.failed).length
  // Mouse edits must not open a lens or capture a snapshot. Touch glyph and
  // physical-pointer projection are covered by check-shared-selection-interaction.
  report.sampleFailures = report.trials.filter(
    (trial) => trial.during.lensVisible || trial.during.sampleOffset !== null
  ).length
  report.captureFailures = report.trials.filter((trial) => {
    const events = trial.during.events
    const down = events.findIndex((event) => event.type === 'pointerdown')
    return events
      .slice(down + 1)
      .some(
        (event) =>
          event.type === 'lostpointercapture' ||
          event.type === 'pointercancel' ||
          (event.type === 'pointermove' &&
            (!event.captured || !event.trusted || event.id !== events[down].id))
      )
  }).length
  report.hitFailures = report.trials.filter(
    (trial) =>
      trial.before.hit !== trial.side ||
      trial.during.lensHit ||
      trial.during.lensPointerEvents !== 'none'
  ).length
  report.errors = errors
  console.log(JSON.stringify(report, null, 2))
  assert.equal(
    report.failures,
    0,
    `${report.failures}/${report.trials.length} drags failed`
  )
  assert.equal(
    report.sampleFailures,
    0,
    `${report.sampleFailures}/${report.trials.length} mouse drags unexpectedly opened a lens`
  )
  assert.deepEqual(errors, [])
  assert.equal(report.captureFailures, 0)
  assert.equal(report.hitFailures, 0)
} finally {
  await browser?.close()
  await server.close()
}
