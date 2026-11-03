import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../painting-reader-browser')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: repo,
  server: { host: '127.0.0.1', port: 0 }
})
const packageVersion = JSON.parse(
  await readFile(
    resolve(repo, 'node_modules/@hamster-note/painting/package.json'),
    'utf8'
  )
).version
const report = { packageVersion, cases: [], errors: [] }
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  for (const dpr of [1, 2, 3]) {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 850 },
      deviceScaleFactor: dpr
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => report.errors.push(error.message))
    await page.goto(
      `http://127.0.0.1:${address.port}/test/browser/painting.html`
    )
    for (const scale of [0.5, 1, 2]) {
      const beforeScale = await page.locator('#paintings').textContent()
      await page
        .getByRole('button', { name: `scale ${scale}`, exact: true })
        .click()
      const overlay = page.getByTestId('pdf-overlay-page-1')
      const surface = overlay.getByTestId('page-drawing-surface')
      await surface.waitFor({ state: 'visible' })
      await page.waitForFunction((expected) => {
        const ink = document.querySelector(
          '[data-testid="pdf-overlay-page-1"] [data-testid="layered-surface"]'
        )
        return (
          ink &&
          Math.abs(
            Number(ink.style.transform.match(/matrix\(([^,]+)/)?.[1]) -
              (expected * 4) / 3
          ) < 0.01
        )
      }, scale)
      assert.equal(
        await page.locator('#paintings').textContent(),
        beforeScale,
        'zoom must not rewrite stored points'
      )
      for (const scroll of [false, true]) {
        const container = page.locator('.hamster-reader__pdf-viewer-container')
        if (scroll)
          await container.evaluate((element) => {
            element.scrollTop = 80
            element.scrollLeft = 40
          })
        else
          await container.evaluate((element) => {
            element.scrollTop = 0
            element.scrollLeft = 0
          })
        const box = await surface.boundingBox()
        const x = box.x + Math.min(box.width * 0.3, 220)
        const y = Math.max(80, box.y + Math.min(box.height * 0.3, 180))
        const before = await page.locator('#paintings').textContent()
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + 20, y + 10, { steps: 4 })
        await page.mouse.up()
        await page.waitForFunction(
          (previous) =>
            document.querySelector('#paintings').textContent !== previous,
          before
        )
        const measured = await surface.evaluate((element) => {
          const data = JSON.parse(
            document.querySelector('#paintings').textContent
          )['page-1']
          const object = data.objects.at(-1)
          const node = element.querySelector(
            `[data-object-id="${object.objectId}"]`
          )
          const point = new DOMPoint(
            object.samples[0].x,
            object.samples[0].y
          ).matrixTransform(node.getScreenCTM())
          return {
            x: point.x,
            y: point.y,
            color: object.brushSnapshot.color,
            background: getComputedStyle(
              element.querySelector('[data-testid="layered-surface"]')
            ).backgroundColor
          }
        })
        const error = Math.hypot(measured.x - x, measured.y - y)
        assert(
          error <= 1,
          `DPR ${dpr}, scale ${scale}, scroll ${scroll}: ${error}px`
        )
        assert.equal(measured.color, '#d02080')
        assert.equal(measured.background, 'rgba(0, 0, 0, 0)')
        report.cases.push({ dpr, scale, scroll, error })
      }
    }
    const saved = await page.locator('#paintings').textContent()
    await page.getByRole('button', { name: 'page 2', exact: true }).click()
    await page.getByTestId('pdf-overlay-page-2').waitFor({ state: 'visible' })
    assert.equal(
      await page.locator('#paintings').textContent(),
      saved,
      'navigation must not rewrite document points'
    )
    await page
      .getByRole('button', { name: 'toggle input', exact: true })
      .click()
    await page.getByRole('button', { name: 'remount', exact: true }).click()
    await page.getByTestId('pdf-overlay-page-1').waitFor({ state: 'attached' })
    await page
      .waitForFunction(
        () =>
          document.querySelector(
            '[data-testid="pdf-overlay-page-1"] [data-object-id]'
          ),
        undefined,
        { timeout: 1500 }
      )
      .catch(() => null)
    const readOnlyCount = await page
      .getByTestId('pdf-overlay-page-1')
      .locator('[data-object-id]')
      .count()
    report.cases.push({ dpr, disabledRemount: readOnlyCount > 0 })
    await context.close()
  }
  assert.deepEqual(report.errors, [])
  assert(
    report.cases
      .filter((item) => 'disabledRemount' in item)
      .every((item) => item.disabledRemount),
    'disabled remount must display saved ink'
  )
} catch (error) {
  report.failure = error.message
  process.exitCode = 1
} finally {
  await browser?.close()
  await server.close()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report, null, 2))
}
