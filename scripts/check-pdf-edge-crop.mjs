import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, 'test-results/pdf-edge-crop')
await mkdir(output, { recursive: true })
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (let number = 1; number <= 3; number++) {
  const rotated = number === 3
  const sheet = pdf.addPage(rotated ? [920, 680] : [680, 920])
  // Non-zero native CropBox: Reader ratios refer to the visible page, not MediaBox.
  sheet.setCropBox(40, 60, rotated ? 800 : 600, rotated ? 600 : 800)
  if (rotated) sheet.setRotation(degrees(90))
  sheet.drawRectangle({
    x: 40,
    y: 60,
    width: 600,
    height: 800,
    color: rgb(0.9, 0.95, 1)
  })
  for (let line = 0; line < 30; line++) {
    sheet.drawText(
      `PAGE ${number} LINE ${String(line).padStart(2, '0')} crop reference`,
      {
        x: 100,
        y: 800 - line * 22,
        size: 14,
        font
      }
    )
  }
}
const bytes = Buffer.from(await pdf.save())
await writeFile(resolve(output, 'crop.pdf'), bytes)
const server = await createServer({
  root: repo,
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'pdf-edge-crop-fixture',
      configureServer(server) {
        server.middlewares.use('/crop.pdf', (_request, response) => {
          response.setHeader('Content-Type', 'application/pdf')
          response.end(bytes)
        })
        server.middlewares.use('/pdf-edge-crop', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(
            await server.transformIndexHtml(
              '/pdf-edge-crop',
              '<html><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/pdf-edge-crop-harness.jsx"></script></body></html>'
            )
          )
        })
      }
    }
  ]
})
let browser
const report = { checks: [], errors: [] }
const globalCrop = { top: 0.1, right: 0.2, bottom: 0.15, left: 0.05 }
const override = { top: 0.2, right: 0.05, bottom: 0.1, left: 0.15 }
const close = (actual, expected, message) =>
  assert(
    Math.abs(actual - expected) < 2,
    `${message}: ${actual} vs ${expected}`
  )
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/pdf-edge-crop`
  )
  await page
    .locator('.pdfViewer [data-selection-start-offset]')
    .first()
    .waitFor()
  const zoom = async (label) => {
    await page.getByTestId('tool-bottom-bar-layout-zoom').click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  await zoom('100%')
  const measure = () =>
    page.evaluate(() => {
      const host = document.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      const sheets = [...document.querySelectorAll('.pdfViewer .page')].map(
        (sheet) => {
          const rect = sheet.getBoundingClientRect()
          return {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            display: sheet.style.display
          }
        }
      )
      return {
        sheets,
        scrollWidth: host.scrollWidth,
        width: host.clientWidth,
        scrollHeight: host.scrollHeight,
        minWidth: host.querySelector('.pdfViewer').style.minWidth,
        hiddenPages: window.pdfCropTest.data.hiddenPages
      }
    })
  const update = async (edgeCrop, editing = false) => {
    await page.evaluate(
      ({ edgeCrop, editing }) => {
        window.pdfCropTest.setData((data) => ({ ...data, edgeCrop }))
        window.pdfCropTest.setEditing(editing)
      },
      { edgeCrop, editing }
    )
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    )
  }
  const baseline = await measure()
  await page.screenshot({ path: resolve(output, 'uncropped.png') })
  await update({ all: globalCrop })
  const cropped = await measure()
  await page.screenshot({ path: resolve(output, 'cropped.png') })
  const first = cropped.sheets[0]
  const second = cropped.sheets[1]
  // Measure visible edges using the original full page rect as an independent oracle.
  close(
    second.top +
      second.height * globalCrop.top -
      (first.top + first.height * (1 - globalCrop.bottom)),
    10,
    'cropped page gap'
  )
  close(
    first.top + first.height * globalCrop.top,
    baseline.sheets[0].top,
    'top crop removed from layout'
  )
  close(
    first.left + first.width * globalCrop.left,
    (cropped.width - first.width * (1 - globalCrop.left - globalCrop.right)) /
      2,
    'asymmetric horizontal crop centered'
  )
  report.checks.push({
    name: 'four edges remove occupied layout space',
    baseline,
    cropped
  })
  await update(undefined)
  const restored = await measure()
  close(
    restored.scrollHeight,
    baseline.scrollHeight,
    'disable restores document height'
  )
  report.checks.push({ name: 'crop toggle restores original layout' })

  for (const edge of ['top', 'right', 'bottom', 'left']) {
    await update({ all: { [edge]: 0.2 } })
    const current = await measure()
    const sheet = current.sheets[0]
    if (edge === 'top' || edge === 'bottom') {
      close(
        current.sheets[1].top - sheet.top,
        sheet.height * 0.8 + 10,
        `${edge} reduces page advance`
      )
    } else {
      close(
        sheet.left + (edge === 'left' ? sheet.width * 0.2 : 0),
        (current.width - sheet.width * 0.8) / 2,
        `${edge} changes visible horizontal bounds`
      )
    }
    report.checks.push({ name: `${edge} edge independently applied` })
  }
  await update({ all: globalCrop, pages: { 'page-2': override } })
  const overridden = await measure()
  close(
    overridden.sheets[1].top +
      overridden.sheets[1].height * override.top -
      (overridden.sheets[0].top +
        overridden.sheets[0].height * (1 - globalCrop.bottom)),
    10,
    'page override replaces global crop'
  )
  const rotated = overridden.sheets[2]
  close(
    rotated.left + rotated.width * globalCrop.left,
    (overridden.width - rotated.width * 0.75) / 2,
    'rotated page uses visual left/right'
  )
  report.checks.push({
    name: 'page override and rotated native CropBox',
    overridden
  })
  await page.evaluate(() => window.pdfCropTest.setBrowserOpen(true))
  await page.getByTestId('page-browser-page-2').click()
  await page.evaluate(() => window.pdfCropTest.setBrowserOpen(false))
  const jumped = await measure()
  close(
    jumped.sheets[1].top + jumped.sheets[1].height * override.top,
    0,
    'page jump starts at visible cropped top'
  )
  report.checks.push({ name: 'page browser jump aligns cropped page top' })

  // Real Reader editing controls: full page while editing, all four drag handles.
  await page.setViewportSize({ width: 1200, height: 1500 })
  await page
    .locator('.hamster-reader__pdf-viewer-container')
    .evaluate((host) => {
      host.scrollTop = 0
    })
  await page.getByTestId('tool-bottom-bar-edge-crop').click()
  await page.getByTestId('edge-crop-line-top').first().waitFor()
  const editing = await measure()
  close(
    editing.sheets[1].top - editing.sheets[0].top,
    editing.sheets[0].height + 10,
    'editing restores full page'
  )
  const target = { top: 0.12, right: 0.08, bottom: 0.18, left: 0.16 }
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    const handle = page.getByTestId(`edge-crop-line-${edge}`).first()
    const box = await handle.boundingBox()
    const sheet = (await measure()).sheets[0]
    const horizontal = edge === 'top' || edge === 'bottom'
    const start = horizontal
      ? { x: sheet.left + sheet.width * 0.3, y: box.y + box.height / 2 }
      : { x: box.x + box.width / 2, y: sheet.top + sheet.height * 0.3 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    const targetX =
      sheet.left +
      sheet.width * (edge === 'left' ? target.left : 1 - target.right)
    const targetY =
      sheet.top +
      sheet.height * (edge === 'top' ? target.top : 1 - target.bottom)
    await page.mouse.move(
      horizontal ? start.x : targetX,
      horizontal ? targetY : start.y,
      { steps: 5 }
    )
    await page.mouse.up()
  }
  await page.getByTestId('edge-crop-apply-page').first().click()
  await page
    .getByTestId('edge-crop-line-top')
    .first()
    .waitFor({ state: 'detached' })
  const saved = await page.evaluate(
    () => window.pdfCropTest.data.edgeCrop.pages['page-1']
  )
  for (const edge of Object.keys(target))
    close(saved[edge] * 100, target[edge] * 100, `drag persists ${edge}`)
  await page.getByTestId('tool-bottom-bar-edge-crop').click()
  await page.getByTestId('edge-crop-apply-all').first().click()
  await page
    .getByTestId('edge-crop-line-top')
    .first()
    .waitFor({ state: 'detached' })
  const appliedAll = await page.evaluate(() => window.pdfCropTest.data.edgeCrop)
  assert.deepEqual(appliedAll, { all: saved })
  report.checks.push({
    name: 'toolbar toggle, four real pointer drags, apply page and apply all',
    saved
  })

  await update({ all: globalCrop })
  await page
    .locator('.hamster-reader__pdf-viewer-container')
    .evaluate((host) => {
      host.scrollTop = 0
    })
  const span = page
    .locator('.pdfViewer [data-selection-start-offset]')
    .filter({ hasText: 'PAGE 1 LINE 05' })
    .first()
  await span.evaluate((span) => {
    const range = document.createRange()
    range.selectNodeContents(span)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  await page
    .locator('.hamster-reader__pdf-highlight-rect')
    .first()
    .waitFor({ state: 'attached' })
  const textBounds = await span.evaluate((span) => {
    const range = document.createRange()
    range.selectNodeContents(span)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y }
  })
  const highlightBounds = await page
    .locator('.hamster-reader__pdf-highlight-rect')
    .first()
    .boundingBox()
  close(highlightBounds.x, textBounds.x, 'highlight x aligned after crop')
  close(highlightBounds.y, textBounds.y, 'highlight y aligned after crop')
  report.checks.push({
    name: 'native text selection and persisted highlight align after crop'
  })

  for (const label of ['50%', '200%']) {
    await zoom(label)
    const scaled = await measure()
    const [a, b] = scaled.sheets
    close(
      b.top +
        b.height * globalCrop.top -
        (a.top + a.height * (1 - globalCrop.bottom)),
      10,
      `${label} page gap`
    )
    report.checks.push({ name: `crop survives ${label} zoom` })
  }
  // All three pages have equal visual dimensions, including the rotated page.
  await zoom('适配宽度')
  for (const width of [1200, 480]) {
    await page.setViewportSize({ width, height: 900 })
    await page
      .waitForFunction(() => {
        const host = document.querySelector(
          '.hamster-reader__pdf-viewer-container'
        )
        const sheet = host.querySelector('.page')
        return (
          Math.abs(
            sheet.getBoundingClientRect().width * 0.75 - host.clientWidth
          ) < 2 && host.scrollWidth === host.clientWidth
        )
      })
      .catch(async (error) => {
        report.failedFit = await measure()
        throw error
      })
    const fitted = await measure()
    close(
      fitted.sheets[0].width * 0.75,
      fitted.width,
      'fit-width uses cropped width'
    )
    close(fitted.scrollWidth, fitted.width, 'no discarded horizontal overflow')
    await page.screenshot({ path: resolve(output, `fit-${width}.png`) })
    report.checks.push({
      name: `cropped fit-width and resize at ${width}px`,
      fitted
    })
  }
  await update(undefined)
  await page.waitForFunction(() => {
    const host = document.querySelector('.hamster-reader__pdf-viewer-container')
    return (
      Math.abs(
        host.querySelector('.page').getBoundingClientRect().width -
          host.clientWidth
      ) < 2
    )
  })
  report.checks.push({ name: 'disabling crop recalculates fit-width' })
  assert.deepEqual(report.errors, [])
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
console.log(JSON.stringify(report, null, 2))
