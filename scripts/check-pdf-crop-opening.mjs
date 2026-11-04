import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, 'test-results/pdf-crop-opening')
await mkdir(output, { recursive: true })
const server = process.env.PDF_CROP_DEMO_URL
  ? null
  : await createServer({
      root: repo,
      server: { host: '127.0.0.1', port: 0 }
    })
let browser
const report = { checks: [], errors: [] }
try {
  await server?.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 }
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(
    process.env.PDF_CROP_DEMO_URL ??
      `http://127.0.0.1:${server.httpServer.address().port}`
  )
  await page
    .getByTestId('file-input')
    .setInputFiles(resolve(repo, 'test/compat/fixtures/pdf/two-column.pdf'))
  await page.getByRole('button', { name: '加载文件', exact: true }).click()
  await page
    .locator('.pdfViewer [data-selection-start-offset]')
    .first()
    .waitFor()
  await page.getByTestId('tool-bottom-bar-layout-zoom').click()
  await page.getByRole('menuitem', { name: '适配宽度', exact: true }).click()
  const host = page.locator('.hamster-reader__pdf-viewer-container')
  const toggle = page.getByTestId('global-edge-crop-toggle')
  const row = page
    .locator('.pdfViewer [data-selection-start-offset]')
    .filter({ hasText: 'Second page continues the article' })
    .first()
  const settle = () =>
    page.evaluate(async () => {
      for (let frame = 0; frame < 12; frame++)
        await new Promise((done) => requestAnimationFrame(done))
    })
  const measure = () =>
    row.evaluate((span) => {
      const host = span.closest('.hamster-reader__pdf-viewer-container')
      const range = document.createRange()
      range.selectNodeContents(span)
      const sheets = [...host.querySelectorAll('.page')].map((sheet) => {
        const rect = sheet.getBoundingClientRect()
        const cropTop = parseFloat(
          sheet.style.clipPath.match(/[\d.]+/)?.[0] ?? 0
        )
        return { top: rect.top, height: rect.height, cropTop }
      })
      return {
        rowTop: range.getBoundingClientRect().top,
        scrollTop: host.scrollTop,
        hostTop: host.getBoundingClientRect().top,
        sheets
      }
    })
  await settle()
  for (const offset of [0, 100, 200]) {
    await host.evaluate((host, offset) => {
      host.scrollTop = host.scrollHeight - host.clientHeight - offset
    }, offset)
    await settle()
    for (
      let cycle = 0;
      cycle < Number(process.env.PDF_CROP_CYCLES ?? 3);
      cycle++
    ) {
      const before = await measure()
      if (!offset && !cycle)
        await page.screenshot({ path: resolve(output, 'before.png') })
      await toggle.check()
      await settle()
      const enabled = await measure()
      if (!offset && !cycle)
        await page.screenshot({ path: resolve(output, 'enabled.png') })
      report.checks.push({ offset, cycle, before, enabled })
      assert(
        Math.abs(enabled.rowTop - before.rowTop) < 2,
        `opening crop, offset ${offset}: ${before.rowTop} -> ${enabled.rowTop}`
      )
      await toggle.uncheck()
      await settle()
      const disabled = await measure()
      report.checks.at(-1).disabled = disabled
      assert(
        Math.abs(disabled.rowTop - before.rowTop) < 2,
        `closing crop, offset ${offset}: ${before.rowTop} -> ${disabled.rowTop}`
      )
    }
  }
  await toggle.check()
  await settle()
  const beforeInsets = await measure()
  await page.getByTestId('contain-margin-top-input').fill('40')
  await settle()
  const topInset = await measure()
  assert(Math.abs(topInset.rowTop - beforeInsets.rowTop - 40) < 2)
  await page.getByTestId('contain-margin-bottom-input').fill('64')
  await settle()
  const bottomInset = await measure()
  assert(Math.abs(bottomInset.rowTop - topInset.rowTop) < 2)
  report.checks.push({
    name: 'visible row offset survives insets',
    beforeInsets,
    topInset,
    bottomInset
  })
  await page.getByTestId('contain-margin-top-input').fill('0')
  await page.getByTestId('contain-margin-bottom-input').fill('0')
  await toggle.uncheck()
  await settle()
  await host.evaluate((host) => {
    host.scrollTop = 0
  })
  await settle()
  await toggle.check()
  await settle()
  const top = await measure()
  report.checks.push({
    name: 'document start clamps to visible cropped edge',
    top
  })
  assert.equal(top.scrollTop, 0)
  assert(Math.abs(top.sheets[0].top + top.sheets[0].cropTop - top.hostTop) < 2)
  await page.screenshot({ path: resolve(output, 'document-top.png') })
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.failure = String(error)
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0]
    if (page)
      report.body = (await page.locator('body').innerText()).slice(0, 2000)
  }
  throw error
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server?.close()
}
console.log(JSON.stringify(report, null, 2))
