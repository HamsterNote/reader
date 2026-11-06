import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

// Deliberately disable blending: WKWebView can isolate the overlay backdrop.
export async function checkPdfSelectionPaint({
  browser,
  base,
  output,
  baseline = false
}) {
  const page = await browser.newPage({
    viewport: { width: 430, height: 900 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  })
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  await page.route('**/pdf-paint.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  try {
    await page.goto(`${base}/pdf-paint.html`)
    await page.addStyleTag({
      content:
        '.hamster-reader{height:100%} .hamster-reader__pdf-selection-preview,.hamster-reader__pdf-highlight-rect{mix-blend-mode:normal!important}'
    })
    await page.waitForFunction(() => window.readerRegression)
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const sheet = pdf.addPage([400, 600])
    for (let row = 0; row < 3; row++) {
      let x = 30
      for (const text of ['Alpha ', 'beta ', 'gamma ', 'delta']) {
        sheet.drawText(text, { x, y: 500 - row * 19, size: 16, font })
        x += font.widthOfTextAtSize(text, 16) + 0.15
      }
    }
    await page.evaluate(
      (bytes) =>
        window.readerRegression.open('pdf', bytes, {
          isPdf: true,
          highlightColor: '#ffc107'
        }),
      [...(await pdf.save())]
    )
    const spans = page.locator('.textLayer [data-selection-start-offset]')
    await spans.first().waitFor()
    await page.evaluate(() =>
      window.readerRegression.selection.current.scrollToPosition({
        x: 0,
        y: 0,
        scale: 1
      })
    )
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="tool-bottom-bar-layout-zoom"]')
          ?.textContent === '100%'
    )
    await spans.first().waitFor()
    await page.waitForTimeout(200)
    const geometry = await spans.evaluateAll((spans) => {
      const r = document.createRange()
      r.setStart(spans[0].firstChild, 0)
      const last = spans.at(-1).firstChild
      r.setEnd(last, last.length)
      return {
        full: [...r.getClientRects()].map((r) => r.toJSON()),
        nodes: spans.flatMap((span) => {
          const r = document.createRange()
          r.selectNodeContents(span)
          return [...r.getClientRects()].map((r) => {
            const box = span.getBoundingClientRect()
            const top = Math.max(r.top, box.top)
            const bottom = Math.min(r.bottom, box.bottom)
            return { ...r.toJSON(), top, bottom, height: bottom - top }
          })
        })
      }
    })
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, points = []) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p) => ({ id: 1, ...p }))
      })
    const first = geometry.nodes[0],
      last = geometry.nodes.at(-1)
    await touch('touchStart', [
      { x: first.left + 2, y: first.top + first.height / 2 }
    ])
    await page.waitForTimeout(560)
    await touch('touchEnd')
    const handle = page.getByRole('button', { name: '拖动以调整选区终点' })
    await handle.waitFor()
    const box = await handle.boundingBox()
    await touch('touchStart', [{ x: box.x + 20, y: box.y + 20 }])
    await touch('touchMove', [
      { x: last.right - 2, y: last.bottom + (baseline ? 0 : 10) }
    ])
    await touch('touchEnd')
    await page.waitForTimeout(150)
    const clip = {
      x: 0,
      y: Math.max(0, first.top - 70),
      width: 430,
      height: 210
    }
    const screenshot = await page.screenshot({
      path: resolve(
        output,
        `pdf-paint-${baseline ? 'before' : 'after'}-draft.png`
      ),
      clip
    })
    const preview = page.locator('.hamster-reader__pdf-selection-preview path')
    const draftFill = await preview.getAttribute('fill')
    if (!baseline) {
      assert.equal(draftFill, 'rgba(255, 193, 7, 0.35)')
      assert.equal(
        (await preview.getAttribute('d')).match(/M/g).length,
        3,
        'one continuous paint rectangle per line'
      )
      const readablePixels = await page.evaluate(
        async (source) => {
          const image = new Image()
          image.src = source
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          const { data } = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          )
          let readable = 0
          for (let i = 0; i < data.length; i += 4)
            if (
              data[i] > 50 &&
              data[i] < 160 &&
              data[i + 1] > 35 &&
              data[i + 1] < 130 &&
              data[i + 2] < 45
            )
              readable++
          return readable
        },
        `data:image/png;base64,${screenshot.toString('base64')}`
      )
      assert(
        readablePixels > 100,
        'black glyphs must remain visible beneath the translucent yellow preview with blending disabled'
      )
      const handles = await page
        .locator('[data-range-handle-circle]')
        .evaluateAll((handles) =>
          handles.map((h) => ({
            box: h.getBoundingClientRect().toJSON(),
            border: getComputedStyle(h).borderWidth,
            filter: getComputedStyle(h.closest('[data-pdf-handle-visual]'))
              .filter
          }))
        )
      assert.equal(handles[0].box.bottom <= first.top + 0.1, true)
      assert.equal(handles[1].box.top >= last.bottom - 0.1, true)
      assert(
        handles.every(
          (h) => h.border === '2px' && h.filter.includes('drop-shadow')
        )
      )
    }
    await page.getByRole('button', { name: '高亮', exact: true }).tap()
    if (!baseline) {
      const ranges = await page.evaluate(
        () => window.readerRegression.state.ranges
      )
      assert.equal(ranges[0].rectsBySelectionId['page-1'].length, 3)
    }
    // Clear active editing with a blank-page tap so the saved overlay is visible.
    await page.touchscreen.tap(350, last.bottom + 90)
    await page.waitForTimeout(150)
    const saved = page
      .locator('.hamster-reader__pdf-highlight-rect path')
      .first()
    const savedFill = await saved.getAttribute('fill')
    if (!baseline) assert.equal(savedFill, draftFill)
    await page.screenshot({
      path: resolve(
        output,
        `pdf-paint-${baseline ? 'before' : 'after'}-saved.png`
      ),
      clip
    })
    return {
      label: 'pdf-opaque-color-no-blending-tight-multi-span-paint',
      passed: !baseline,
      draftFill,
      savedFill,
      geometry
    }
  } finally {
    await page.close()
  }
}
