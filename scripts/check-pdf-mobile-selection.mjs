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
          x: rect.left + 0.1,
          y: rect.top + rect.height / 2,
          height: rect.height
        }
      }, offset)
  const lastText = () =>
    page.evaluate(() => window.readerRegression.state.selectionTexts.at(-1))
  const drag = async (end, target) => {
    const handle = page.getByRole('button', {
      name: end ? '拖动以调整选区终点' : '拖动以调整选区起点'
    })
    const box = await handle.boundingBox()
    assert(box)
    assert.equal(Math.round(box.width), 20)
    // Grab off-center and move outside the target line, keeping its glyphs clear.
    const start = { x: box.x + 7, y: box.y + 7 }
    await touch('touchStart', [start])
    await touch('touchMove', [
      {
        x: target.x - 3,
        y: target.y + (end ? 1 : -1) * (target.height / 2 + 10) - 3
      }
    ])
    await touch('touchEnd', [])
    await page.waitForTimeout(100)
  }
  try {
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
          nativeLayoutZoom: 1,
          highlightColor: 'rgba(255, 193, 7, 0.35)',
          selectionColor: '#0000ff'
        }),
      bytes
    )
    await page
      .locator('.textLayer [data-selection-start-offset]')
      .first()
      .waitFor({ timeout: 15000 })
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
    for (const scale of [0.5, 1, 2]) {
      await page.evaluate(
        (scale) => window.readerRegression.update({ nativeLayoutZoom: scale }),
        scale
      )
      await page.waitForTimeout(200)
      await longPress(await point(0, 7))
      await page.getByRole('button', { name: '拖动以调整选区终点' }).waitFor()
      const circle = await page
        .getByRole('button', { name: '拖动以调整选区终点' })
        .boundingBox()
      assert.equal(Math.round(circle.width), 20)
      await drag(true, await point(0, 16))
      assert.equal(await page.evaluate(() => getSelection().rangeCount), 0)
      await page.screenshot({
        path: resolve(output, `pdf-mobile-scale-${scale}.png`)
      })
    }
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
      highlight: edited.ranges[0]
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
