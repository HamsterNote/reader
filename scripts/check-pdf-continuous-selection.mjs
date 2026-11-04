import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

export async function checkPdfContinuousSelection({ browser, base, output }) {
  const page = await browser.newPage({
    viewport: { width: 430, height: 900 },
    isMobile: true,
    hasTouch: true
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  await page.route('**/pdf-continuous.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, point) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: point ? [{ id: 1, ...point }] : []
    })
  const handle = (end) =>
    page.getByRole('button', {
      name: end ? '拖动以调整选区终点' : '拖动以调整选区起点'
    })
  const glyph = async (pageIndex, line, offset) =>
    page
      .locator('.pdfViewer .page')
      .nth(pageIndex)
      .locator('.textLayer [data-selection-start-offset]')
      .nth(line)
      .evaluate((span, offset) => {
        const range = document.createRange()
        range.setStart(span.firstChild, offset)
        range.setEnd(span.firstChild, offset + 1)
        const r = range.getBoundingClientRect(),
          s = span.getBoundingClientRect()
        const top = Math.max(r.top, s.top),
          bottom = Math.min(r.bottom, s.bottom)
        return {
          x: r.left + Math.min(0.3, r.width / 4),
          y: (top + bottom) / 2,
          height: bottom - top
        }
      }, offset)
  const press = async (point) => {
    await touch('touchStart', point)
    await page.waitForTimeout(570)
    await touch('touchEnd')
  }
  const center = async (end) => {
    const b = await handle(end).boundingBox()
    assert(b)
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const moveTo = (point, end) =>
    touch('touchMove', {
      x: point.x,
      y: point.y + (end ? 1 : -1) * (point.height / 2 + 10)
    })
  const scrollTop = () =>
    page
      .locator('.hamster-reader__pdf-viewer-container')
      .evaluate((element) => element.scrollTop)
  const zoom = async (scale) => {
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
    await page.waitForTimeout(200)
  }
  try {
    await page.addInitScript(() => {
      window.continuousNativeAdds = 0
      const add = Selection.prototype.addRange
      Selection.prototype.addRange = function (range) {
        if (document.querySelector('[data-pdf-touch-selection]'))
          window.continuousNativeAdds++
        return add.call(this, range)
      }
    })
    await page.goto(`${base}/pdf-continuous.html`)
    await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
    await page.waitForFunction(() => window.readerRegression)
    const fixture = await PDFDocument.create()
    for (let n = 1; n <= 5; n++) {
      const sheet = fixture.addPage([400, 420])
      for (let line = 0; line < 19; line++)
        sheet.drawText(
          `Page ${n} line ${String(line).padStart(2, '0')} Alpha beta gamma delta`,
          { x: 30, y: 388 - line * 19, size: 12 }
        )
    }
    await page.evaluate(
      (bytes) =>
        window.readerRegression.open('pdf', bytes, {
          isPdf: true,
          highlightColor: 'rgba(255, 193, 7, 0.35)'
        }),
      [...(await fixture.save())]
    )
    await page
      .locator('.textLayer [data-selection-start-offset]')
      .first()
      .waitFor()
    await zoom(0.49)
    await press(await glyph(0, 4, 23))
    await handle(true).waitFor()
    // Keep the exact captured DOM node while its logical endpoint changes.
    await handle(true).evaluate((element) => {
      window.capturedHandle = element
    })
    await touch('touchStart', await center(true))
    await moveTo(await glyph(0, 3, 15), true)
    await page.waitForTimeout(80)
    assert.equal(
      await handle(false).evaluate(
        (element) => element === window.capturedHandle
      ),
      true,
      'crossed end must become start without replacing the captured button'
    )
    await page.screenshot({
      path: resolve(output, 'pdf-continuous-reversed.png')
    })
    await moveTo(await glyph(0, 5, 27), true)
    await page.waitForTimeout(80)
    assert.equal(
      await handle(true).evaluate(
        (element) => element === window.capturedHandle
      ),
      true
    )
    await touch('touchEnd')
    const reversedText = await page.evaluate(() =>
      window.readerRegression.state.selectionTexts.at(-1)
    )
    assert(
      reversedText.includes('line 05'),
      'crossing back must commit the moving endpoint'
    )
    // Start a fresh selection and reach page two with a live text-only lens.
    await press(await glyph(0, 17, 23))
    await touch('touchStart', await center(true))
    await moveTo(await glyph(1, 2, 27), true)
    await page.waitForTimeout(100)
    const lens = page.getByTestId('range-magnifier')
    const lensState = await lens.evaluate((element) => ({
      text: element.textContent,
      parent: element.parentElement.tagName,
      zIndex: +getComputedStyle(element).zIndex,
      position: getComputedStyle(element).position,
      unwanted: element.querySelectorAll(
        'svg, canvas:not([hidden]), [data-range-handle-circle]'
      ).length,
      marker: getComputedStyle(
        element.querySelector('.hamster-reader__range-magnifier-marker')
      ).backgroundColor,
      markerWidth: getComputedStyle(
        element.querySelector('.hamster-reader__range-magnifier-marker')
      ).width
    }))
    assert(
      lensState.text.includes('Page 2'),
      'lens must display the target page text'
    )
    assert.equal(lensState.parent, 'BODY')
    assert.equal(lensState.position, 'fixed')
    assert(lensState.zIndex > 10001)
    assert.equal(lensState.unwanted, 0)
    assert.equal(lensState.markerWidth, '2px')
    await page.screenshot({
      path: resolve(output, 'pdf-continuous-cross-page-lens.png')
    })
    await touch('touchEnd')
    await page.evaluate(() =>
      window.readerRegression.selection.current.confirm()
    )
    let selected = await page.evaluate(() =>
      window.readerRegression.state.ranges.at(-1)
    )
    assert.equal(selected.start.selectionId, 'page-1')
    assert.equal(selected.end.selectionId, 'page-2')
    // Normal touch scrolling must retain the range before the next handle drag.
    const beforeScroll = await scrollTop()
    await touch('touchStart', { x: 320, y: 700 })
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', { x: 320, y: 700 - i * 35 })
      await page.waitForTimeout(20)
    }
    await touch('touchEnd')
    await page.waitForTimeout(300)
    assert(
      (await scrollTop()) > beforeScroll,
      'ordinary touch scrolling must still work'
    )
    assert(
      await page.locator('.hamster-reader__pdf-selection-preview').count(),
      'ordinary scroll must retain the selection'
    )
    await zoom(1)
    await press(await glyph(0, 4, 23))
    await touch('touchStart', await center(true))
    const viewport = await page
      .locator('.hamster-reader__pdf-viewer-container')
      .boundingBox()
    const bottom = Math.min(900, viewport.y + viewport.height)
    await touch('touchMove', { x: 150, y: bottom - 60 })
    await page.waitForTimeout(100)
    const slowStart = await scrollTop()
    await page.waitForTimeout(250)
    const slow = (await scrollTop()) - slowStart
    await touch('touchMove', { x: 150, y: bottom - 2 })
    await page.waitForTimeout(100)
    const fastStart = await scrollTop()
    await page.waitForTimeout(250)
    const fast = (await scrollTop()) - fastStart
    assert(slow > 0, 'edge band must scroll slowly away from its outer edge')
    assert(
      fast > slow * 2,
      'getting closer to the edge must accelerate scrolling'
    )
    // Hold the finger stationary until the next page is reached.
    await page.waitForFunction(
      () => {
        const spans = [
          ...document.querySelectorAll('[data-pdf-magnifier-text]')
        ]
        return spans.some((span) => span.textContent.includes('Page 3'))
      },
      null,
      { timeout: 6000 }
    )
    await page.screenshot({
      path: resolve(output, 'pdf-continuous-edge-scroll.png')
    })
    await touch('touchEnd')
    const stopped = await scrollTop()
    await page.waitForTimeout(250)
    assert(
      Math.abs((await scrollTop()) - stopped) < 1,
      'pointerup must immediately stop automatic scrolling'
    )
    await page.evaluate(() =>
      window.readerRegression.selection.current.confirm()
    )
    selected = await page.evaluate(() =>
      window.readerRegression.state.ranges.at(-1)
    )
    assert.equal(selected.start.selectionId, 'page-1')
    assert(
      Number(selected.end.selectionId.slice(5)) >= 3,
      'stationary finger must keep extending onto new pages'
    )
    const downEndPage = selected.end.selectionId
    // The last endpoint is visible. Reverse direction to test the upper edge.
    await touch('touchStart', await center(true))
    await touch('touchMove', { x: 150, y: viewport.y + 2 })
    const upStart = await scrollTop()
    await page.waitForTimeout(450)
    const upDelta = (await scrollTop()) - upStart
    assert(upDelta < -50, 'top edge must scroll upwards')
    await touch('touchCancel')
    const cancelled = await scrollTop()
    await page.waitForTimeout(250)
    assert(
      Math.abs((await scrollTop()) - cancelled) < 1,
      'cancel must stop automatic scrolling'
    )
    assert.equal(await page.evaluate(() => getSelection().rangeCount), 0)
    assert.equal(await page.evaluate(() => window.continuousNativeAdds), 0)
    assert.deepEqual(errors, [])
    return {
      label: 'pdf-continuous-text-lens-reversal-scroll',
      passed: true,
      lensState,
      reversedText,
      acceleration: {
        slowPixels250ms: slow,
        fastPixels250ms: fast,
        upPixels450ms: upDelta
      },
      downEndPage,
      nativeRangeCount: 0
    }
  } catch (error) {
    await page.screenshot({
      path: resolve(output, 'pdf-continuous-failure.png')
    })
    throw error
  } finally {
    await page.close()
  }
}
