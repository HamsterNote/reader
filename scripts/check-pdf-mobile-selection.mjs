import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

/** CDP touch input exercises browser defaults/capture, rather than JS PointerEvents. */
export async function checkPdfMobileSelection({ browser, base, output }) {
  const page = await browser.newPage({
    viewport: { width: 430, height: 900 },
    isMobile: true,
    hasTouch: true
  })
  const errors = []
  const nativeChecks = []
  const hotAreaChecks = []
  const scaleChecks = []
  let scaleOneWidth = 0
  page.on('pageerror', (error) => errors.push(error.message))
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  await page.route('**/pdf-mobile.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((point, index) => ({ id: index + 1, ...point }))
    })
  const longPress = async (point) => {
    await touch('touchStart', [point])
    await page.waitForTimeout(560)
    await touch('touchEnd', [])
  }
  const point = async (line, offset) =>
    page
      .locator('.textLayer [data-selection-start-offset]')
      .nth(line)
      .evaluate((span, offset) => {
        const r = document.createRange()
        r.setStart(span.firstChild, offset)
        r.setEnd(span.firstChild, offset + 1)
        const glyph = r.getBoundingClientRect()
        const box = span.getBoundingClientRect()
        const top = Math.max(glyph.top, box.top)
        const bottom = Math.min(glyph.bottom, box.bottom)
        const rect = { left: glyph.left, top, height: bottom - top }
        return {
          x: rect.left + Math.min(1, glyph.width / 4),
          y: rect.top + rect.height / 2,
          height: rect.height
        }
      }, offset)
  const lastText = () =>
    page.evaluate(() => window.readerRegression.state.selectionTexts.at(-1))
  const setZoom = async (scale) => {
    await page.evaluate(
      (scale) =>
        window.readerRegression.selection.current.scrollToPosition({
          x: 0,
          y: 0,
          scale
        }),
      scale
    )
    await page.waitForFunction(
      (scale) =>
        document.querySelector('[data-testid="tool-bottom-bar-layout-zoom"]')
          ?.textContent === `${Math.round(scale * 100)}%`,
      scale
    )
    await page
      .locator('.textLayer [data-selection-start-offset]')
      .first()
      .waitFor()
    await page.waitForTimeout(200)
    const box = await page.locator('.pdfViewer .page').first().boundingBox()
    if (!scaleOneWidth) scaleOneWidth = box.width / scale
    assert(
      Math.abs(box.width / scaleOneWidth - scale) < 0.01,
      'actual PDF page width must track the requested zoom'
    )
    scaleChecks.push({
      requested: scale,
      toolbar: await page
        .getByTestId('tool-bottom-bar-layout-zoom')
        .innerText(),
      pageWidth: box.width,
      measuredScale: box.width / scaleOneWidth
    })
  }
  const noNative = async (phase) => {
    await page.waitForFunction(() => getSelection().rangeCount === 0)
    const count = await page.evaluate(() => getSelection().rangeCount)
    nativeChecks.push({ phase, rangeCount: count })
    assert.equal(count, 0)
  }
  const assertEndpoint = async (end, target) => {
    const circle = await page
      .locator(`[data-range-handle-circle="${end ? 'end' : 'start'}"]`)
      .boundingBox()
    assert(
      Math.abs(circle.x + circle.width / 2 - target.x) < 1.5,
      'circle and current Range endpoint must match without waiting for rAF'
    )
    const edge = end ? circle.y : circle.y + circle.height
    assert(
      Math.abs(edge - (target.y + ((end ? 1 : -1) * target.height) / 2)) < 1,
      'circle must stay outside its current line'
    )
  }
  const drag = async (end, target, corner = [1, 1]) => {
    const handle = page.getByRole('button', {
      name: end ? '拖动以调整选区终点' : '拖动以调整选区起点'
    })
    const box = await handle.boundingBox()
    assert(box)
    assert.equal(Math.round(box.width), 40)
    assert.equal(Math.round(box.height), 40)
    const visual = await handle
      .locator('[data-range-handle-circle]')
      .boundingBox()
    assert.equal(Math.round(visual.width), 20)
    assert.equal(Math.round(visual.height), 20)
    // Grab off-center and move outside the target line, keeping its glyphs clear.
    const grabX = corner[0],
      grabY = corner[1]
    const start = { x: box.x + grabX, y: box.y + grabY }
    assert.equal(
      await page.evaluate(
        ({ x, y, end }) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[data-pdf-handle-hit-target]')
            ?.getAttribute('data-pdf-handle-hit-target'),
        { ...start, end }
      ),
      end ? 'end' : 'start'
    )
    hotAreaChecks.push({
      end,
      width: box.width,
      height: box.height,
      grab: [grabX, grabY],
      outsideCircleBy: 9
    })
    await touch('touchStart', [start])
    await noNative('drag-start')
    await touch('touchMove', [
      {
        x: target.x + grabX - 20,
        y: target.y + (end ? 1 : -1) * (target.height / 2 + 10) + grabY - 20
      }
    ])
    await noNative('drag-moving')
    await assertEndpoint(end, target)
    await page.screenshot({
      path: resolve(output, 'pdf-mobile-active-edge-drag.png')
    })
    await touch('touchEnd', [])
    await noNative('drag-finished')
    await page.waitForTimeout(100)
    await assertEndpoint(end, target)
  }
  try {
    await page.addInitScript(() => {
      window.pdfSelectionNativeAdds = []
      const add = Selection.prototype.addRange
      Selection.prototype.addRange = function (range) {
        if (
          document.querySelector('[data-pdf-touch-selection]') &&
          !window.pdfInjectNative
        )
          window.pdfSelectionNativeAdds.push(new Error().stack)
        return add.call(this, range)
      }
    })
    await page.goto(`${base}/pdf-mobile.html`)
    await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
    await page.waitForFunction(() => window.readerRegression)
    const fixture = await PDFDocument.create()
    const sheet = fixture.addPage([400, 600])
    sheet.drawText('Alpha beta gamma delta', { x: 30, y: 500, size: 16 })
    sheet.drawText('Second line for touch selection', {
      x: 30,
      y: 460,
      size: 16
    })
    fixture.addPage([400, 600])
    const bytes = [...(await fixture.save())]
    await page.evaluate(
      (bytes) =>
        window.readerRegression.open('pdf', bytes, {
          isPdf: true,
          highlightColor: 'rgba(255, 193, 7, 0.35)',
          selectionColor: '#0000ff'
        }),
      bytes
    )
    await page
      .locator('.textLayer [data-selection-start-offset]')
      .first()
      .waitFor({ timeout: 15000 })
    await setZoom(1)
    await longPress(await point(0, 7))
    await page.getByRole('button', { name: '拖动以调整选区终点' }).waitFor()
    assert.equal(await lastText(), 'beta')
    assert.equal(await page.evaluate(() => getSelection().rangeCount), 0)
    assert.equal(
      await page
        .locator('.textLayer span')
        .first()
        .evaluate((span) => getComputedStyle(span).userSelect),
      'none'
    )
    // Adversarially reactivate a native range extending into the bottom toolbar.
    await page.evaluate(() => {
      window.pdfInjectNative = true
      const span = document.querySelector(
        '.textLayer [data-selection-start-offset]'
      )
      const toolbar = document.querySelector('.hamster-reader button')
      const range = document.createRange()
      range.selectNodeContents(span)
      if (toolbar?.firstChild?.nodeType === Node.TEXT_NODE)
        range.setEnd(toolbar.firstChild, 1)
      getSelection().addRange(range)
      window.pdfInjectNative = false
    })
    await noNative('injected-native-selection-cleared')
    await page.evaluate(() => {
      window.pdfCopiedText = null
      document.addEventListener(
        'copy',
        (event) => {
          window.pdfCopiedText = event.clipboardData.getData('text/plain')
        },
        { once: true }
      )
    })
    await page.keyboard.press('Control+C')
    await page.waitForFunction(() => window.pdfCopiedText !== null)
    assert.equal(await page.evaluate(() => window.pdfCopiedText), 'beta')
    await noNative('copy-without-visible-native-range')
    await page.screenshot({ path: resolve(output, 'pdf-mobile-longpress.png') })
    await drag(true, await point(1, 8))
    await drag(false, await point(0, 0))
    await page.evaluate(() =>
      window.readerRegression.update({
        highlightColor: 'rgba(20, 180, 90, 0.35)'
      })
    )
    const preview = page.locator('.hamster-reader__pdf-selection-preview path')
    assert.equal(await preview.getAttribute('fill'), 'rgba(20, 180, 90, 0.35)')
    await page.screenshot({
      path: resolve(output, 'pdf-mobile-cross-line-green.png')
    })
    await page.getByRole('button', { name: '高亮', exact: true }).tap()
    const saved = await page.evaluate(
      () => window.readerRegression.state.ranges
    )
    assert.equal(saved.length, 1)
    assert(saved[0].text.startsWith('Alpha beta gamma delta'))
    assert(saved[0].text.includes('Second'))
    assert.equal(
      saved[0].markerStyle.backgroundColor,
      'rgba(20, 180, 90, 0.35)'
    )
    // Adjust the existing annotation once; saved identity/color must survive.
    await drag(true, await point(1, 14))
    const edited = await page.evaluate(() => window.readerRegression.state)
    assert.equal(edited.updates, 1)
    assert.equal(edited.ranges[0].id, saved[0].id)
    assert.equal(
      edited.ranges[0].markerStyle.backgroundColor,
      saved[0].markerStyle.backgroundColor
    )
    assert(edited.ranges[0].text.length > saved[0].text.length)
    for (const scale of [0.49, 0.5, 1, 2]) {
      await setZoom(scale)
      await longPress(await point(0, 7))
      await page.getByRole('button', { name: '拖动以调整选区终点' }).waitFor()
      const circle = await page
        .getByRole('button', { name: '拖动以调整选区终点' })
        .boundingBox()
      assert.equal(Math.round(circle.width), 40)
      const corners = [
        [1, 1],
        [39, 1],
        [1, 39],
        [39, 39]
      ]
      for (const [index, corner] of corners.entries()) {
        await drag(true, await point(0, index % 2 ? 10 : 12), corner)
      }
      assert.equal(await page.evaluate(() => getSelection().rangeCount), 0)
      await page.screenshot({
        path: resolve(output, `pdf-mobile-scale-${scale}.png`)
      })
      if (scale === 0.49) {
        const debug = await page.addStyleTag({
          content:
            '[data-pdf-handle-hit-target]{outline:1px dashed purple!important} [data-pdf-handle-hit-target]::after{content:"40 x 40";position:absolute;left:42px;top:0;color:purple;font:10px sans-serif;white-space:nowrap;pointer-events:none}'
        })
        await page.screenshot({
          path: resolve(output, 'pdf-mobile-hot-area-49.png')
        })
        await debug.evaluate((element) => element.remove())
        const outside = await point(1, 25)
        assert.equal(
          await page.evaluate(
            ({ x, y }) =>
              Boolean(
                document
                  .elementFromPoint(x, y)
                  ?.closest('[data-pdf-handle-hit-target]')
              ),
            outside
          ),
          false
        )
        await longPress(outside)
        assert.equal(
          await lastText(),
          'selection',
          'text outside the hit squares must still accept long press'
        )
      }
    }
    assert.deepEqual(
      await page.evaluate(() => window.pdfSelectionNativeAdds),
      [],
      'app must never add a visible native Range during PDF touch selection'
    )
    await page.evaluate(() =>
      window.readerRegression.update({ renderMode: 'text' })
    )
    await page.locator('.hamster-reader__pdf-text-viewport').first().waitFor()
    const text = page
      .locator('.hamster-reader__pdf-text-viewport [data-text-id]')
      .first()
    await text.waitFor()
    const box = await text.boundingBox()
    await longPress({ x: box.x + 30, y: box.y + box.height / 2 })
    const active = page
      .locator(
        '.hsn-selection-rect--active, .hsn-selection-percent-rect-active'
      )
      .first()
    await active.waitFor()
    const color = () =>
      active.evaluate((element) => getComputedStyle(element).backgroundColor)
    assert.equal(await color(), 'rgba(20, 180, 90, 0.35)')
    await page.evaluate(() =>
      window.readerRegression.update({
        highlightColor: 'rgba(190, 80, 150, 0.35)'
      })
    )
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(
            '.hsn-selection-rect--active, .hsn-selection-percent-rect-active'
          )
        ).backgroundColor === 'rgba(190, 80, 150, 0.35)'
    )
    assert.equal(await color(), 'rgba(190, 80, 150, 0.35)')
    await page.screenshot({ path: resolve(output, 'pdf-mobile-text-mode.png') })
    assert.deepEqual(errors, [])
    return {
      label:
        'pdf-mobile-cdp-longpress-both-handles-cross-line-color-confirm-edit',
      passed: true,
      highlight: edited.ranges[0],
      nativeChecks,
      hotAreaChecks,
      scaleChecks
    }
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'pdf-mobile-failure.png') })
    console.error({
      errors,
      text: await page.locator('body').innerText(),
      pages: await page.locator('.pdfViewer .page').count(),
      spans: await page.locator('.textLayer span').count()
    })
    throw error
  } finally {
    await page.close()
  }
}
