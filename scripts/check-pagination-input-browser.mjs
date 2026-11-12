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
const count = (page) => page.getByTestId('count').textContent().then(Number)
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 480, height: 400 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/test/browser/pagination-input.html`
  )
  const next = page.getByLabel('下一页', { exact: true })
  await next.waitFor()

  // 1. Repagination disables the control mid-press; release replays once and must
  //    not suppress keyboard/programmatic activation that has no pointer sequence.
  const box = await next.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.evaluate(() => document.getElementById('disable').click())
  // Release while the control is still disabled: the browser dispatches no
  // native click, so a stale suppression mark would otherwise eat the next
  // keyboard activation.
  await page.mouse.up()
  await page.evaluate(() => document.getElementById('enable').click())
  await page.waitForFunction(
    () => document.querySelector('[data-testid="count"]')?.textContent === '1'
  )
  assert.equal(await count(page), 1, 'replayed press must count once')

  await next.focus()
  await page.keyboard.press('Enter')
  assert.equal(await count(page), 2, 'Enter after replay must page')
  await page.keyboard.press('Space')
  assert.equal(await count(page), 3, 'Space after replay must page')
  await page.evaluate(() => {
    const button = document.querySelector('[aria-label="下一页"]')
    if (!(button instanceof HTMLButtonElement))
      throw new Error('missing button')
    button.click()
  })
  assert.equal(
    await count(page),
    4,
    'programmatic click after replay must page'
  )
  console.log(
    'PASS disabled-release replay then Enter/Space/programmatic click each advance once'
  )

  // 2. Real pointer capture: press, leave the control, release. The captured click
  //    must be swallowed; keyboard must remain usable afterwards.
  await page.reload()
  await next.waitFor()
  const second = await next.boundingBox()
  await page.mouse.move(
    second.x + second.width / 2,
    second.y + second.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(4, 4)
  await page.mouse.up()
  await page.waitForTimeout(100)
  assert.equal(
    await count(page),
    0,
    'release outside the control must not page'
  )
  await next.focus()
  await page.keyboard.press('Enter')
  assert.equal(
    await count(page),
    1,
    'keyboard remains usable after an outside release'
  )
  console.log(
    'PASS pointer capture press -> leave -> release counts 0 and keyboard still pages'
  )

  assert.deepEqual(errors, [])
  console.log(
    '2 passed / 0 failed; real Chromium pointer + keyboard regression'
  )
} finally {
  await browser?.close()
  await server.close()
}
