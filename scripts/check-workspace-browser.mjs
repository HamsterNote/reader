import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../artifacts/reader-workspace-browser')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: repo,
  server: { host: '127.0.0.1', port: 0 }
})
const report = { cases: [], errors: [] }
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 800, height: 900 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/test/browser/workspace.html`
  )
  const idle = (key) =>
    page.waitForFunction(
      (key) =>
        window.workspaceTest?.snapshot().phase === 'idle' &&
        window.workspaceTest.snapshot().currentFileKey === key,
      key,
      { timeout: 45000 }
    )
  await idle('a')
  await page.locator('.pdfViewer .page[data-page-number="8"]').waitFor()
  const initial = await page.evaluate(() => {
    window.__container = document.querySelector('[data-reader-workspace]')
    window.__mountId = crypto.randomUUID()
    return {
      mountId: window.__mountId,
      navigationCount: performance.getEntriesByType('navigation').length
    }
  })
  await page.evaluate(() => window.workspaceTest.select('b'))
  await idle('b')
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page
    .locator('.hamster-reader__page-browser')
    .waitFor({ state: 'visible' })
  await page.screenshot({ path: resolve(output, 'epub-outline.png') })
  await page.evaluate(() => window.workspaceTest.select('a'))
  await idle('a')
  const roundtrip = await page.evaluate(() => ({
    sameContainer:
      window.__container === document.querySelector('[data-reader-workspace]'),
    mountId: window.__mountId,
    navigationCount: performance.getEntriesByType('navigation').length,
    data: window.workspaceTest.snapshot().data,
    log: window.workspaceTest.log,
    stats: window.workspaceTest.stats()
  }))
  assert.equal(roundtrip.sameContainer, true)
  assert.equal(roundtrip.mountId, initial.mountId)
  assert.equal(roundtrip.navigationCount, initial.navigationCount)
  assert.equal(roundtrip.data.layoutReadingProgress.pageNumber, 8)
  assert.equal(roundtrip.stats.engineMounts, 3)
  assert.equal(roundtrip.stats.engineDisposals, 2)
  report.cases.push({
    name: 'A.pdf → B.epub → A.pdf keeps container and page 8 position',
    ...roundtrip
  })
  // Safe areas replace env, toolbar migration preserves the document engine.
  await page.evaluate(() =>
    window.workspaceTest.setLayout({
      edge: 'top',
      insets: { top: 24, bottom: 0, left: 0, right: 0 },
      headerContentInset: 44
    })
  )
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-toolbar-edge="top"]')
        ?.getBoundingClientRect().top === 60
  )
  const geometry = await page.evaluate(() => ({
    top: document
      .querySelector('[data-toolbar-edge="top"]')
      .getBoundingClientRect().top,
    stats: window.workspaceTest.stats()
  }))
  assert.equal(geometry.stats.engineMounts, 3)
  await page.screenshot({ path: resolve(output, 'top-toolbar-safe-area.png') })
  report.cases.push({
    name: 'top inset max(24,44)+16, migration preserves engine',
    ...geometry
  })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const menu = page.getByRole('menu', { name: '文件列表' })
  await menu.waitFor()
  const rect = await menu.boundingBox()
  assert(rect.x >= 0 && rect.x + rect.width <= 320)
  await page.screenshot({ path: resolve(output, 'narrow-file-menu.png') })
  await page.keyboard.press('Escape')
  report.cases.push({ name: '320px pane file menu stays within bounds', rect })
  const tools = page.getByRole('button', { name: '工具菜单', exact: true })
  await tools.click()
  await page.getByRole('dialog', { name: '选择工具', exact: true }).waitFor()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await menu.waitFor()
  assert.equal(
    await page.getByRole('dialog', { name: '选择工具', exact: true }).count(),
    0
  )
  await tools.click()
  await page.getByRole('dialog', { name: '选择工具', exact: true }).waitFor()
  assert.equal(await menu.count(), 0)
  await page.keyboard.press('Escape')
  report.cases.push({
    name: 'reader file and tool menus exclude each other in both directions'
  })
  await page.evaluate(() => {
    window.workspaceTest.config.failSave = true
  })
  const saveFailure = await page.evaluate(() =>
    window.workspaceTest.select('b')
  )
  assert.equal(saveFailure.status, 'failed')
  assert.equal(
    await page.evaluate(() => window.workspaceTest.snapshot().currentFileKey),
    'a'
  )
  assert.equal(
    await page.evaluate(() => window.workspaceTest.stats().engineDisposals),
    2
  )
  report.cases.push({
    name: 'save NACK keeps original engine/current file',
    result: saveFailure
  })
  await page.evaluate(() => {
    window.workspaceTest.config.failSave = false
  })
  const loadFailure = await page.evaluate(() =>
    window.workspaceTest.select('broken')
  )
  assert.equal(loadFailure.status, 'failed')
  assert.equal(
    await page.evaluate(
      () =>
        window.workspaceTest.log.filter((event) => event[0] === 'reload').length
    ),
    1
  )
  await page.getByRole('button', { name: '从存储重开原文件' }).click()
  await idle('a')
  report.cases.push({
    name: 'load failure calls host reload once, original reopens from storage'
  })
  for (const key of ['hnn', 'hpb']) {
    await page.evaluate((key) => window.workspaceTest.select(key), key)
    await idle(key)
    assert.equal(
      await page.evaluate(
        (key) =>
          window.workspaceTest.log.filter(
            (event) =>
              event[0] === 'handover' && event[1] === key && event[2] === 'left'
          ).length,
        key
      ),
      1
    )
    await page.evaluate(() => window.workspaceTest.select('a'))
    await idle('a')
  }
  report.cases.push({
    name: 'HNN and HPB each invoke target-pane host exactly once'
  })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.evaluate(() =>
    window.workspaceTest.setLayout({
      edge: 'bottom',
      insets: { top: 0, bottom: 34, left: 0, right: 0 },
      headerContentInset: 0
    })
  )
  await page.evaluate(() => window.workspaceTest.openSecond())
  await page.waitForFunction(
    () =>
      window.workspaceTest.second.getSnapshot().phase === 'idle' &&
      window.workspaceTest.second.getSnapshot().currentFileKey === 'a'
  )
  const shared = await page.evaluate(() => {
    window.__rightEngine = document.querySelector(
      '[data-reader-workspace="right"] [data-engine="pdf"]'
    )
    return {
      activeDocuments: window.workspaceTest.activeDocuments(),
      rightPosition:
        window.workspaceTest.second.getSnapshot().data.layoutReadingProgress
    }
  })
  assert.equal(shared.activeDocuments, 1)
  assert.equal(shared.rightPosition.pageNumber, 3)
  await page.evaluate(() => window.workspaceTest.select('b'))
  await idle('b')
  assert.equal(
    await page.evaluate(() => window.workspaceTest.activeDocuments()),
    2
  )
  await page.evaluate(() => window.workspaceTest.select('a'))
  await idle('a')
  assert.equal(
    await page.evaluate(
      () =>
        window.__rightEngine ===
        document.querySelector(
          '[data-reader-workspace="right"] [data-engine="pdf"]'
        )
    ),
    true
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.workspaceTest.second.getSnapshot().data.layoutReadingProgress
          .pageNumber
    ),
    3
  )
  assert.equal(
    await page.evaluate(() => window.workspaceTest.activeDocuments()),
    1
  )
  const safe = await page.evaluate(() =>
    [...document.querySelectorAll('[data-toolbar-placement="floating"]')].map(
      (element) => {
        const pane = element
          .closest('[data-reader-workspace]')
          .getBoundingClientRect()
        const bar = element.getBoundingClientRect()
        return {
          bottom: pane.bottom - bar.bottom,
          left: bar.left - pane.left,
          right: pane.right - bar.right
        }
      }
    )
  )
  assert.equal(safe.length, 2)
  for (const bar of safe) {
    assert.equal(bar.bottom, 50)
    assert(bar.left >= 0 && bar.right >= 0)
  }
  await page.screenshot({
    path: resolve(output, 'same-file-two-panes-safe-area.png')
  })
  report.cases.push({
    name: 'two panes share sources, keep independent page positions and engines, each consumes bottom=34 once',
    shared,
    safe
  })
  await page.evaluate(() => window.workspaceTest.select('b'))
  await idle('b')
  await page.waitForFunction(() =>
    (
      document
        .querySelector('[data-reader-workspace="left"] foliate-view')
        ?.renderer?.getContents() ?? []
    ).some((entry) => entry.doc.body.textContent.includes('第二章'))
  )
  await page.evaluate(() => {
    window.__epubEngine = document.querySelector(
      '[data-reader-workspace="left"] [data-engine="epub"]'
    )
  })
  await page.setViewportSize({ width: 800, height: 1000 })
  await page.waitForFunction(() =>
    (
      document
        .querySelector('[data-reader-workspace="left"] foliate-view')
        ?.renderer?.getContents() ?? []
    ).some((entry) => entry.doc.body.textContent.includes('第二章'))
  )
  assert.equal(
    await page.evaluate(
      () =>
        window.__epubEngine ===
        document.querySelector(
          '[data-reader-workspace="left"] [data-engine="epub"]'
        )
    ),
    true
  )
  await page.evaluate(() => window.workspaceTest.select('a'))
  await idle('a')
  await page.evaluate(() => window.workspaceTest.select('b'))
  await idle('b')
  const epubPosition = await page.evaluate(
    () => window.workspaceTest.snapshot().data.layoutReadingProgress
  )
  assert.equal(epubPosition.pageNumber, 3)
  assert.equal(epubPosition.offset, 3)
  assert.equal(
    await page.evaluate(
      () =>
        window.__rightEngine ===
        document.querySelector(
          '[data-reader-workspace="right"] [data-engine="pdf"]'
        )
    ),
    true
  )
  await page.screenshot({
    path: resolve(output, 'epub-anchor-after-reflow.png')
  })
  report.cases.push({
    name: 'EPUB chapter/character anchor survives pane reflow and roundtrip; other pane remains mounted',
    epubPosition
  })
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.failure = {
    message: String(error),
    state: await page
      ?.evaluate(() => ({
        text: document.body.innerText,
        state: window.workspaceTest?.snapshot(),
        log: window.workspaceTest?.log
      }))
      .catch(() => null)
  }
  await page?.screenshot({ path: resolve(output, 'failure.png') })
  throw error
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
console.log(JSON.stringify(report, null, 2))
