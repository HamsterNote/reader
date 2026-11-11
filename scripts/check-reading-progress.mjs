import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(
  repo,
  process.env.READER_PROGRESS_OUTPUT || '../ham228-browser'
)
await mkdir(output, { recursive: true })
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (let p = 0; p < 16; p++) {
  const sheet = pdf.addPage([600, 2000])
  if (p === 0 || p === 15)
    for (let i = 0; i < 90; i++)
      sheet.drawText(
        `Repeated reading line ${i % 3}. Same words; unique source position.`,
        { x: 30, y: 1960 - i * 21, size: 12, font }
      )
}
const bytes = await pdf.save()
await writeFile(resolve(output, 'progress-fixture.pdf'), bytes)
const entry = `
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { EngineDocumentViewer } from '/src/components/EngineDocumentViewer.tsx'
import { useReadingProgressSaves } from '/src/components/Reader/useLayoutReadingProgressSave.ts'
import { openReaderDocument } from '/src/host/openReaderDocument.ts'
import { PDFViewer } from '/src/pdf/pdfViewerLib.ts'
import { configurePdfJsWorker } from '/src/pdf/pdfjsRuntime.ts'
import workerSrc from '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url'
configurePdfJsWorker(workerSrc)
import '/src/styles/index.scss'
const original = PDFViewer.prototype.setDocument
PDFViewer.prototype.setDocument = function(doc) { window.pdfViewer = this; return original.call(this, doc) }
const source = { format: 'pdf', workerSrc, data: new Uint8Array(await (await fetch('/publication.pdf')).arrayBuffer()) }
const opened = await openReaderDocument(source, 'progress-browser')
const params = new URLSearchParams(location.search)
const inset = Number(params.get('inset') || 0)
const reserved = params.has('reserved')
const fullReader = params.has('reader')
const Reader = fullReader ? (await import('/src/components/Reader.tsx')).Reader : null
document.getElementById('root').style.cssText = reserved ? 'height:calc(100% - 80px);margin-top:80px' : ''
window.fixtureGeneration = 0
window.saved = {}
window.writes = []
function App() {
  const [data, setData] = useState({})
  const [version, setVersion] = useState(0)
  const [scale, setScale] = useState(1)
  const [crop, setCrop] = useState(undefined)
  const [cropEditing, setCropEditing] = useState(false)
  const positionRef = useRef(null)
  window.capturePosition = () => positionRef.current?.captureReadingPosition?.()
  window.captureHandoff = () => positionRef.current?.captureModeSwitchPosition?.()
  window.currentData = () => data
  window.seek = bookmark => flushSync(() => setData(current => ({ ...current, layoutReadingProgress: bookmark })))
  window.setCrop = setCrop
  window.setCropEditing = setCropEditing
  window.reopen = (nextScale, value = window.saved) => {
    window.fixtureGeneration++; window.saved = value; flushSync(() => { setData(value); setScale(nextScale); setVersion(v => v + 1) })
  }
  const save = useReadingProgressSaves(version, data, next => { if (window.fixtureGeneration !== version) return; window.saved = next; window.writes.push(next); setData(next) })
  window.flushProgress = () => { positionRef.current.captureAndPublish(); save.flush() }
  if (fullReader) return <Reader isPdf key={version} document={opened.document} engineSource={source}
    data={data} onDataChange={next => { window.saved = next; window.writes.push(next); setData(next) }}
    useVirtualPaper={false} nativeLayoutZoom={scale} defaultScale={scale}
    containMarginX={0} containMarginY={0} containMarginTop={inset} />
  return <EngineDocumentViewer key={version} document={opened.document} engineSource={source}
    engineRenderMode='layout' layoutReadingProgress={data.layoutReadingProgress} onLayoutReadingProgressChange={save.layout}
    edgeCrop={crop} edgeCropEditing={cropEditing} readingPositionRef={positionRef} useVirtualPaper={false} nativeLayoutZoom={scale} defaultScale={scale}
    containMarginX={0} containMarginY={0} containMarginTop={inset} />
}
createRoot(document.getElementById('root')).render(<App />)
`
const server = await createServer({
  configFile: false,
  cacheDir: resolve(output, 'vite-cache'),
  root: repo,
  resolve: {
    alias: [
      {
        find: /^@hamster-note\/reader$/,
        replacement: resolve(repo, 'src/index.ts')
      },
      {
        find: /^clipper-lib$/,
        replacement: resolve(repo, 'src/vendor/clipper-lib.ts')
      }
    ]
  },
  optimizeDeps: {
    entries: [],
    noDiscovery: true,
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'pdfjs-dist',
      'pdfjs-dist/web/pdf_viewer.mjs',
      '@hamster-note/types',
      '@hamster-note/painting/core',
      '@hamster-note/painting/layered',
      '@hamster-note/components',
      'html2canvas',
      '@system-ui-js/multi-drag',
      '@hamster-note/selection',
      '@hamster-note/virtual-paper'
    ],
    exclude: [
      '@hamster-note/pdf-parser',
      '@hamster-note/image-parser',
      '@paddleocr/paddleocr-js'
    ]
  },
  plugins: [
    react(),
    {
      name: 'reading-progress-fixture',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url === '/publication.pdf') {
            res.setHeader('Content-Type', 'application/pdf')
            return res.end(bytes)
          }
          if (req.url === '/progress-entry.tsx') {
            const result = await vite.transformRequest('/progress-virtual.tsx')
            res.setHeader('Content-Type', 'application/javascript')
            return res.end(result.code)
          }
          if (req.url?.split('?')[0] !== '/') return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(
            await vite.transformIndexHtml(
              '/',
              '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/progress-virtual.tsx"></script></body></html>'
            )
          )
        })
      },
      resolveId(id) {
        if (id === '/progress-virtual.tsx') return id
      },
      load(id) {
        if (id === '/progress-virtual.tsx') return entry
      }
    }
  ],
  server: {
    host: '127.0.0.1',
    port: 0,
    hmr: false,
    fs: { allow: [repo, output] }
  }
})
const report = {
  environment:
    'Linux headless Chromium; actual PDF.js layout, no device claims',
  cases: []
}
// Both viewport and page geometry are measured by Chromium; no mocked bounds.
const sample = ({
  pageNumber,
  percentage,
  inset = 0,
  crop = { top: 0, bottom: 0 }
}) => {
  const c = document.querySelector('.hamster-reader__pdf-viewer-container')
  const div = window.pdfViewer?.getPageView(pageNumber - 1)?.div
  if (!c || !div?.isConnected || !c.contains(div)) return null
  const r = div.getBoundingClientRect()
  if (!r.height || !Number.isFinite(r.height)) return null
  const top = r.top + r.height * (crop.top || 0)
  const height = r.height * (1 - (crop.top || 0) - (crop.bottom || 0))
  const safeTop = c.getBoundingClientRect().top + inset
  const delta = top + (height * percentage) / 100 - safeTop
  const expectedScroll = Math.max(
    0,
    Math.min(c.scrollHeight - c.clientHeight, c.scrollTop + delta)
  )
  if (
    !Number.isFinite(expectedScroll) ||
    Math.abs(c.scrollTop - expectedScroll) > 2
  )
    return null
  return {
    pageNumber,
    percentage,
    safeTop,
    top,
    height,
    error: c.scrollTop - expectedScroll,
    target: window.captureHandoff?.(),
    saved: window.saved.layoutReadingProgress
  }
}
const firstSource = ({ selector, inset }) => {
  const root = document.querySelector(selector)
  if (!root) return null
  const v = root.getBoundingClientRect()
  const isVisibleCharacter = (rect) =>
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < v.bottom - 80 &&
    rect.bottom > v.top + inset &&
    rect.left < v.right &&
    rect.right > v.left
  let first
  const scanTextNode = (span, node, base) => {
    for (let i = 0; i < node.length; i++) {
      if (!node.textContent[i].trim()) continue
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const r = range.getBoundingClientRect()
      if (isVisibleCharacter(r) && (!first || r.top < first.top - 0.5)) {
        first = {
          textId: span.dataset.textId,
          pageNumber: Number(
            span.dataset.pageNumber ||
              span.closest('[data-page-number]')?.dataset.pageNumber ||
              1
          ),
          offset: Number(span.dataset.selectionStartOffset) + base + i,
          top: r.top,
          safeTop: v.top + inset
        }
      }
    }
  }
  for (const span of root.querySelectorAll(
    '[data-text-id][data-selection-start-offset]'
  )) {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
    let node,
      base = 0
    while ((node = walker.nextNode())) {
      scanTextNode(span, node, base)
      base += node.length
    }
  }
  return first
}
async function measure(page, args) {
  const handle = await page.waitForFunction(sample, args)
  return handle.jsonValue()
}
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const widths = process.env.READER_PROGRESS_WIDTH
    ? [Number(process.env.READER_PROGRESS_WIDTH)]
    : [320, 1280]
  const scales = process.env.READER_PROGRESS_SCALE
    ? [Number(process.env.READER_PROGRESS_SCALE)]
    : [0.5, 1, 2]
  for (const width of widths)
    for (const scale of scales) {
      for (const safe of [
        { inset: 0 },
        { inset: 80 },
        { inset: 0, reserved: true }
      ]) {
        const page = await browser.newPage({ viewport: { width, height: 740 } })
        const errors = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
          console.error(error.message)
        })
        page.on('console', (msg) => {
          if (msg.type() === 'error') console.error(msg.text())
        })
        page.setDefaultTimeout(15000)
        await page.goto(
          server.resolvedUrls.local[0] +
            '?inset=' +
            safe.inset +
            (safe.reserved ? '&reserved=1' : '')
        )
        await page.waitForFunction(
          () =>
            window.reopen &&
            document.querySelector('[data-selection-start-offset]')
        )
        const restore = async (pageNumber, percentage) => {
          await page.evaluate(
            ({ scale, pageNumber, percentage }) =>
              window.reopen(scale, {
                layoutReadingProgress: {
                  pageNumber,
                  verticalPercentage: percentage
                }
              }),
            { scale, pageNumber, percentage }
          )
          await page.waitForFunction(
            ({ scale, pageNumber, percentage, inset }) => {
              const c = document.querySelector(
                '.hamster-reader__pdf-viewer-container'
              )
              const r = window.pdfViewer
                ?.getPageView(pageNumber - 1)
                ?.div.getBoundingClientRect()
              if (!r?.height || window.pdfViewer.currentScale !== scale)
                return false
              const delta =
                r.top +
                (r.height * percentage) / 100 -
                c.getBoundingClientRect().top -
                inset
              const expected = Math.max(
                0,
                Math.min(c.scrollHeight - c.clientHeight, c.scrollTop + delta)
              )
              return Math.abs(c.scrollTop - expected) <= 2
            },
            { scale, pageNumber, percentage, inset: safe.inset }
          )
        }
        // Distinct positions on text pages, blank-page fallback, and a recycled late page.
        for (const [pageNumber, percentage] of [
          [1, 35],
          [1, 65],
          [2, 60],
          [16, 35],
          [1, 35],
          [16, 100]
        ]) {
          await restore(pageNumber, Math.max(0, percentage - 5))
          const actual = await page.evaluate(
            ({ pageNumber, percentage, inset }) => {
              const c = document.querySelector(
                '.hamster-reader__pdf-viewer-container'
              )
              const r = window.pdfViewer
                .getPageView(pageNumber - 1)
                .div.getBoundingClientRect()
              c.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
              c.scrollTop +=
                r.top +
                (r.height * percentage) / 100 -
                c.getBoundingClientRect().top -
                inset
              c.dispatchEvent(new Event('scroll'))
              window.flushProgress()
              return window.saved.layoutReadingProgress
            },
            { pageNumber, percentage, inset: safe.inset }
          )
          assert.equal(actual.pageNumber, pageNumber)
          assert.ok(
            Number.isFinite(actual.verticalPercentage) && !('offset' in actual)
          )
          if (percentage !== 100)
            assert.ok(
              Math.abs(actual.verticalPercentage - percentage) < 0.15,
              JSON.stringify(actual)
            )
          await restore(actual.pageNumber, actual.verticalPercentage)
          const result = await measure(page, {
            pageNumber,
            percentage: actual.verticalPercentage,
            inset: safe.inset
          })
          assert.ok(Math.abs(result.error) <= 2, JSON.stringify(result))
          let kind = 'text-geometry-roundtrip'
          if (percentage === 100) kind = 'clamped-tail'
          else if (pageNumber === 2) kind = 'blank-roundtrip'
          report.cases.push({
            width,
            scale,
            ...safe,
            kind,
            requested: percentage,
            ...result
          })
        }
        // Ratio semantics follow the new display box on rotation and crop.
        await restore(2, 40)
        await page.evaluate(() => {
          window.pdfViewer.pagesRotation = 90
        })
        await page.waitForFunction(({ inset }) => {
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          const r = window.pdfViewer.getPageView(1)?.div.getBoundingClientRect()
          return (
            window.pdfViewer.pagesRotation === 90 &&
            Math.abs(
              r.top + r.height * 0.4 - c.getBoundingClientRect().top - inset
            ) <= 2
          )
        }, safe)
        let result = await measure(page, {
          pageNumber: 2,
          percentage: 40,
          inset: safe.inset
        })
        report.cases.push({
          width,
          scale,
          ...safe,
          kind: 'rotation',
          ...result
        })
        await page.evaluate(() =>
          window.setCrop({ all: { top: 0.1, bottom: 0.2, left: 0, right: 0 } })
        )
        await page.waitForFunction(({ inset }) => {
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          const r = window.pdfViewer.getPageView(1)?.div.getBoundingClientRect()
          return (
            Math.abs(
              r.top +
                r.height * (0.1 + 0.7 * 0.4) -
                c.getBoundingClientRect().top -
                inset
            ) <= 2
          )
        }, safe)
        result = await measure(page, {
          pageNumber: 2,
          percentage: 40,
          inset: safe.inset,
          crop: { top: 0.1, bottom: 0.2 }
        })
        report.cases.push({ width, scale, ...safe, kind: 'crop', ...result })
        if (width === 320 && scale === 1 && safe.inset === 80) {
          await page.evaluate(() => window.setCrop(undefined))
          await restore(1, 35)
          for (let pageNumber = 1; pageNumber <= 16; pageNumber++) {
            await page.evaluate((pageNumber) => {
              const c = document.querySelector(
                '.hamster-reader__pdf-viewer-container'
              )
              c.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
              window.pdfViewer.scrollPageIntoView({ pageNumber })
            }, pageNumber)
            await page.waitForFunction(
              (pageNumber) =>
                window.pdfViewer.getPageView(pageNumber - 1)?.renderingState ===
                3,
              pageNumber
            )
          }
          const evicted = await page.evaluate(
            () => window.pdfViewer.getPageView(0).renderingState !== 3
          )
          assert.equal(
            evicted,
            true,
            'PDF.js should recycle the first page after visiting 16 pages'
          )
          await page.evaluate(() =>
            window.seek({ pageNumber: 1, verticalPercentage: 42.5 })
          )
          await page.waitForFunction(() => {
            const c = document.querySelector(
              '.hamster-reader__pdf-viewer-container'
            )
            const r = window.pdfViewer
              .getPageView(0)
              ?.div.getBoundingClientRect()
            return (
              r &&
              Math.abs(
                r.top + r.height * 0.425 - c.getBoundingClientRect().top - 80
              ) <= 2
            )
          })
          result = await measure(page, {
            pageNumber: 1,
            percentage: 42.5,
            inset: 80
          })
          report.cases.push({
            width,
            scale,
            ...safe,
            kind: 'actual-page-recycling',
            evicted,
            ...result
          })
        }
        await page.goto(
          server.resolvedUrls.local[0] +
            '?reader=1&inset=' +
            safe.inset +
            (safe.reserved ? '&reserved=1' : '')
        )
        await page.waitForFunction(
          () =>
            window.reopen &&
            document.querySelector(
              '.hamster-reader__pdf-viewer-container [data-text-id]'
            )
        )
        await page.evaluate(() =>
          window.reopen(1, {
            layoutReadingProgress: { pageNumber: 1, verticalPercentage: 35 },
            textReadingProgress: { currentPageNumber: 16 }
          })
        )
        await page.waitForFunction(({ inset }) => {
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          const r = window.pdfViewer
            ?.getPageView(0)
            ?.div.getBoundingClientRect()
          return (
            r &&
            Math.abs(
              r.top + r.height * 0.35 - c.getBoundingClientRect().top - inset
            ) <= 2 &&
            c.querySelector('[data-text-id]')
          )
        }, safe)
        await page.getByTestId('tool-bottom-bar-layout-zoom').click()
        await page
          .getByLabel(String(scale * 100) + '%', { exact: true })
          .click()
        await page.waitForFunction(
          (scale) => window.pdfViewer.currentScale === scale,
          scale
        )
        const a = await page.evaluate(firstSource, {
          selector: '.hamster-reader__pdf-viewer-container',
          inset: safe.inset
        })
        assert.ok(a, 'source A must be visible')
        await page.getByTestId('tool-bottom-bar-render-mode').click()
        await page.waitForSelector(
          '.hamster-reader__pdf-text-viewport [data-text-id]'
        )
        const received = await page.evaluate(
          () => window.saved.textReadingProgress
        )
        assert.equal(received.anchor.offset, a.offset)
        assert.equal(received.currentPageNumber, a.pageNumber)
        // The target character is contained in the Text page; Text keeps button pagination.
        const textScroll = await page
          .locator('.hamster-reader__pdf-text-viewport')
          .evaluate((c) => c.scrollTop)
        assert.equal(textScroll, 0)
        await page.getByRole('button', { name: '下一页', exact: true }).click()
        await page.waitForFunction(
          (offset) =>
            window.saved.textReadingProgress?.anchor?.offset !== offset,
          received.anchor.offset
        )
        let b = await page.evaluate(firstSource, {
          selector: '.hamster-reader__pdf-text-viewport',
          inset: safe.inset
        })
        assert.ok(b, 'source B must be visible')
        await page.getByTestId('tool-bottom-bar-render-mode').click()
        await page.waitForFunction(
          ({ b, inset }) => {
            const c = document.querySelector(
              '.hamster-reader__pdf-viewer-container'
            )
            const span = c?.querySelector('[data-text-id="' + b.textId + '"]')
            if (!span?.firstChild) return false
            const offset = b.offset - Number(span.dataset.selectionStartOffset)
            if (offset < 0 || offset >= span.firstChild.length) return false
            const range = document.createRange()
            range.setStart(span.firstChild, offset)
            range.setEnd(span.firstChild, offset + 1)
            return (
              Math.abs(
                range.getBoundingClientRect().top -
                  c.getBoundingClientRect().top -
                  inset
              ) <= 2
            )
          },
          { b, inset: safe.inset }
        )
        const returned = await page.evaluate(firstSource, {
          selector: '.hamster-reader__pdf-viewer-container',
          inset: safe.inset
        })
        report.cases.push({
          width,
          scale,
          ...safe,
          kind: 'safe-text-handoff',
          sourceA: a,
          targetText: received.anchor,
          sourceB: b,
          returned,
          error: returned.top - returned.safeTop
        })
        // An unchanged second round trip must retain the same source identity.
        await page.getByTestId('tool-bottom-bar-render-mode').click()
        await page.waitForSelector(
          '.hamster-reader__pdf-text-viewport [data-text-id]'
        )
        b = await page.evaluate(firstSource, {
          selector: '.hamster-reader__pdf-text-viewport',
          inset: safe.inset
        })
        await page.getByTestId('tool-bottom-bar-render-mode').click()
        await page.waitForSelector(
          '.hamster-reader__pdf-viewer-container [data-text-id]'
        )
        await page.waitForFunction(
          ({ b, inset }) => {
            const c = document.querySelector(
              '.hamster-reader__pdf-viewer-container'
            )
            const span = c?.querySelector('[data-text-id="' + b.textId + '"]')
            if (!span) return false
            const range = document.createRange(),
              offset = b.offset - Number(span.dataset.selectionStartOffset)
            range.setStart(span.firstChild, offset)
            range.setEnd(span.firstChild, offset + 1)
            return (
              Math.abs(
                range.getBoundingClientRect().top -
                  c.getBoundingClientRect().top -
                  inset
              ) <= 2
            )
          },
          { b, inset: safe.inset }
        )
        const repeated = await page.evaluate(firstSource, {
          selector: '.hamster-reader__pdf-viewer-container',
          inset: safe.inset
        })
        assert.equal(repeated.offset, returned.offset)
        report.cases.push({
          width,
          scale,
          ...safe,
          kind: 'repeated-handoff',
          sourceB: b,
          returned: repeated,
          error: repeated.top - repeated.safeTop
        })
        await page.evaluate(() =>
          window.reopen(1, {
            layoutReadingProgress: { pageNumber: 2, verticalPercentage: 60 }
          })
        )
        await page.waitForFunction(({ inset }) => {
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          const r = window.pdfViewer
            ?.getPageView(1)
            ?.div.getBoundingClientRect()
          return (
            r &&
            Math.abs(
              r.top + r.height * 0.6 - c.getBoundingClientRect().top - inset
            ) <= 2
          )
        }, safe)
        await page.waitForFunction(() =>
          window.pdfViewer.getPageView(1)?.div.querySelector('.textLayer')
        )
        await page.getByTestId('tool-bottom-bar-render-mode').click()
        await page
          .waitForSelector('.hamster-reader__pdf-text-empty')
          .catch(async (error) => {
            console.error(
              'blank-mode',
              await page.evaluate(() => ({
                saved: window.saved,
                body: document.body.innerText,
                page: window.pdfViewer.currentPageNumber,
                state: window.pdfViewer.getPageView(1)?.renderingState
              }))
            )
            throw error
          })
        const blankProgress = await page.evaluate(
          () => window.saved.textReadingProgress
        )
        assert.equal(blankProgress.currentPageNumber, 2)
        assert.ok(Math.abs(blankProgress.verticalPercentage - 60) < 0.15)
        await page.getByTestId('tool-bottom-bar-render-mode').click()
        await page.waitForFunction(({ inset }) => {
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          const r = window.pdfViewer
            ?.getPageView(1)
            ?.div.getBoundingClientRect()
          return (
            r &&
            Math.abs(
              r.top + r.height * 0.6 - c.getBoundingClientRect().top - inset
            ) <= 2
          )
        }, safe)
        result = await measure(page, {
          pageNumber: 2,
          percentage: 60,
          inset: safe.inset
        })
        report.cases.push({
          width,
          scale,
          ...safe,
          kind: 'blank-mode-roundtrip',
          ...result
        })
        assert.deepEqual(errors, [])
        await page.close()
      }
    }
} finally {
  await writeFile(
    resolve(output, 'reading-progress.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
assert.ok(
  report.cases.every((c) => Number.isFinite(c.error) && Math.abs(c.error) <= 2),
  'every recorded alignment must be finite and within 2 CSS px'
)
console.log(
  JSON.stringify(
    {
      cases: report.cases.length,
      maxError: Math.max(...report.cases.map((c) => Math.abs(c.error))),
      report: resolve(output, 'reading-progress.json')
    },
    null,
    2
  )
)
