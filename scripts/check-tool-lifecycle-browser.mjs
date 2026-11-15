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
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/test/browser/workspace.html`
  )
  await page.waitForFunction(
    () => window.workspaceTest?.snapshot().phase === 'idle'
  )
  for (const key of ['a', 'b']) {
    await page.evaluate((key) => window.workspaceTest.select(key), key)
    await page.waitForFunction(
      () => window.workspaceTest.snapshot().phase === 'idle'
    )
    const before = await page.evaluate(() => {
      window.toolContainer = document.querySelector('[data-reader-workspace]')
      return {
        ...window.workspaceTest.stats(),
        timeOrigin: performance.timeOrigin,
        navigations: performance.getEntriesByType('navigation').length,
        data: window.workspaceTest.snapshot().data
      }
    })
    console.log('BEFORE', key, JSON.stringify(before))
    for (let i = 0; i < 10; i++) {
      for (const tool of ['绘图工具', '文字工具']) {
        await page
          .getByRole('button', { name: '工具菜单', exact: true })
          .click()
        if (i === 0)
          console.log('TOOLS', await page.locator('body').innerText())
        await page.getByRole('menuitem', { name: tool, exact: true }).click()
      }
    }
    const after = await page.evaluate(() => ({
      ...window.workspaceTest.stats(),
      timeOrigin: performance.timeOrigin,
      navigations: performance.getEntriesByType('navigation').length,
      sameContainer:
        window.toolContainer ===
        document.querySelector('[data-reader-workspace]'),
      data: window.workspaceTest.snapshot().data
    }))
    console.log('AFTER', key, JSON.stringify(after))
    assert.equal(after.timeOrigin, before.timeOrigin)
    assert.equal(after.navigations, before.navigations)
    assert.equal(after.sameContainer, true)
    assert.equal(after.engineMounts, before.engineMounts)
    assert.equal(after.engineDisposals, before.engineDisposals)
  }
} finally {
  await browser?.close()
  await server.close()
}
