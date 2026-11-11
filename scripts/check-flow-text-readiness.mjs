import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const repo = resolve(import.meta.dirname, '..')
const server = await createServer({
  root: repo,
  resolve: {
    alias: [
      {
        find: /^@hamster-note\/reader$/,
        replacement: resolve(repo, 'dist/index.js')
      },
      {
        find: /^@hamster-note\/reader\/style\.css$/,
        replacement: resolve(repo, 'dist/style.css')
      }
    ]
  },
  server: { host: '127.0.0.1', port: 0 }
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 320, height: 740 } })
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('PAGE ERROR', error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('BROWSER', message.text())
  })
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/test/browser/flow-text.html`
  )
  await page.waitForFunction(() => window.flowTextTest)
  for (const long of [false, true]) {
    for (const kind of ['txt', 'epub', 'txt']) {
      const previous = await page.evaluate(
        () => window.flowTextTest.state.ready.length
      )
      await page.evaluate(
        ({ kind, long }) => window.flowTextTest.open(kind, long),
        { kind, long }
      )
      await page
        .waitForFunction(
          (previous) => window.flowTextTest.state.ready.length === previous + 1,
          previous,
          { timeout: 5000 }
        )
        .catch(async (error) => {
          console.error(
            await page.evaluate(() => ({
              state: window.flowTextTest.state,
              html: document.body.innerText.slice(0, 2000)
            }))
          )
          throw error
        })
      await page
        .getByText(`${kind} restored page 2`, { exact: !long })
        .waitFor()
      await page.evaluate(() =>
        Promise.race([
          window.flowTextTest.flush(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Public progress flush did not settle')),
              3000
            )
          )
        ])
      )
      console.log(
        `PASS ${kind} compatibility text (${long ? 'scrollable' : 'fits viewport'}): restored page 2, engine ready, public progress flush`
      )
    }
  }
  for (const layout of ['native', 'paper']) {
    const previous = await page.evaluate(
      () => window.flowTextTest.state.ready.length
    )
    await page.evaluate(
      (layout) => window.flowTextTest.open('txt', false, layout),
      layout
    )
    await page.waitForFunction(
      (previous) => window.flowTextTest.state.ready.length === previous + 1,
      previous
    )
    await page.evaluate(() =>
      Promise.race([
        window.flowTextTest.flush(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Layout flush did not settle')),
            3000
          )
        )
      ])
    )
    assert.equal(
      await page.evaluate(() => {
        const data = window.flowTextTest.state.data
        return (
          data?.layoutReadingProgress?.pageNumber ??
          data?.virtualPaper?.anchor?.pageNumber
        )
      }),
      2
    )
    const restored = await page
      .locator('.virtual-paper-wrapper [data-page-number="2"]')
      .first()
      .boundingBox()
    assert.ok(
      restored && restored.y < 740 && restored.y + restored.height > 0,
      'Restored page must intersect the actual viewport'
    )
    console.log(
      `PASS compatibility layout (${layout}): restored page 2, engine ready, public progress flush`
    )
  }
  await page.screenshot({
    path: resolve(repo, '../artifacts/reader-flow-readiness-320.png')
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(
    await page.evaluate(() => window.flowTextTest.state.errors),
    []
  )
  console.log('8 passed / 0 failed; 320px; public built artifact')
} finally {
  await browser?.close()
  await server.close()
}
