import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const server = await createServer({
  configFile: false,
  root: repo,
  plugins: [react()],
  server: { host: '127.0.0.1', port: 0 }
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/test/browser/pdf-inset.html`
  )
  const pageBox = page.locator('.pdfViewer .page').first()
  await pageBox.waitFor({ timeout: 30_000 })
  const measure = async () =>
    page.evaluate(() => {
      const container = document.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      const viewer = document.querySelector(
        '.hamster-reader__pdf-viewer-container > .pdfViewer'
      )
      const page = document.querySelector('.pdfViewer .page')
      if (!container || !viewer || !page) throw new Error('missing pdf nodes')
      const c = container.getBoundingClientRect()
      const p = page.getBoundingClientRect()
      return {
        paddingTop: getComputedStyle(viewer).paddingTop,
        gap: p.top - c.top
      }
    })
  const fortyFour = await measure()
  assert.equal(fortyFour.paddingTop, '44px')
  assert(
    Math.abs(fortyFour.gap - 44) <= 1,
    `44/44 gap expected 44, got ${fortyFour.gap}`
  )
  await page.getByRole('button', { name: 'zero', exact: true }).click()
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector(
          '.hamster-reader__pdf-viewer-container > .pdfViewer'
        )
      ).paddingTop === '0px'
  )
  const zero = await measure()
  assert.equal(zero.paddingTop, '0px')
  assert(Math.abs(zero.gap) <= 1, `0/44 gap expected 0, got ${zero.gap}`)
  assert.deepEqual(errors, [])
  console.log(
    `PASS real page element: top=44/header=44 -> padding 44px gap ${fortyFour.gap.toFixed(2)}; residual 0 -> padding 0px gap ${zero.gap.toFixed(2)}`
  )
} finally {
  await browser?.close()
  await server.close()
}
