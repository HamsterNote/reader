import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import JSZip from 'jszip'

const zip = await JSZip.loadAsync(
  await readFile('test/compat/fixtures/epub/duplicate-text.epub')
)
const chapter = (title, text) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><meta name="viewport" content="width=600,height=800"/></head><body style="margin:0"><p style="margin:40px;font-size:32px">${text}</p></body></html>`
zip.file('OPS/chapter1.xhtml', chapter('First', 'FIRST FIXED PAGE'))
zip.file('OPS/chapter2.xhtml', chapter('Second', 'SECOND FIXED PAGE'))
zip.file(
  'OPS/package.opf',
  (await zip.file('OPS/package.opf').async('string'))
    .replace('<itemref idref="cover" />', '')
    .replace(
      '</metadata>',
      '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta></metadata>'
    )
)
const bytes = Array.from(await zip.generateAsync({ type: 'uint8array' }))
const output = resolve('test-results/epub-pane-selection')
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
const report = { browser: 'chromium', errors: [] }
let browser
let page
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 900, height: 500 } })
  page.setDefaultTimeout(8000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.route('**/epub-pane-selection.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/epub-pane-selection.html`)
  await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
  await page.waitForFunction(() => window.readerRegression)
  await page.evaluate(
    (bytes) => window.readerRegression.openDualEpub(bytes),
    bytes
  )
  await page.waitForFunction(() => {
    const panes = Array.from(document.querySelectorAll('[data-epub-pane]'))
    return (
      panes.length === 2 &&
      panes.every(
        (pane) =>
          pane.querySelector('.hamster-reader__epub-container')?.dataset
            .canNext === 'true' &&
          pane
            .querySelector('foliate-view')
            ?.renderer?.getContents()[0]
            ?.doc?.body.textContent.includes('FIRST FIXED PAGE')
      )
    )
  })
  const setup = await page.evaluate(() => {
    const left = document.querySelector('[data-epub-pane="left"]')
    const right = document.querySelector('[data-epub-pane="right"]')
    const nativeText = document.createElement('span')
    nativeText.textContent = 'LEFT NATIVE SELECTION'
    nativeText.style.cssText =
      'position:absolute;left:0;top:0;pointer-events:none;z-index:10001'
    left.append(nativeText)
    const selection = document.getSelection()
    const selectedRange = document.createRange()
    selectedRange.selectNodeContents(nativeText)
    selection.removeAllRanges()
    selection.addRange(selectedRange)
    const paper = right.querySelector('.hamster-reader__epub-container')
    const view = right.querySelector('foliate-view')
    window.__epubNavCalls = []
    for (const [target, names] of [
      [view, ['goTo', 'next']],
      [view.renderer, ['goTo', 'next']]
    ])
      for (const name of names) {
        const original = target[name].bind(target)
        target[name] = (...args) => {
          window.__epubNavCalls.push({ name, args })
          return original(...args)
        }
      }
    const chapter = view.renderer.getContents()[0].doc
    const frame = chapter.defaultView.frameElement
    const paperRect = paper.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    const point = {
      x: frameRect.right + Math.min(4, (paperRect.right - frameRect.right) / 2),
      y: paperRect.top + paperRect.height / 2
    }
    window.__epubPaneTrace = []
    for (const type of ['pointerdown', 'pointerup', 'click'])
      document.addEventListener(
        type,
        (event) => {
          const current = document.getSelection()
          window.__epubPaneTrace.push({
            type,
            x: event.clientX,
            y: event.clientY,
            selection: current?.toString(),
            anchorInLeft: left.contains(current?.anchorNode),
            target: event.target.outerHTML?.slice(0, 300),
            path: event
              .composedPath()
              .map((element) => element.outerHTML?.slice(0, 160))
              .filter(Boolean)
              .slice(0, 5),
            prevented: event.defaultPrevented
          })
        },
        { capture: true, once: true }
      )
    return {
      point,
      hit: document.elementFromPoint(point.x, point.y)?.outerHTML.slice(0, 300),
      paper: paperRect.toJSON(),
      frame: frameRect.toJSON(),
      selection: selection.toString(),
      beforeLabel: right.querySelector('[data-testid="reading-page-indicator"]')
        .textContent
    }
  })
  report.setup = setup
  assert(setup.selection.length > 0, 'Expected another pane native selection')
  assert(
    setup.point.x > setup.frame.right + 1 &&
      setup.point.x < setup.paper.right &&
      setup.point.x >= setup.paper.left + (setup.paper.width * 2) / 3,
    'Expected a next-zone point outside the chapter iframe'
  )
  await page.mouse.click(setup.point.x, setup.point.y)
  await page.waitForFunction(() => {
    const right = document.querySelector('[data-epub-pane="right"]')
    return right
      .querySelector('foliate-view')
      ?.renderer?.getContents()[0]
      ?.doc?.body.textContent.includes('SECOND FIXED PAGE')
  })
  const result = await page.evaluate(() => {
    const right = document.querySelector('[data-epub-pane="right"]')
    return {
      trace: window.__epubPaneTrace,
      navigation: window.__epubNavCalls,
      afterText: right
        .querySelector('foliate-view')
        .renderer.getContents()
        .map((content) => content.doc.body.textContent)
        .join('')
    }
  })
  assert.equal(result.trace[0]?.selection, setup.selection)
  assert.equal(result.trace[0]?.anchorInLeft, true)
  assert(
    result.navigation.some(
      (call) => call.name === 'goTo' && call.args[0]?.index === 1
    )
  )
  assert.match(result.afterText, /SECOND FIXED PAGE/)
  assert.deepEqual(report.errors, [])
  report.case = { ...setup, ...result }
  await page.screenshot({ path: resolve(output, 'passed.png') })
  console.log('EPUB dual-pane native selection: 1/1 passed')
} catch (error) {
  report.failure = error.stack
  report.trace = await page
    ?.evaluate(() => window.__epubPaneTrace)
    .catch(() => [])
  report.navigation = await page
    ?.evaluate(() => window.__epubNavCalls)
    .catch(() => [])
  await page
    ?.screenshot({ path: resolve(output, 'failed.png') })
    .catch(() => {})
  throw error
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
