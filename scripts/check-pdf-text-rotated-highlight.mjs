import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham147-browser')
const externalBase = process.env.READER_BROWSER_URL
const server = externalBase ? null : await createServer({ root: repo })
let browser
try {
  await mkdir(output, { recursive: true })
  await server?.listen()
  const base =
    externalBase ?? `http://127.0.0.1:${server.httpServer.address().port}`
  const html = externalBase
    ? (await (await fetch(base)).text())
        .replace('<body>', '<body style="margin:0">')
        .replace('/demo/main.tsx', '/test/browser/review-regressions.tsx')
    : await server.transformIndexHtml(
        '/rotated-highlight.html',
        '<html><body style="margin:0"><div id="root"></div><script type="module" src="/test/browser/review-regressions.tsx"></script></body></html>'
      )
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/rotated-highlight.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/rotated-highlight.html`)
  await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
  await page.waitForFunction(() => window.readerRegression)
  const bytes = [
    ...(await readFile(resolve(repo, 'test/compat/fixtures/pdf/rotated.pdf')))
  ]
  const cases = []
  for (const overlayRectType of ['percent', 'px']) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(
      ({ bytes, overlayRectType }) =>
        window.readerRegression.open('pdf', bytes, {
          renderMode: 'text',
          overlayRectType,
          isPdf: true
        }),
      { bytes, overlayRectType }
    )
    const text = page
      .locator('.hsn-selection-content [data-selection-start-offset]')
      .filter({ hasText: 'Rotated page text' })
      .first()
    await text.waitFor().catch(async (error) => {
      console.error(errors, await page.locator('body').innerText())
      await page.screenshot({ path: resolve(output, 'rotated-failure.png') })
      throw error
    })
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    })
    await text.evaluate((element) => {
      const range = document.createRange()
      range.setStart(element.firstChild, 0)
      range.setEnd(element.firstChild, 5)
      const selection = document.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    await page.waitForFunction(
      () => window.readerRegression.state.ranges.length === 1
    )
    const saved = await page.evaluate(
      () => window.readerRegression.state.ranges[0]
    )
    assert.equal(saved.text, 'Rotat')
    assert.equal(saved.start.offset, 0)
    assert.equal(saved.end.offset, 5)
    const checks = []
    for (const reopen of [false, true]) {
      if (reopen) {
        await page.setViewportSize({ width: 1280, height: 1000 })
        await page.evaluate(
          ({ bytes, saved }) =>
            window.readerRegression.open('pdf', bytes, {
              ranges: [saved],
              overlayRectType: saved.overlayRectType,
              isPdf: true
            }),
          { bytes, saved }
        )
      } else {
        await page.evaluate(
          (saved) =>
            window.readerRegression.update({
              renderMode: 'layout',
              ranges: [saved]
            }),
          saved
        )
      }
      const span = page
        .locator('.pdfViewer .textLayer span')
        .filter({ hasText: 'Rotated page text' })
        .first()
      await span.waitFor({ state: 'attached' })
      await page
        .locator('.hamster-reader__pdf-viewer-container')
        .evaluate((element) => {
          element.scrollTop = 0
        })
      const marker = page.locator('.hamster-reader__pdf-highlight-rect').first()
      await marker.waitFor({ state: 'attached' })
      const geometry = await span.evaluate((span) => {
        const range = document.createRange()
        range.setStart(span.firstChild, 0)
        range.setEnd(span.firstChild, 5)
        const text = range.getBoundingClientRect()
        const marker = document
          .querySelector('.hamster-reader__pdf-highlight-rect')
          .getBoundingClientRect()
        return {
          text: text.toJSON(),
          marker: marker.toJSON(),
          delta: Object.fromEntries(
            ['left', 'top', 'width', 'height'].map((key) => [
              key,
              Math.abs(text[key] - marker[key])
            ])
          )
        }
      })
      assert(
        geometry.text.width > 0 && geometry.text.height > geometry.text.width
      )
      assert(
        Object.values(geometry.delta).every((value) => value < 2),
        `rotated marker must cover actual Rotat glyph bounds: ${JSON.stringify(geometry)}`
      )
      checks.push({ reopen, ...geometry })
      await page.screenshot({
        path: resolve(
          output,
          `rotated-${overlayRectType}-${reopen ? 'reopened' : 'layout'}.png`
        )
      })
    }
    cases.push({ overlayRectType, range: saved, checks })
  }
  // Observe real Reader ownership, retaining keys so GC cannot hide missed
  // deletion. TextLayer.render also detects duplicate detached DOM builds.
  await page.evaluate(() => {
    window.facadeDocumentPrototype = Object.getPrototypeOf(
      Object.getPrototypeOf(window.readerRegression.document)
    )
    window.readerRegression.update({ document: null, engineSource: undefined })
  })
  await page.evaluate(async () => {
    const { sourceTextGeometry } =
      await import('/src/components/IntermediateDocumentViewer/sourceTextGeometry.ts')
    const { PdfDocumentSession } =
      await import('/src/pdf/pdfDocumentSession.ts')
    const originalSet = sourceTextGeometry.set
    const originalRender = window.pdfjsLib.TextLayer.prototype.render
    const originalOpen = PdfDocumentSession.open
    const documentPrototype = window.facadeDocumentPrototype
    const pages = Object.getOwnPropertyDescriptor(documentPrototype, 'pages')
    const keys = []
    let builds = 0
    let opens = 0
    let allPageReads = 0
    Object.defineProperty(documentPrototype, 'pages', {
      ...pages,
      get() {
        allPageReads++
        return pages.get.call(this)
      }
    })
    sourceTextGeometry.set = function (text, slice) {
      keys.push(text)
      return originalSet.call(this, text, slice)
    }
    window.pdfjsLib.TextLayer.prototype.render = function (...args) {
      builds++
      return originalRender.apply(this, args)
    }
    PdfDocumentSession.open = function (...args) {
      opens++
      return originalOpen.apply(this, args)
    }
    window.geometryLifecycle = {
      snapshot: () => ({
        builds,
        opens,
        allPageReads,
        registrations: keys.length,
        active: keys
          .filter((key) => sourceTextGeometry.has(key))
          .map((key) => key.id)
      }),
      restore: () => {
        sourceTextGeometry.set = originalSet
        window.pdfjsLib.TextLayer.prototype.render = originalRender
        PdfDocumentSession.open = originalOpen
        Object.defineProperty(documentPrototype, 'pages', pages)
      }
    }
  })
  const lifecycleBytes = [
    ...(await readFile(
      resolve(repo, 'test/compat/fixtures/pdf/two-column.pdf')
    ))
  ]
  await page.evaluate(
    (bytes) =>
      window.readerRegression.open('pdf', bytes, {
        isPdf: true,
        renderMode: 'text',
        pagePreloadRadius: 0,
        maxLoadedPages: 1,
        pageUnloadDelayMs: 0
      }),
    lifecycleBytes
  )
  await page
    .locator('.hsn-selection-content [data-text-id="page-1-item-0"]')
    .waitFor()
  const firstPage = await page.evaluate(() =>
    window.geometryLifecycle.snapshot()
  )
  assert.equal(
    firstPage.builds,
    1,
    'Reader mount must build only the current text page measurement layer'
  )
  assert.equal(firstPage.registrations, 4)
  assert.equal(
    firstPage.opens,
    1,
    'facade geometry must reuse the original PDF session'
  )
  assert.equal(firstPage.active.length, 4)
  assert.equal(
    firstPage.allPageReads,
    0,
    'Reader metadata checks must not invoke the loading pages getter'
  )

  // Even an explicit all-pages read must not attach measurement resources to
  // the fulfilled promises in the facade's independent pagesMap cache.
  await page.evaluate(async () => {
    const pages = await window.readerRegression.document.pages
    window.cachedFacadePages = pages
    window.readerRegression.update({ fontScale: 1.25 })
    await document.fonts.ready
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    )
  })
  const cachedPages = await page.evaluate(() =>
    window.geometryLifecycle.snapshot()
  )
  assert.deepEqual(
    cachedPages,
    { ...firstPage, allPageReads: 1 },
    'generic pages access and Reader rerender must not rebuild measurement layers'
  )

  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.waitForFunction(() => {
    const state = window.geometryLifecycle.snapshot()
    return state.active.length === 1 && state.active[0] === 'page-2-item-0'
  })
  const secondPage = await page.evaluate(() =>
    window.geometryLifecycle.snapshot()
  )
  assert.equal(secondPage.builds, 2)
  assert.equal(secondPage.registrations, 5)
  assert.equal(secondPage.opens, 1)
  await page.evaluate(() =>
    window.readerRegression.update({ renderMode: 'layout' })
  )
  await page.waitForFunction(
    () => window.geometryLifecycle.snapshot().active.length === 0
  )
  const exited = await page.evaluate(() => window.geometryLifecycle.snapshot())
  const cachedGeometryCount = await page.evaluate(async () => {
    const { sourceTextGeometry } =
      await import('/src/components/IntermediateDocumentViewer/sourceTextGeometry.ts')
    return window.cachedFacadePages
      .flatMap((page) => page.content)
      .filter((text) => sourceTextGeometry.has(text)).length
  })
  assert.equal(
    cachedGeometryCount,
    0,
    'strongly cached facade pages must retain no measurement geometry'
  )
  const lifecycle = {
    firstPage,
    cachedPages,
    secondPage,
    exited,
    cachedGeometryCount
  }
  await page.evaluate(() => window.geometryLifecycle.restore())

  // Exercise the Demo's legacy parser too; its polygons omit page rotation.
  await page.goto(base)
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(resolve(repo, 'test/compat/fixtures/pdf/rotated.pdf'))
  await page.getByRole('button', { name: '加载文件', exact: true }).click()
  await page
    .locator('.pdfViewer .textLayer span')
    .first()
    .waitFor({ state: 'attached' })
  await page.getByTestId('render-mode-select').selectOption('text')
  const demoText = page
    .locator('.hsn-selection-content [data-selection-start-offset]')
    .filter({ hasText: 'Rotated page text' })
    .first()
  await demoText.waitFor()
  await demoText.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild, 0)
    range.setEnd(element.firstChild, 5)
    const selection = document.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  await page.waitForFunction(
    () =>
      JSON.parse(
        localStorage.getItem('hamster-reader-demo:annotations:v5:rotated.pdf')
      )?.ranges.length === 1
  )
  const demoRange = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('hamster-reader-demo:annotations:v5:rotated.pdf')
      ).ranges[0]
  )
  assert.equal(demoRange.text, 'Rotat')
  await page.getByTestId('render-mode-select').selectOption('layout')
  const demoSpan = page
    .locator('.pdfViewer .textLayer span')
    .filter({ hasText: 'Rotated page text' })
    .first()
  await demoSpan.waitFor({ state: 'attached' })
  await page
    .locator('.hamster-reader__pdf-viewer-container')
    .evaluate((element) => {
      element.scrollTop = 0
    })
  await page
    .locator('.pdfViewer .page')
    .first()
    .click({ position: { x: 200, y: 240 } })
  await page
    .locator('.hamster-reader__pdf-highlight-rect')
    .first()
    .waitFor({ state: 'attached' })
  const demoAlignment = await demoSpan.evaluate((span) => {
    const range = document.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, 5)
    const text = range.getBoundingClientRect()
    const marker = document
      .querySelector('.hamster-reader__pdf-highlight-rect')
      .getBoundingClientRect()
    return Object.fromEntries(
      ['left', 'top', 'width', 'height'].map((key) => [
        key,
        Math.abs(text[key] - marker[key])
      ])
    )
  })
  assert(
    Object.values(demoAlignment).every((value) => value < 2),
    `Demo rotated geometry must align: ${JSON.stringify(demoAlignment)}`
  )
  await page.screenshot({ path: resolve(output, 'rotated-demo-layout.png') })
  assert.deepEqual(errors, [])
  const report = {
    passed: true,
    fixture: 'rotated.pdf',
    scenario:
      'Text Rotat [0,5) → shared annotation → PDF → reopen at a different zoom',
    cases,
    demo: { range: demoRange, alignmentDeltaPx: demoAlignment },
    lifecycle
  }
  await writeFile(
    resolve(output, 'rotated-report.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await server?.close()
}
