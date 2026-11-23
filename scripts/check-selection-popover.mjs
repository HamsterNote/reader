import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { chromium } from 'playwright'
import { expect } from 'playwright/test'
import { createServer } from 'vite'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'

export async function selectionFixture() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  zip.file(
    'book.opf',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">selection</dc:identifier><dc:title>Selection</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/><itemref idref="second"/></spine></package>'
  )
  zip.file(
    'chapter.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Selection</title></head><body><p>Alpha <strong>bravo</strong> <em>charlie</em><span> delta</span>   echo.</p><p>Second <span>paragraph</span> with repeated text.</p><p>Second <span>paragraph</span> with repeated text.</p></body></html>'
  )
  zip.file(
    'second.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second</title></head><body><p>Another chapter.</p></body></html>'
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}
async function snapshot(page) {
  return page
    .locator('#snapshot')
    .evaluate((node) => JSON.parse(node.textContent))
}

async function checkPdfSelectionRelease(page, touch) {
  const span = page
    .locator('.textLayer span')
    .filter({ hasText: /\w{4}/ })
    .first()
  await expect(span).toBeVisible()
  const point = await span.evaluate((node) => {
    const word = node.textContent.match(/\w{4}/)
    const range = document.createRange()
    range.setStart(node.firstChild, word.index + 1)
    range.setEnd(node.firstChild, word.index + 2)
    const box = range.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
  const popover = page.locator('.hsn-selection-popover')
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point]
    })
    await expect(
      page.locator('[data-range-handle-circle]').first()
    ).toBeVisible()
    await expect(popover).toHaveCount(0)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    })
  } else {
    await page.mouse.move(point.x, point.y)
    await page.mouse.click(point.x, point.y)
    await page.mouse.down({ clickCount: 2 })
    await expect
      .poll(() => page.evaluate(() => getSelection().toString()))
      .toMatch(/\w{4}/)
    await expect(popover).toHaveCount(0)
    await page.mouse.up({ clickCount: 2 })
  }
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible()
  console.log(
    `PDF Layout ${touch ? 'long press' : 'double click'}: count 0 while pressed, toolbar visible after release`
  )
  if (touch) {
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    const highlight = page.getByRole('toolbar', { name: '高亮操作' })
    await expect(highlight).toBeVisible()
    const { ranges } = await snapshot(page)
    await page.evaluate((ranges) => {
      sessionStorage.setItem('selection-harness:ranges', JSON.stringify(ranges))
    }, ranges)
    await page.reload()
    await page
      .getByLabel('Book', { exact: true })
      .setInputFiles(resolve('test/compat/fixtures/pdf/two-column.pdf'))
    const overlay = page.locator(`[data-range-id="${ranges[0].id}"]`).first()
    await expect(overlay).toBeVisible()
    const box = await overlay.boundingBox()
    assert(box)
    const highlightPoint = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    }
    await expect(highlight).toHaveCount(0)
    await page.mouse.click(highlightPoint.x, highlightPoint.y)
    await expect(highlight).toBeVisible()
    const mousePointer = {
      pointerId: 41,
      pointerType: 'mouse',
      button: 0,
      bubbles: true,
      cancelable: true,
      clientX: highlightPoint.x,
      clientY: highlightPoint.y
    }
    await span.dispatchEvent('pointerdown', mousePointer)
    await expect(highlight).toHaveCount(1)
    await span.dispatchEvent('pointerup', mousePointer)
    await expect(highlight).toHaveCount(1)
    console.log(
      'PDF Layout existing highlight mouse press: count 1 before, during and after press'
    )
    await page.mouse.click(800, 700)
    await expect(highlight).toHaveCount(0)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [highlightPoint]
    })
    await expect(highlight).toHaveCount(0)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    })
    await expect(highlight).toBeVisible()
    console.log(
      'PDF Layout existing highlight touch press: count 0 while pressed, toolbar visible after release'
    )
  }
}
async function selectText(
  page,
  format,
  start,
  end,
  reverse = false,
  yRatio = 0.5
) {
  const points = await page.evaluate(
    ({ format, start, end, yRatio }) => {
      const doc =
        format === 'epub'
          ? document.querySelector('foliate-view').renderer.getContents()[0].doc
          : document
      const offset =
        format === 'epub'
          ? doc.defaultView.frameElement.getBoundingClientRect()
          : { x: 0, y: 0 }
      const texts =
        format === 'epub'
          ? [
              doc.querySelector('p').firstChild,
              doc.querySelectorAll('p')[1].lastChild
            ]
          : [...doc.querySelectorAll('.textLayer span')]
              .filter((node) => node.firstChild?.nodeType === 3)
              .map((node) => node.firstChild)
      const point = ([index, character]) => {
        const range = doc.createRange()
        range.setStart(texts[index], character)
        range.collapse(true)
        const box = range.getBoundingClientRect()
        return {
          x: box.x + offset.x,
          y: box.y + offset.y + box.height * yRatio
        }
      }
      return [point(start), point(end)]
    },
    { format, start, end, yRatio }
  )
  if (reverse) points.reverse()
  if (reverse && format === 'pdf') {
    const hit = await page.evaluate((point) => {
      const element = document.elementFromPoint(point.x, point.y)
      const caret = document.caretRangeFromPoint?.(point.x, point.y)
      return {
        point,
        hitTag: element?.tagName,
        textLayerText: element?.closest('.textLayer span')?.textContent,
        caretText: caret?.startContainer.textContent,
        caretOffset: caret?.startOffset
      }
    }, points[0])
    assert(
      hit.textLayerText && hit.caretText === hit.textLayerText,
      `PDF direct drag must start on target text ${JSON.stringify(hit)}`
    )
    console.log(`PDF direct drag target ${JSON.stringify(hit)}`)
  }
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 12 })
  await page.mouse.up()
}
async function assertCompactPalette(page, toolbarName = '选区操作') {
  const toolbar = page.getByRole('toolbar', { name: toolbarName })
  await expect(toolbar).toBeVisible()
  const actionName = toolbarName === '选区操作' ? '高亮' : '删除'
  const action = toolbar.getByRole('button', { name: actionName, exact: true })
  const palette = toolbar.getByRole('group', { name: 'Highlight color' })
  const swatches = palette.getByRole('button')
  await expect(swatches).toHaveCount(7)
  await expect(swatches.last()).toHaveAttribute('aria-label', '自由选色')
  assert.deepEqual(
    await swatches.evaluateAll((nodes) =>
      nodes.slice(0, 6).map((node) => node.dataset.color)
    ),
    ['#7d9ec0', '#8eba8e', '#d1b88a', '#cf9cab', '#a99fc4', '#2a2a2a']
  )
  const [actionBox, swatchBoxes] = await Promise.all([
    action.boundingBox(),
    swatches.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect()
        return { y: box.y, height: box.height }
      })
    )
  ])
  assert(actionBox)
  const actionCenterY = actionBox.y + actionBox.height / 2
  swatchBoxes.forEach((box, index) => {
    assert(
      Math.abs(actionCenterY - (box.y + box.height / 2)) <= 1,
      `${toolbarName}: ${actionName} and swatch ${index + 1} must share one horizontal row`
    )
  })
  await palette.evaluate((node) => {
    window.__customColorInputClickForwarded = false
    node.querySelector('input[type=color]').addEventListener(
      'click',
      () => {
        window.__customColorInputClickForwarded = true
      },
      { once: true }
    )
  })
  await swatches.last().click()
  assert.equal(
    await page.evaluate(() => window.__customColorInputClickForwarded),
    true,
    `${toolbarName}: custom color button must forward the click to its input`
  )
}
async function setColorInput(locator, color) {
  await locator.evaluate((input, color) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set
    setter.call(input, color)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, color)
}
async function setColor(page, color) {
  await setColorInput(
    page.getByRole('textbox', { name: 'Highlight color' }),
    color
  )
}
async function setCustomColor(page, color) {
  await setColorInput(page.getByLabel('自定义高亮颜色'), color)
}
async function capturePopoverThemes(browser, base, output) {
  for (const darkMode of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 800 }
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.goto(
        `${base}/demo/selection-harness.html${darkMode ? '?dark' : ''}`
      )
      await page.getByLabel('Book', { exact: true }).setInputFiles({
        name: 'selection.epub',
        mimeType: 'application/epub+zip',
        buffer: await selectionFixture()
      })
      await page.waitForFunction(() => {
        const button = document.querySelector('[aria-label=下一页]')
        return button && !button.disabled
      })
      await page.evaluate(async () => {
        await document.fonts.ready
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      })
      await selectText(page, 'epub', [0, 1], [1, 10])
      await assertCompactPalette(page)
      await setCustomColor(page, '#123456')
      await expect(
        page.getByRole('textbox', { name: 'Highlight color' })
      ).toHaveValue('#123456')
      await expect(
        page.getByRole('button', { name: '自由选色' })
      ).toHaveAttribute('aria-pressed', 'true')
      const toolbar = page.getByRole('toolbar', { name: '选区操作' })
      await expect(toolbar).toHaveClass(
        darkMode
          ? /hamster-reader-popover--dark/
          : /hamster-reader-popover--light/
      )
      await page.screenshot({
        path: resolve(
          output,
          `selection-popover-${darkMode ? 'dark' : 'light'}.png`
        )
      })
      await page.getByRole('button', { name: '高亮', exact: true }).click()
      await expect(
        page.getByRole('toolbar', { name: '高亮操作' })
      ).toBeVisible()
      assert.equal(
        (await snapshot(page)).ranges[0].markerStyle.backgroundColor,
        '#123456'
      )
      await assertCompactPalette(page, '高亮操作')
      await expect(
        page.getByRole('button', { name: '自由选色' })
      ).toHaveAttribute('data-color', '#123456')
      console.log(
        `Custom color (${darkMode ? 'dark' : 'light'}): click forwarding + simulated input saved on highlight`
      )
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
    }
  }
}
async function assertInside(page) {
  await page.waitForFunction(() => {
    const popup = document
      .querySelector('.hamster-reader__engine-popover')
      ?.getBoundingClientRect()
    const reader = document
      .querySelector('[data-engine]')
      ?.getBoundingClientRect()
    return (
      popup &&
      popup.left >= Math.max(0, reader.left) &&
      popup.right <= Math.min(innerWidth, reader.right) + 1 &&
      popup.top >= Math.max(0, reader.top) &&
      popup.bottom <= Math.min(innerHeight, reader.bottom) + 1
    )
  })
}
async function dragEndpoint(page, format, cancel = false) {
  const target = await page.evaluate((format) => {
    const doc =
      format === 'epub'
        ? document.querySelector('foliate-view').renderer.getContents()[0].doc
        : document
    const node =
      format === 'epub'
        ? doc.querySelectorAll('p')[2].lastChild
        : [...doc.querySelectorAll('.textLayer span')].filter(
            (node) => node.firstChild?.nodeType === 3
          )[1].firstChild
    const range = doc.createRange()
    range.setStart(node, format === 'epub' ? 10 : 15)
    range.collapse(true)
    const box = range.getBoundingClientRect(),
      frame = doc.defaultView.frameElement?.getBoundingClientRect() ?? {
        x: 0,
        y: 0
      }
    return { x: box.x + frame.x, y: box.y + frame.y + box.height / 2 }
  }, format)
  const handle = page.getByRole('button', {
    name: /^(?:调整高亮终点|拖动以调整选区终点)$/
  })
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + 7, box.y + 7)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  if (cancel)
    await handle.dispatchEvent('pointercancel', {
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true
    })
  await page.mouse.up()
}
// Keep each browser journey sequential so assertions inspect the preceding user action.
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function runSelectionChecks(
  base,
  output,
  { pdfLayoutRelease = false } = {}
) {
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const format of ['epub', 'pdf'])
      for (const controlled of [true, false]) {
        if (
          (pdfLayoutRelease && format !== 'pdf') ||
          (process.env.READER_SELECTION_FORMAT &&
            format !== process.env.READER_SELECTION_FORMAT)
        )
          continue
        const page = await browser.newPage({
          viewport: { width: format === 'epub' ? 320 : 900, height: 800 },
          hasTouch: !pdfLayoutRelease || controlled
        })
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.setDefaultTimeout(10000)
        try {
          await page.goto(
            `${base}/demo/selection-harness.html${controlled ? '' : '?uncontrolled'}`
          )
          await page.getByLabel('Book', { exact: true }).setInputFiles(
            format === 'epub'
              ? {
                  name: 'selection.epub',
                  mimeType: 'application/epub+zip',
                  buffer: await selectionFixture()
                }
              : resolve('test/compat/fixtures/pdf/two-column.pdf')
          )
          if (format === 'epub') {
            await page.waitForFunction(() => {
              const button = document.querySelector('[aria-label=下一页]')
              return button && !button.disabled
            })
          } else await page.locator('.textLayer span').first().waitFor()
          await page.evaluate(async () => {
            await document.fonts.ready
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
          })
          if (pdfLayoutRelease) {
            await checkPdfSelectionRelease(page, controlled)
            results.push({ format, controlled, passed: true })
            continue
          }
          await selectText(
            page,
            format,
            [0, 1],
            format === 'epub' ? [1, 10] : [0, 5]
          )
          await expect(
            page.getByRole('toolbar', { name: '选区操作' })
          ).toBeVisible()
          if (format === 'epub' && controlled) {
            await assertCompactPalette(page)
          }
          await assertInside(page)
          await setColor(page, '#00ff00')
          // Pointerdown confirmation followed by a synthesized click on the replaced button.
          const button = await page
            .getByRole('button', { name: '高亮', exact: true })
            .elementHandle()
          await button.dispatchEvent('pointerdown', {
            pointerType: 'touch',
            pointerId: 7,
            bubbles: true,
            cancelable: true
          })
          await button.dispatchEvent('click', { bubbles: true })
          await page.getByRole('toolbar', { name: '高亮操作' }).waitFor()
          let data = await snapshot(page)
          assert.equal(
            data.events.filter((event) => event.type === 'add').length,
            1
          )
          assert.equal(data.ranges.length, 1)
          const first = data.ranges[0]
          assert.equal(
            first.markerStyle.backgroundColor,
            format === 'pdf' ? 'rgba(0, 255, 0, 0.35)' : '#00ff00'
          )
          if (format === 'epub') {
            assert.deepEqual(first.start, { selectionId: 'page-1', offset: 1 })
            assert.deepEqual(first.end, { selectionId: 'page-1', offset: 57 })
            assert.equal(
              first.text,
              'lpha bravo charlie delta echo.Second paragraph with repe'
            )
          }
          // Fresh selection must become a draft, including delayed controlled IDs.
          await selectText(
            page,
            format,
            format === 'epub' ? [1, 13] : [1, 1],
            format === 'epub' ? [1, 19] : [1, 10],
            true,
            format === 'pdf' ? 0.1 : 0.5
          )
          await page.getByRole('toolbar', { name: '选区操作' }).waitFor()
          await setColor(page, '#0000ff')
          assert.deepEqual((await snapshot(page)).ranges[0], first)
          await page.getByRole('button', { name: '高亮', exact: true }).click()
          await page.getByRole('toolbar', { name: '高亮操作' }).waitFor()
          data = await snapshot(page)
          assert.equal(data.ranges.length, 2)
          assert.equal(
            data.events.filter((event) => event.type === 'add').length,
            2
          )
          const second = data.ranges[1]
          assert.notEqual(second.id, first.id)
          await page.mouse.click(200, 500)
          await selectText(page, format, [0, 2], [0, 2])
          await page.getByRole('toolbar', { name: '高亮操作' }).waitFor()
          await page.waitForFunction(
            (id) =>
              JSON.parse(document.querySelector('#snapshot').textContent)
                .selected === id,
            first.id
          )
          await page.mouse.click(200, 500)
          await selectText(
            page,
            format,
            format === 'epub' ? [1, 15] : [1, 3],
            format === 'epub' ? [1, 15] : [1, 3]
          )
          await page.waitForFunction(
            (id) =>
              JSON.parse(document.querySelector('#snapshot').textContent)
                .selected === id,
            second.id
          )
          const before = await snapshot(page)
          await dragEndpoint(page, format, true)
          assert.deepEqual((await snapshot(page)).ranges, before.ranges)
          assert.equal(
            (await snapshot(page)).events.filter(
              (event) => event.type === 'update'
            ).length,
            before.events.filter((event) => event.type === 'update').length
          )
          await dragEndpoint(page, format)
          const after = await snapshot(page)
          assert.equal(after.ranges[1].id, second.id)
          assert.equal(after.ranges[1].createdAt, second.createdAt)
          assert.deepEqual(after.ranges[1].start, second.start)
          assert(after.ranges[1].end.offset > second.end.offset)
          assert.notEqual(after.ranges[1].text, second.text)
          assert.deepEqual(after.ranges[1].markerStyle, second.markerStyle)
          assert.equal(
            after.events.filter((event) => event.type === 'update').length,
            1
          )
          await page.getByRole('button', { name: 'Undo', exact: true }).click()
          assert.deepEqual((await snapshot(page)).ranges[1], second)
          await setCustomColor(page, '#ff0000')
          data = await snapshot(page)
          assert.deepEqual(data.ranges[0], first)
          assert.deepEqual(data.ranges[1], {
            ...second,
            markerStyle: { ...second.markerStyle, backgroundColor: '#ff0000' }
          })
          await page.getByRole('button', { name: 'Undo', exact: true }).click()
          assert.deepEqual((await snapshot(page)).ranges[1], second)
          await page.getByRole('button', { name: 'Redo', exact: true }).click()
          await page.mouse.click(200, 500)
          await selectText(
            page,
            format,
            format === 'epub' ? [1, 15] : [1, 3],
            format === 'epub' ? [1, 15] : [1, 3]
          )
          await page.getByRole('button', { name: '删除', exact: true }).click()
          await page
            .getByRole('toolbar', { name: '高亮操作' })
            .waitFor({ state: 'detached' })
          assert.deepEqual((await snapshot(page)).ranges, [first])
          await page.getByRole('button', { name: 'Undo', exact: true }).click()
          assert.equal((await snapshot(page)).ranges.length, 2)
          await page.getByRole('button', { name: 'Redo', exact: true }).click()
          assert.deepEqual((await snapshot(page)).ranges, [first])
          if (format === 'epub') {
            await page.mouse.click(200, 500)
            await selectText(page, format, [0, 2], [0, 2])
            await page.getByRole('toolbar', { name: '高亮操作' }).waitFor()
            for (const inset of [0, 170, 350]) {
              await page
                .locator('[data-testid=reader-root]')
                .evaluate((root, inset) => {
                  root.style.transform = `translateY(${inset}px)`
                }, inset)
              await assertInside(page)
            }
            await page.locator('[data-testid=reader-root]').evaluate((root) => {
              root.style.transform = ''
            })
          }
          await page.screenshot({
            path: resolve(
              output,
              `selection-${format}-${controlled ? 'controlled' : 'internal'}.png`
            )
          })
          const persisted = (await snapshot(page)).ranges
          if (format === 'epub') {
            await page
              .getByRole('button', { name: 'Font', exact: true })
              .click()
            await page.setViewportSize({ width: 390, height: 800 })
            assert.deepEqual((await snapshot(page)).ranges, persisted)
            await page
              .getByRole('button', { name: '下一页', exact: true })
              .click()
            await page.waitForFunction(() =>
              document
                .querySelector('foliate-view')
                .renderer.getContents()[0]
                .doc.body.textContent.includes('Another chapter')
            )
            await page
              .getByRole('button', { name: '上一页', exact: true })
              .click()
            await page.waitForFunction(() =>
              document
                .querySelector('foliate-view')
                .renderer.getContents()[0]
                .doc.body.textContent.includes('Alpha')
            )
            assert.deepEqual((await snapshot(page)).ranges, persisted)
            await page.evaluate(
              (ranges) =>
                sessionStorage.setItem(
                  'selection-harness:ranges',
                  JSON.stringify(ranges)
                ),
              persisted
            )
            await page.reload()
            await page.getByLabel('Book', { exact: true }).setInputFiles({
              name: 'selection.epub',
              mimeType: 'application/epub+zip',
              buffer: await selectionFixture()
            })
            await page.waitForFunction(() => {
              const button = document.querySelector('[aria-label=下一页]')
              return button && !button.disabled
            })
            assert.deepEqual((await snapshot(page)).ranges, persisted)
            await selectText(page, format, [0, 2], [0, 2])
            await page.getByRole('toolbar', { name: '高亮操作' }).waitFor()
          }
          assert.deepEqual(errors, [])
          results.push({
            format,
            controlled,
            passed: true,
            checks:
              'native mouse cross-node/reverse selection; draft isolation; touch pointer/click dedup; endpoint edit/cancel; color; full ID deletion; undo/redo; viewport bounds'
          })
        } catch (error) {
          await page.screenshot({
            path: resolve(output, `selection-${format}-failed.png`)
          })
          results.push({
            format,
            controlled,
            passed: false,
            failure: error.stack,
            errors,
            debug: await page.evaluate(() => ({
              snapshot: document.querySelector('#snapshot').textContent,
              native: document.getSelection()?.toString(),
              range: document.getSelection()?.rangeCount
                ? document.getSelection().getRangeAt(0).toString()
                : null,
              overlays: [...document.querySelectorAll('[data-range-id]')].map(
                (n) => ({
                  id: n.dataset.rangeId,
                  rect: n.getBoundingClientRect().toJSON()
                })
              )
            }))
          })
        } finally {
          await page.close()
        }
      }
    await capturePopoverThemes(browser, base, output)
    console.log(JSON.stringify({ selection: results }, null, 2))
    assert(
      results.every((result) => result.passed),
      'selection Popover acceptance failed'
    )
    return results
  } finally {
    await browser.close()
  }
}
if (process.argv[1] === import.meta.filename) {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
  const output = resolve(
    process.env.READER_SELECTION_OUTPUT ?? '../ham138-browser'
  )
  await mkdir(output, { recursive: true })
  await server.listen()
  try {
    await runSelectionChecks(
      `http://127.0.0.1:${server.httpServer.address().port}`,
      output,
      { pdfLayoutRelease: process.argv.includes('--pdf-layout-release') }
    )
  } finally {
    await server.close()
  }
}
