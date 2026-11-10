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
    // PDF.js submits render before mounting its canvas. Tag the actual viewer
    // rendering source (including detail canvases), independent of DOM timing.
    const bodyCanvases = new WeakSet()
    const viewers = new WeakMap()
    const documentSessions = new WeakMap()
    const pageSessions = new WeakMap()
    let nextSession = 0
    const sessionFor = (document) => {
      if (!documentSessions.has(document))
        documentSessions.set(document, ++nextSession)
      return documentSessions.get(document)
    }
    window.pdfHiddenGetViewer = () =>
      viewers.get(document.querySelector('.pdfViewer'))
    window.pdfHiddenGetSession = () =>
      sessionFor(window.pdfHiddenGetViewer().pdfDocument)
    const base = Object.getPrototypeOf(
      window.readerRegression.PDFPageView.prototype
    )
    const drawCanvas = base._drawCanvas
    base._drawCanvas = function (options, ...args) {
      const viewer = this.renderingQueue.pdfViewer
      viewers.set(viewer.viewer, viewer)
      bodyCanvases.add(options.canvas)
      return drawCanvas.call(this, options, ...args)
    }
    const probe = await window.pdfjsLib.getDocument({
      data: new Uint8Array(bytes)
    }).promise
    // Associate pages with the actual document instance, before any caller can
    // render them. A reused viewer DOM node or identical PDF bytes is not a
    // session identity. Keep all requests, including startup and retired docs.
    const documentPrototype = Object.getPrototypeOf(probe)
    const getPage = documentPrototype.getPage
    documentPrototype.getPage = async function (...args) {
      const session = sessionFor(this)
      const page = await getPage.apply(this, args)
      pageSessions.set(page, session)
      return page
    }
    const first = await probe.getPage(1)
    const prototype = Object.getPrototypeOf(first)
    const render = prototype.render
    prototype.render = function (options) {
      const session = pageSessions.get(this)
      if (session === undefined) throw new Error('untracked PDF render session')
      window.pdfHiddenRenderLog.push({
        session,
        pageNumber: this.pageNumber,
        modal:
          !bodyCanvases.has(options.canvas) &&
          Boolean(document.querySelector('[role="dialog"]')),
        body: bodyCanvases.has(options.canvas),
        connected: options.canvas?.isConnected ?? false
      })
      if (
        window.pdfHiddenFailPage === this.pageNumber &&
        !bodyCanvases.has(options.canvas) &&
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

  const failures = []
  const checkRegression = (name, check) => {
    try {
      check()
      report.checks.push(name)
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
    }
  }
  const hiddenBodyCount = () =>
    page.evaluate(
      () =>
        window.pdfHiddenRenderLog.filter(
          (entry) =>
            entry.session === window.pdfHiddenDocumentSession &&
            entry.body &&
            entry.pageNumber >= 2 &&
            entry.pageNumber <= 4
        ).length
    )
  const wide = await PDFDocument.create()
  for (let i = 0; i < 5; i++) wide.addPage([800, 600])
  await page.evaluate(
    async (bytes) => {
      await window.readerRegression.open('pdf', bytes, {
        data: { hiddenPages: [2, 3, 4] },
        edgeCropEditing: true,
        onDataChange: (data) => window.readerRegression.update({ data })
      })
    },
    [...(await wide.save())]
  )
  await page.locator('[data-hidden-page-group="2-4"]').waitFor()
  await page.waitForFunction(() =>
    window.pdfHiddenRenderLog.some(
      (entry) => entry.body && entry.pageNumber === 1
    )
  )
  await page.evaluate(() => {
    window.pdfHiddenDocumentSession = window.pdfHiddenGetSession()
  })
  report.idle = { milliseconds: 2000, before: await hiddenBodyCount() }
  await page.waitForTimeout(report.idle.milliseconds)
  report.idle.after = await hiddenBodyCount()
  report.idle.detachedBodyRenders = await page.evaluate(
    () =>
      window.pdfHiddenRenderLog.filter(
        (entry) =>
          entry.session === window.pdfHiddenDocumentSession &&
          entry.body &&
          !entry.connected
      ).length
  )
  checkRegression(
    'hidden pages make zero body requests at startup and during 2s idle',
    () => {
      assert.equal(
        report.idle.after,
        report.idle.before,
        'hidden render count grew while idle'
      )
      assert.equal(report.idle.after, 0, 'hidden pages rendered before idle')
    }
  )
  assert(
    report.idle.detachedBodyRenders > 0,
    'render probe must detect detached viewer canvases'
  )

  // Put both readable pages in the viewport: PDF.js must not fill hidden holes.
  await page.getByRole('button', { name: '缩放', exact: true }).click()
  await page.getByRole('menuitem', { name: '25%', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.pdfViewer .page')?.getBoundingClientRect()
        .height < 300
  )
  const holeBefore = await hiddenBodyCount()
  await page.waitForTimeout(1000)
  report.holes = { before: holeBefore, after: await hiddenBodyCount() }
  checkRegression(
    'hidden holes stay idle while both readable pages render',
    () => assert.equal(report.holes.after, holeBefore)
  )
  await page.waitForFunction(() =>
    [0, 4].every(
      (index) =>
        document
          .querySelectorAll('.pdfViewer .page')
          [index]?.querySelector('canvas')?.width > 0
    )
  )

  await page.getByRole('button', { name: '缩放', exact: true }).click()
  await page.getByRole('menuitem', { name: '300%', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.pdfViewer .page')?.getBoundingClientRect()
        .width >= 3190
  )
  report.horizontal = []
  for (const fraction of [0, 0.5, 1, 0.25, 0, 1]) {
    await page.evaluate((fraction) => {
      const container = document.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      const button = document.querySelector('[data-hidden-page-group="2-4"]')
      // Release the reader's pending scale-anchor restoration as user input does.
      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
      container.scrollTop +=
        button.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        container.clientHeight / 2
      container.scrollLeft =
        (container.scrollWidth - container.clientWidth) * fraction
    }, fraction)
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    const geometry = await page.evaluate(() => {
      const container = document.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      const button = document.querySelector('[data-hidden-page-group="2-4"]')
      const host = container.getBoundingClientRect()
      const rect = button.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      return {
        scrollLeft: container.scrollLeft,
        width: container.clientWidth,
        scrollWidth: container.scrollWidth,
        left: rect.left,
        right: rect.right,
        x,
        y,
        visible:
          rect.left >= host.left &&
          rect.right <= host.right &&
          rect.top >= host.top &&
          rect.bottom <= host.bottom,
        hittable: button.contains(document.elementFromPoint(x, y))
      }
    })
    report.horizontal.push(geometry)
    checkRegression(
      `300% wide-page entry visible and clickable at scrollLeft=${geometry.scrollLeft}`,
      () => {
        assert(geometry.visible, JSON.stringify(geometry))
        assert(geometry.hittable, 'entry is not the pointer hit target')
      }
    )
    // Raw pointer coordinates: locator.click() could scroll a broken entry back
    // into view and hide this regression.
    if (geometry.hittable) {
      await page.mouse.click(geometry.x, geometry.y)
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    }
  }
  await page.getByRole('button', { name: '缩放', exact: true }).click()
  await page.getByRole('menuitem', { name: '25%', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('.pdfViewer .page')?.getBoundingClientRect()
        .width < 300
  )
  report.zoomOut = await page.evaluate(() => {
    const container = document.querySelector(
      '.hamster-reader__pdf-viewer-container'
    )
    return {
      width: container.clientWidth,
      scrollWidth: container.scrollWidth,
      scrollLeft: container.scrollLeft
    }
  })
  checkRegression(
    'zooming out after a right pan leaves no overlay-induced horizontal overflow',
    () => {
      assert.equal(report.zoomOut.scrollWidth, report.zoomOut.width)
      assert.equal(report.zoomOut.scrollLeft, 0)
    }
  )
  assert.deepEqual(
    failures,
    [],
    'render scheduling / horizontal entry regressions'
  )

  const hiddenPages = Array.from({ length: 198 }, (_, index) => index + 2)
  const switchWindow = await page.evaluate(
    async ({ bytes, hiddenPages }) => {
      const oldSession = window.pdfHiddenGetSession()
      const oldViewer = window.pdfHiddenGetViewer()
      const oldPage = oldViewer.getPageView(4)
      if (!oldPage.pdfPage) throw new Error('old page 5 must be loaded')
      const logStart = window.pdfHiddenRenderLog.length
      const opening = window.readerRegression.open('pdf', bytes, {
        data: { hiddenPages },
        edgeCropEditing: false,
        onDataChange: (data) => window.readerRegression.update({ data })
      })
      // open() waits two frames before retiring the old document. Force a real
      // old-page draw inside that window, while page 5 will be hidden in the new
      // book. Its canvas still goes through the actual PDFPageView source probe.
      const lateDraw = new Promise((resolve, reject) =>
        requestAnimationFrame(() => {
          try {
            oldPage.reset()
            oldPage.draw().then(resolve, (error) => {
              if (error.name === 'RenderingCancelledException') resolve()
              else reject(error)
            })
          } catch (error) {
            reject(error)
          }
        })
      )
      await Promise.all([opening, lateDraw])
      return { oldSession, logStart }
    },
    { bytes, hiddenPages }
  )
  await page.waitForFunction(
    () => document.querySelectorAll('.pdfViewer .page').length === 200
  )
  await page.locator('.pdfViewer .page').first().waitFor()
  await page.waitForFunction(
    () => window.pdfHiddenGetViewer()?.pdfDocument?.numPages === 200
  )
  await page.evaluate(() => {
    window.pdfHiddenViewer = document.querySelector('.pdfViewer')
    window.pdfHiddenDocumentSession = window.pdfHiddenGetSession()
  })
  report.sessionIsolation = await page.evaluate(({ oldSession, logStart }) => {
    const session = window.pdfHiddenDocumentSession
    const requests = window.pdfHiddenRenderLog.slice(logStart)
    return {
      oldSession,
      newSession: session,
      lateOldPageFiveRequests: requests.filter(
        (entry) =>
          entry.session === oldSession && entry.body && entry.pageNumber === 5
      ).length,
      newSessionStartupRequests: requests.filter(
        (entry) => entry.session === session && entry.body
      ).length,
      newSessionPageFiveRequests: requests.filter(
        (entry) =>
          entry.session === session && entry.body && entry.pageNumber === 5
      ).length,
      unscopedHiddenBodyRequests: requests.filter(
        (entry) =>
          entry.body && entry.pageNumber >= 2 && entry.pageNumber <= 199
      ).length
    }
  }, switchWindow)
  assert.notEqual(
    report.sessionIsolation.oldSession,
    report.sessionIsolation.newSession
  )
  assert(report.sessionIsolation.lateOldPageFiveRequests > 0)
  assert(report.sessionIsolation.newSessionStartupRequests > 0)
  assert.equal(report.sessionIsolation.newSessionPageFiveRequests, 0)
  assert(report.sessionIsolation.unscopedHiddenBodyRequests > 0)
  report.checks.push(
    'a real late page-5 body draw during book switching stays in the old document session; new-document startup renders remain recorded'
  )
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
            entry.pageNumber >= 2 &&
            entry.pageNumber <= 199 &&
            entry.body &&
            entry.session === window.pdfHiddenDocumentSession
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
  const countLargeHiddenBody = () =>
    page.evaluate(
      () =>
        window.pdfHiddenRenderLog.filter(
          (entry) =>
            entry.body &&
            entry.session === window.pdfHiddenDocumentSession &&
            entry.pageNumber >= 2 &&
            entry.pageNumber <= 199
        ).length
    )
  report.largeIdle = {
    milliseconds: 2000,
    before: await countLargeHiddenBody()
  }
  await page.waitForTimeout(report.largeIdle.milliseconds)
  report.largeIdle.after = await countLargeHiddenBody()
  assert.equal(report.largeIdle.after, report.largeIdle.before)
  assert.equal(report.largeIdle.after, 0)
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
        .filter(
          (entry) =>
            entry.session === window.pdfHiddenDocumentSession && entry.modal
        )
        .map((entry) => entry.pageNumber)
    ).size,
    bodyRenders: window.pdfHiddenRenderLog.filter(
      (entry) =>
        entry.pageNumber >= 2 &&
        entry.pageNumber <= 199 &&
        entry.body &&
        entry.session === window.pdfHiddenDocumentSession
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
