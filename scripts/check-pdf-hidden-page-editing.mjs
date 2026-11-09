import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(
  process.env.READER_BROWSER_OUTPUT ??
    resolve(repo, 'test-results/ham190-hidden-pages')
)
await mkdir(output, { recursive: true })
const server = await createServer({
  root: repo,
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [repo, resolve(repo, 'node_modules')] }
  }
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const report = {
  command: 'node scripts/check-pdf-hidden-page-editing.mjs',
  passed: false,
  checks: []
}
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(20000)
  page.on('pageerror', (error) => {
    throw error
  })
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  await page.route('**/pdf-hidden.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/pdf-hidden.html`, { waitUntil: 'domcontentloaded' })
  await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
  await page.waitForFunction(() => window.readerRegression && window.pdfjsLib)
  const fixture = await PDFDocument.create()
  for (let pageNumber = 0; pageNumber < 200; pageNumber++)
    fixture.addPage([400, 600])
  const bytes = [...(await fixture.save())]
  await page.evaluate(async (bytes) => {
    window.pdfHiddenRenderLog = []
    const probe = await window.pdfjsLib.getDocument({
      data: new Uint8Array(bytes)
    }).promise
    const first = await probe.getPage(1)
    const prototype = Object.getPrototypeOf(first)
    const render = prototype.render
    prototype.render = function (options) {
      window.pdfHiddenRenderLog.push({
        pageNumber: this.pageNumber,
        modal: Boolean(document.querySelector('[role="dialog"]')),
        body: Boolean(options.canvas?.closest?.('.pdfViewer .page')),
        connected: options.canvas?.isConnected ?? false
      })
      if (
        window.pdfHiddenFailPage === this.pageNumber &&
        document.querySelector('[role="dialog"]')
      ) {
        window.pdfHiddenFailPage = null
        return {
          promise: Promise.reject(new Error('injected preview failure')),
          cancel() {}
        }
      }
      return render.call(this, options)
    }
    await probe.destroy()
  }, bytes)
  const hiddenPages = Array.from({ length: 198 }, (_, index) => index + 2)
  await page.evaluate(
    async ({ bytes, hiddenPages }) => {
      await window.readerRegression.open('pdf', bytes, {
        data: { hiddenPages },
        edgeCropEditing: false,
        onDataChange: (data) => window.readerRegression.update({ data })
      })
    },
    { bytes, hiddenPages }
  )
  await page.waitForFunction(
    () => document.querySelectorAll('.pdfViewer .page').length === 200
  )
  await page.locator('.pdfViewer .page').first().waitFor()
  await page.evaluate(() => {
    window.pdfHiddenViewer = document.querySelector('.pdfViewer')
    window.pdfHiddenRenderLog.length = 0
  })
  assert.equal(await page.locator('[data-hidden-page-group]').count(), 0)

  const measureLayout = () =>
    page.evaluate(() => {
      const container = document.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      return {
        visibleOffsets: [
          ...document.querySelectorAll('.pdfViewer .page')
        ].flatMap((page, index) =>
          getComputedStyle(page).display === 'none'
            ? []
            : [[index + 1, page.offsetTop]]
        ),
        scrollHeight: container.scrollHeight
      }
    })
  const initialLayout = await measureLayout()
  const assertLayoutUnchanged = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    assert.deepEqual(await measureLayout(), initialLayout)
  }

  const assertHiddenLayout = async () => {
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.pdfViewer .page')]
        .slice(1, 199)
        .every(
          (page) =>
            !page.querySelector(
              'canvas, .textLayer, .hamster-reader__engine-hidden-page'
            )
        )
    )
    const state = await page.evaluate(() => {
      const hidden = [...document.querySelectorAll('.pdfViewer .page')].slice(
        1,
        199
      )
      return {
        displayed: hidden.filter(
          (page) => getComputedStyle(page).display !== 'none'
        ).length,
        boxes: hidden.filter((page) => {
          const rect = page.getBoundingClientRect()
          return rect.width !== 0 || rect.height !== 0
        }).length,
        content: hidden.filter((page) =>
          page.querySelector(
            'canvas, .textLayer, .hamster-reader__engine-hidden-page'
          )
        ).length,
        groups: document.querySelectorAll('[data-hidden-page-group]').length,
        sameViewer:
          window.pdfHiddenViewer === document.querySelector('.pdfViewer'),
        bodyRenders: window.pdfHiddenRenderLog.filter(
          (entry) =>
            entry.pageNumber >= 2 && entry.pageNumber <= 199 && entry.body
        ).length
      }
    })
    assert.deepEqual(state, {
      displayed: 0,
      boxes: 0,
      content: 0,
      groups: 1,
      sameViewer: true,
      bodyRenders: 0
    })
  }

  await page.evaluate(() =>
    window.readerRegression.update({ edgeCropEditing: true })
  )
  await page.locator('[data-hidden-page-group="2-199"]').waitFor()
  await assertHiddenLayout()
  await assertLayoutUnchanged()
  for (const editing of [false, true, false, true]) {
    await page.evaluate(
      (editing) => window.readerRegression.update({ edgeCropEditing: editing }),
      editing
    )
    if (editing)
      await page.locator('[data-hidden-page-group="2-199"]').waitFor()
    else
      await page
        .locator('[data-hidden-page-group]')
        .waitFor({ state: 'detached' })
    await assertLayoutUnchanged()
  }
  await assertHiddenLayout()
  report.checks.push(
    '200-page PDF: pages 2-199 keep zero layout boxes/content, zero body render requests, one group, identical visible offsetTop values, unchanged scrollHeight, and the same viewer across edit toggles'
  )

  const group = page.locator('[data-hidden-page-group="2-199"]')
  report.anchor = await page.evaluate(() => {
    const pages = document.querySelectorAll('.pdfViewer .page')
    const previous = pages[0].getBoundingClientRect()
    const next = pages[199].getBoundingClientRect()
    const button = document
      .querySelector('[data-hidden-page-group="2-199"]')
      .getBoundingClientRect()
    return {
      position: getComputedStyle(
        document.querySelector('[data-hidden-page-group="2-199"]')
      ).position,
      center: button.top + button.height / 2,
      expectedCenter: (previous.bottom + next.top) / 2,
      flowHosts: document.querySelectorAll('[data-hidden-page-group-host]')
        .length
    }
  })
  assert.equal(report.anchor.position, 'absolute')
  assert(Math.abs(report.anchor.center - report.anchor.expectedCenter) <= 1)
  assert.equal(report.anchor.flowHosts, 0)
  await group.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'desktop-200-collapsed.png') })
  await page.setViewportSize({ width: 320, height: 740 })
  await group.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'mobile-200-collapsed.png') })
  report.debug = await group.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const container = element.closest('.hamster-reader__pdf-viewer-container')
    const containerRect = container?.getBoundingClientRect()
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    )
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      containerRect: containerRect
        ? {
            x: containerRect.x,
            y: containerRect.y,
            width: containerRect.width,
            height: containerRect.height
          }
        : null,
      scrollTop: container?.scrollTop,
      scrollHeight: container?.scrollHeight,
      hit: hit?.outerHTML.slice(0, 500),
      parent: element.parentElement?.outerHTML.slice(0, 500)
    }
  })

  await group.click()
  await page.getByRole('dialog').waitFor()
  await page.waitForFunction(
    () => document.querySelector('[data-hidden-preview-page="2"] img')?.src
  )
  const preview = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-hidden-preview-page]').length,
    rendered: new Set(
      window.pdfHiddenRenderLog
        .filter((entry) => entry.modal)
        .map((entry) => entry.pageNumber)
    ).size,
    bodyRenders: window.pdfHiddenRenderLog.filter(
      (entry) => entry.pageNumber >= 2 && entry.pageNumber <= 199 && entry.body
    ).length
  }))
  report.preview = preview
  assert.equal(preview.cards, 198)
  assert(preview.rendered > 0 && preview.rendered < 198)
  assert.equal(preview.bodyRenders, 0)
  const assertDialogFits = async () => {
    const layout = await page.getByRole('dialog').evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        width: dialog.clientWidth,
        scrollWidth: dialog.scrollWidth
      }
    })
    assert(layout.left >= 0 && layout.right <= layout.viewportWidth)
    assert(layout.top >= 0 && layout.bottom <= layout.viewportHeight)
    assert.equal(layout.scrollWidth, layout.width)
  }
  await assertDialogFits()
  await page.getByTestId('pdf-hidden-restore-page-2').click()
  await page.screenshot({ path: resolve(output, 'mobile-restore-modal.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await assertDialogFits()
  await page.screenshot({ path: resolve(output, 'desktop-restore-modal.png') })
  await page.getByRole('button', { name: '关闭隐藏页恢复' }).focus()
  await page.keyboard.press('Shift+Tab')
  assert.equal(
    await page
      .getByRole('button', { name: '恢复 1 页' })
      .evaluate((button) => button === document.activeElement),
    true
  )
  await page.keyboard.press('Tab')
  assert.equal(
    await page
      .getByRole('button', { name: '关闭隐藏页恢复' })
      .evaluate((button) => button === document.activeElement),
    true
  )
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert(await group.evaluate((button) => button === document.activeElement))
  await page.setViewportSize({ width: 320, height: 740 })
  await group.click()
  report.checks.push(
    '320px and desktop dialogs fit the viewport without horizontal overflow; Tab traps focus, Escape closes, and focus returns to the group entry'
  )
  report.checks.push(
    `modal renders real previews on demand (${preview.rendered}/198), with zero hidden-page body renders`
  )

  await page.getByRole('button', { name: '全选', exact: true }).click()
  await page.getByRole('button', { name: '恢复 198 页', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.locator('[data-hidden-page-group]').waitFor({ state: 'detached' })
  const restoredSecond = page.locator('.pdfViewer .page').nth(1)
  await restoredSecond.scrollIntoViewIfNeeded()
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pdfViewer .page')[1]?.querySelector('canvas')
        ?.width > 0
  )
  await page
    .locator('.hamster-reader__pdf-hidden-undo')
    .getByRole('button', { name: '撤销', exact: true })
    .click()
  await page.locator('[data-hidden-page-group="2-199"]').waitFor()
  report.checks.push(
    'select-all restoration commits and one undo restores the 198-page group'
  )

  await page.evaluate(() =>
    window.readerRegression.update({
      data: { hiddenPages: [1, 2, 4, 5, 199, 200] }
    })
  )
  await page.waitForFunction(
    () => document.querySelectorAll('[data-hidden-page-group]').length === 3
  )
  assert.deepEqual(
    await page
      .locator('[data-hidden-page-group]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-hidden-page-group'))
      ),
    ['1-2', '4-5', '199-200']
  )
  const first = page.locator('[data-hidden-page-group="1-2"]')
  await page.evaluate(() => {
    window.pdfHiddenFailPage = 4
  })
  await first.click()
  const fourth = page.getByTestId('pdf-hidden-restore-page-4')
  await fourth.scrollIntoViewIfNeeded()
  const retry = page.getByRole('button', { name: '第 4 页预览失败，重试' })
  await retry.waitFor()
  await retry.click()
  await page.waitForFunction(
    () => document.querySelector('[data-hidden-preview-page="4"] img')?.src
  )
  for (const pageNumber of [1, 4, 199])
    await page.getByTestId(`pdf-hidden-restore-page-${pageNumber}`).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.locator('[data-hidden-page-group]').count(), 3)
  await first.click()
  for (const pageNumber of [1, 4, 199])
    await page.getByTestId(`pdf-hidden-restore-page-${pageNumber}`).click()
  await page.getByRole('button', { name: '恢复 3 页', exact: true }).click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-hidden-page-group]')]
        .map((node) => node.getAttribute('data-hidden-page-group'))
        .join(',') === '2-2,5-5,200-200'
  )
  await page
    .locator('.hamster-reader__pdf-hidden-undo')
    .getByRole('button', { name: '撤销', exact: true })
    .click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-hidden-page-group]').length === 3
  )
  report.checks.push(
    'head/middle/tail groups support cross-group selection, cancel, confirm, and undo'
  )

  await page.evaluate(() =>
    window.readerRegression.update({
      data: {
        hiddenPages: Array.from({ length: 200 }, (_, index) => index + 1)
      }
    })
  )
  const all = page.getByTestId('pdf-hidden-page-group')
  await all.waitFor()
  assert.match(await all.textContent(), /200/)
  await all.click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('[data-hidden-preview-page]').count(), 200)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  report.checks.push(
    'a fully hidden document retains one usable restoration entry'
  )

  await page.evaluate(() =>
    window.readerRegression.update({ data: { hiddenPages: [2, 3] } })
  )
  await page.locator('[data-hidden-page-group="2-3"]').click()
  await page.getByTestId('pdf-hidden-restore-page-2').click()
  await page.getByRole('button', { name: '恢复 1 页', exact: true }).click()
  await page.locator('.hamster-reader__pdf-hidden-undo').waitFor()
  await page.evaluate(async (bytes) => {
    await window.readerRegression.open('pdf', bytes, {
      data: { hiddenPages: [2] },
      edgeCropEditing: true,
      onDataChange: (data) => window.readerRegression.update({ data })
    })
  }, bytes)
  await page.locator('[data-hidden-page-group="2-2"]').waitFor()
  await page.locator('[data-hidden-page-group="2-2"]').click()
  await page.getByRole('heading', { name: '第 2 页', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  report.checks.push('a single hidden page uses a single-page group heading')
  assert.equal(
    await page.locator('.hamster-reader__pdf-hidden-undo').count(),
    0
  )
  report.checks.push(
    'switching documents invalidates the previous document undo and preview session'
  )
  report.passed = true
  await page.close()
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await browser?.close()
  await server.close()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
