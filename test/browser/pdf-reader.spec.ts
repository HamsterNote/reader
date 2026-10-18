import { expect, test, type Page } from '@playwright/test'
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  rgb
} from 'pdf-lib'

let bytes: Buffer
test.beforeAll(async ({ browser }) => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fixturePage = await browser.newPage()
  const raster = await fixturePage.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 360
    canvas.height = 480
    const context = canvas.getContext('2d')!
    context.fillStyle = '#f4f6f8'
    context.fillRect(0, 0, 360, 480)
    context.fillStyle = '#153b2d'
    context.font = '24px sans-serif'
    context.fillText('SCANNED PAGE', 30, 80)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await fixturePage.close()
  const image = await pdf.embedPng(Buffer.from(raster, 'base64'))
  for (let number = 1; number <= 8; number += 1) {
    const page = pdf.addPage([400, 520])
    if (number === 3) page.setRotation(degrees(90))
    if (number === 4) {
      page.drawImage(image, { x: 20, y: 20, width: 360, height: 480 })
      continue
    }
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 360,
      height: 480,
      color: rgb(0.96, 0.97, 0.98)
    })
    page.drawText(`Selectable PDF content page ${number}`, {
      x: 30,
      y: 450,
      size: 16,
      font
    })
    page.drawText('Local document. Original physical page.', {
      x: 30,
      y: 410,
      size: 12,
      font
    })
  }
  pdf.catalog.set(
    PDFName.of('OpenAction'),
    pdf.context.obj({
      S: PDFName.of('JavaScript'),
      JS: PDFString.of('fetch("https://pdf-canary.invalid/")')
    })
  )
  bytes = Buffer.from(await pdf.save())
})

const open = async (page: Page) => {
  page.on('pageerror', (error) => console.error('PDF page error:', error))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      console.error('PDF browser:', message.text())
  })
  page.on('requestfailed', (request) =>
    console.error('PDF request failed:', request.url(), request.failure())
  )
  await page.goto('/test/browser/pdf.html')
  await page
    .getByLabel('Open document')
    .setInputFiles({ name: 'renamed.epub', mimeType: '', buffer: bytes })
  await expect(page.getByTestId('source-state')).toHaveText('ready')
}

test('local PDF renders offline, navigates original pages and keeps canvas count bounded', async ({
  page
}, info) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith('http://127.0.0.1:5589/')
    )
      external.push(request.url())
  })
  await open(page)
  await expect(page.locator('.hn-pdf-counter')).toHaveText('1 / 8')
  const colors = await page
    .locator('[data-pdf-page="1"] canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      const colors = new Set<number>()
      for (let index = 0; index < data.length; index += 4)
        colors.add(
          (data[index] << 16) | (data[index + 1] << 8) | data[index + 2]
        )
      return colors.size
    })
  expect(colors).toBeGreaterThan(10)
  await page.getByRole('button', { name: 'Page 8', exact: true }).click()
  await expect(page.locator('.hn-pdf-counter')).toHaveText('8 / 8')
  await expect(
    page.getByRole('button', { name: 'Next page', exact: true })
  ).toBeDisabled()
  await expect(page.locator('[data-pdf-page="8"] .textLayer')).toContainText(
    'page 8'
  )
  expect(
    await page.locator('.hn-pdf-viewport canvas').count()
  ).toBeLessThanOrEqual(5)
  if (
    (await page
      .getByRole('button', { name: 'Pages', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Page 3', exact: true }).click()
  await expect(page.locator('[data-pdf-page="3"] .textLayer')).toContainText(
    'page 3'
  )
  await page.getByLabel('Zoom', { exact: true }).selectOption('1.5')
  await expect(page.locator('[data-pdf-page="3"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true'
  )
  const aligned = await page.locator('[data-pdf-page="3"]').evaluate((node) => {
    const canvas = node.querySelector('canvas')!
    const bounds = canvas.getBoundingClientRect()
    const text = node.querySelector('.textLayer span')!.getBoundingClientRect()
    const ratio = canvas.width / bounds.width
    const x = Math.max(0, Math.floor((text.left - bounds.left) * ratio))
    const y = Math.max(0, Math.floor((text.top - bounds.top) * ratio))
    const width = Math.min(canvas.width - x, Math.ceil(text.width * ratio))
    const height = Math.min(canvas.height - y, Math.ceil(text.height * ratio))
    if (width <= 0 || height <= 0) return false
    const data = canvas.getContext('2d')!.getImageData(x, y, width, height).data
    for (let index = 0; index < data.length; index += 4)
      if (data[index] < 100 && data[index + 1] < 100 && data[index + 2] < 100)
        return true
    return false
  })
  expect(aligned).toBe(true)
  await page.getByRole('button', { name: 'Rotate page', exact: true }).click()
  await expect(page.locator('[data-pdf-page="3"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true'
  )
  await page.getByLabel('Zoom', { exact: true }).selectOption('1')
  await expect(page.locator('[data-pdf-page="3"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true'
  )
  if (
    (await page
      .getByRole('button', { name: 'Pages', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Page 4', exact: true }).click()
  await expect(page.locator('[data-pdf-page="4"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true'
  )
  await expect(page.locator('[data-pdf-page="4"] .textLayer span')).toHaveCount(
    0
  )
  for (let turn = 0; turn < 3; turn += 1)
    await page.getByRole('button', { name: 'Rotate page', exact: true }).click()
  if (
    (await page
      .getByRole('button', { name: 'Pages', exact: true })
      .getAttribute('aria-expanded')) === 'false'
  )
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Page 1', exact: true }).click()
  await expect(page.locator('[data-pdf-page="1"]')).toHaveAttribute(
    'data-pdf-rendered',
    'true'
  )
  expect(external).toEqual([])
  await page.screenshot({ path: info.outputPath('pdf.png'), fullPage: true })
})

test('text selection survives menu suppression and placeholder clicks without mutations', async ({
  page,
  isMobile
}) => {
  await open(page)
  const span = page
    .locator('[data-pdf-page="1"] .textLayer span')
    .filter({ hasText: 'Selectable PDF' })
    .first()
  await expect(span).toBeVisible()
  if (!isMobile) {
    const bounds = await span.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      bounds!.x + bounds!.width - 2,
      bounds!.y + bounds!.height / 2,
      { steps: 12 }
    )
    await page.mouse.up()
  } else
    await span.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
  await expect(
    page.getByRole('button', { name: '高亮', exact: true })
  ).toBeVisible()
  const menuDenied = await span.evaluate(
    (node) =>
      !node.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      )
  )
  expect(menuDenied).toBe(true)
  const text = await page.evaluate(() => window.getSelection()!.toString())
  await page
    .getByRole('button', { name: '高亮', exact: true })
    .click({ clickCount: 2 })
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(
    text
  )
  expect(await page.evaluate(() => window.pdfEvidence.mutations)).toBe(0)
  await page.locator('.hn-pdf-viewport').evaluate((node) => {
    node.scrollTop = 100
    node.dispatchEvent(new Event('scroll'))
  })
  await expect(
    page.getByRole('button', { name: '高亮', exact: true })
  ).toHaveCount(0)
})

test('corrupt replacement clears old content and cleanup preserves the host blob URL', async ({
  page
}) => {
  await open(page)
  const hostUrl = await page.evaluate(() => window.pdfEvidence.hostUrl!)
  await page.getByLabel('Open document').setInputFiles({
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-invalid')
  })
  await expect(page.getByTestId('source-state')).toHaveText('error')
  await expect(page.locator('.hn-pdf-viewport canvas')).toHaveCount(0)
  expect(
    await page.evaluate(async (uri) => (await fetch(uri)).ok, hostUrl)
  ).toBe(true)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByTestId('source-state')).toHaveText('idle')
  await expect(page.getByTestId('pdf-reader')).toHaveCount(0)
})
