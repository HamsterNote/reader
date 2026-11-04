import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham161-browser')
await mkdir(output, { recursive: true })
const pdf = await PDFDocument.create()
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (let p = 0; p < 4; p++) {
  const sheet = pdf.addPage([600, 2000])
  if (p === 0 || p === 3)
    for (let i = 0; i < 90; i++)
      sheet.drawText(
        `Repeated reading line ${i % 3}. Same words; unique source position.`,
        { x: 30, y: 1960 - i * 21, size: 12, font }
      )
}
const bytes = await pdf.save()
await writeFile(resolve(output, 'progress-fixture.pdf'), bytes)
const entry = `
import React, { useState } from 'react'
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
window.fixtureGeneration = 0
window.saved = {}
window.writes = []
function App() {
  const [data, setData] = useState({})
  const [version, setVersion] = useState(0)
  const [scale, setScale] = useState(1)
  const [crop, setCrop] = useState(undefined)
  window.setCrop = setCrop
  window.reopen = (nextScale, value = window.saved) => {
    window.fixtureGeneration++; window.saved = value; flushSync(() => { setData(value); setScale(nextScale); setVersion(v => v + 1) })
  }
  const save = useReadingProgressSaves(version, data, next => { if (window.fixtureGeneration !== version) return; window.saved = next; window.writes.push(next); setData(next) })
  return <EngineDocumentViewer key={version} document={opened.document} engineSource={source}
    engineRenderMode='layout' layoutReadingProgress={data.layoutReadingProgress} onLayoutReadingProgressChange={save.layout}
    edgeCrop={crop} useVirtualPaper={false} nativeLayoutZoom={scale} defaultScale={scale}
    containMarginX={0} containMarginY={0} />
}
createRoot(document.getElementById('root')).render(<App />)
`
const server = await createServer({
  configFile: false,
  cacheDir: resolve(output, 'vite-cache'),
  root: repo,
  resolve: { alias: { '@hamster-note/reader': resolve(repo, 'src/index.ts') } },
  optimizeDeps: { entries: [] },
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
          if (req.url !== '/') return next()
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
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  for (const width of process.env.READER_PROGRESS_WIDTH
    ? [Number(process.env.READER_PROGRESS_WIDTH)]
    : [320, 1280])
    for (const scale of process.env.READER_PROGRESS_SCALE
      ? [Number(process.env.READER_PROGRESS_SCALE)]
      : [0.5, 1, 2]) {
      const page = await browser.newPage({ viewport: { width, height: 740 } })
      page.setDefaultTimeout(15000)
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
        console.error('browser:', error.message)
      })
      await page.goto(server.resolvedUrls.local[0])
      await page.waitForFunction(
        () =>
          window.reopen &&
          document.querySelector('[data-selection-start-offset]')
      )
      await page.evaluate((scale) => window.reopen(scale, {}), scale)
      await page.waitForFunction(
        (scale) =>
          window.pdfViewer?.currentScale === scale &&
          document.querySelector('[data-selection-start-offset]'),
        scale
      )
      for (const line of [20, 55]) {
        const expected = await page.evaluate((line) => {
          const container = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          const spans = Array.from(
            document.querySelectorAll('[data-selection-start-offset]')
          )
          const target = spans[line]
          container.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
          container.scrollTop +=
            target.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            3
          container.dispatchEvent(new Event('scroll'))
          return {
            textId: target.dataset.textId,
            offset: Number(target.dataset.selectionStartOffset)
          }
        }, line)
        await page.waitForFunction(
          (expected) =>
            window.saved.layoutReadingProgress?.textId === expected.textId,
          expected
        )
        const saved = await page.evaluate(
          () => window.saved.layoutReadingProgress
        )
        await page.evaluate((scale) => window.reopen(scale), scale)
        await page.waitForFunction((saved) => {
          const span = document.querySelector(
            '[data-text-id="' + saved.textId + '"]'
          )
          if (!span) return false
          const range = document.createRange()
          const offset =
            saved.offset - Number(span.dataset.selectionStartOffset)
          range.setStart(span.firstChild, offset)
          range.setEnd(span.firstChild, offset + 1)
          const top = range.getBoundingClientRect().top
          const container = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          return Math.abs(top - container.getBoundingClientRect().top) <= 2
        }, saved)
        const error = await page.evaluate((saved) => {
          const span = document.querySelector(
            '[data-text-id="' + saved.textId + '"]'
          )
          const range = document.createRange(),
            offset = saved.offset - Number(span.dataset.selectionStartOffset)
          range.setStart(span.firstChild, offset)
          range.setEnd(span.firstChild, offset + 1)
          return (
            range.getBoundingClientRect().top -
            document
              .querySelector('.hamster-reader__pdf-viewer-container')
              .getBoundingClientRect().top
          )
        }, saved)
        assert(
          Math.abs(error) <= 2,
          JSON.stringify({ width, scale, line, error })
        )
        report.cases.push({ width, scale, kind: 'text', line, saved, error })
      }
      for (const percentage of [40, 98]) {
        await page.evaluate(
          ({ scale, percentage }) =>
            window.reopen(scale, {
              layoutReadingProgress: {
                pageNumber: 2,
                verticalPercentage: percentage - 5
              }
            }),
          { scale, percentage }
        )
        await page
          .waitForFunction(
            ({ scale, percentage }) => {
              const viewer = window.pdfViewer,
                container = document.querySelector(
                  '.hamster-reader__pdf-viewer-container'
                )
              const sheet = viewer?.getPageView(1)?.div
              if (!sheet || viewer.currentScale !== scale) return false
              const rect = sheet.getBoundingClientRect()
              if (!sheet.isConnected || rect.height <= 0 || rect.width <= 0)
                return false
              const projected =
                rect.top +
                (rect.height * (percentage - 5)) / 100 -
                container.getBoundingClientRect().top
              return Math.abs(projected) <= 2
            },
            { scale, percentage }
          )
          .catch(async (error) => {
            console.error(
              'ratio-timeout',
              { width, scale, percentage },
              await page.evaluate(() => {
                const v = window.pdfViewer,
                  c = document.querySelector(
                    '.hamster-reader__pdf-viewer-container'
                  )
                return {
                  scale: v?.currentScale,
                  page: v?.currentPageNumber,
                  scroll: c?.scrollTop,
                  total: c?.scrollHeight,
                  pages: [0, 1, 2].map((i) => {
                    const d = v?.getPageView(i)?.div
                    const r = d?.getBoundingClientRect()
                    return {
                      display: d?.style.display,
                      top: r?.top,
                      height: r?.height
                    }
                  }),
                  saved: window.saved
                }
              })
            )
            throw error
          })
        // Exercise capture -> debounce -> stored snapshot -> reopen, not only seeded restore.
        await page.evaluate((percentage) => {
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          c.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
          const rect = window.pdfViewer
            .getPageView(1)
            .div.getBoundingClientRect()
          c.scrollTop +=
            rect.top +
            (rect.height * percentage) / 100 -
            c.getBoundingClientRect().top
          c.dispatchEvent(new Event('scroll'))
        }, percentage)
        await page
          .waitForFunction((percentage) => {
            const p = window.saved.layoutReadingProgress
            return (
              p?.pageNumber === 2 &&
              Math.abs(p.verticalPercentage - percentage) < 1
            )
          }, percentage)
          .catch(async (error) => {
            console.error(
              'capture-timeout',
              { width, scale, percentage },
              await page.evaluate(() => ({
                saved: window.saved,
                writes: window.writes.slice(-8),
                scroll: document.querySelector(
                  '.hamster-reader__pdf-viewer-container'
                ).scrollTop,
                pages: [0, 1, 2, 3].map((i) =>
                  window.pdfViewer
                    .getPageView(i)
                    .div.getBoundingClientRect()
                    .toJSON()
                )
              }))
            )
            throw error
          })
        const saved = await page.evaluate(
          () => window.saved.layoutReadingProgress
        )
        await page.evaluate((scale) => window.reopen(scale), scale)
        await page.waitForFunction(
          ({ scale, percentage }) => {
            const v = window.pdfViewer,
              c = document.querySelector(
                '.hamster-reader__pdf-viewer-container'
              )
            const r = v?.getPageView(1)?.div.getBoundingClientRect()
            return (
              r?.height > 0 &&
              v.currentScale === scale &&
              Math.abs(
                r.top +
                  (r.height * percentage) / 100 -
                  c.getBoundingClientRect().top
              ) <= 2
            )
          },
          { scale, percentage: saved.verticalPercentage }
        )
        const error = await page.evaluate((percentage) => {
          const r = window.pdfViewer.getPageView(1).div.getBoundingClientRect()
          return (
            r.top +
            (r.height * percentage) / 100 -
            document
              .querySelector('.hamster-reader__pdf-viewer-container')
              .getBoundingClientRect().top
          )
        }, saved.verticalPercentage)
        assert(
          Math.abs(error) <= 2,
          JSON.stringify({ width, scale, percentage, error })
        )
        report.cases.push({
          width,
          scale,
          kind: 'page-roundtrip',
          percentage,
          saved,
          error
        })
      }
      if (scale === 2) {
        await page.evaluate(
          (scale) =>
            window.reopen(scale, {
              layoutReadingProgress: { pageNumber: 2, verticalPercentage: 40 }
            }),
          scale
        )
        await page.waitForFunction(
          () =>
            window.pdfViewer?.getPageView(1)?.div.getBoundingClientRect()
              .height > 5000
        )
        await page.evaluate(() => {
          window.pdfViewer.pagesRotation = 90
        })
        await page.waitForFunction(() => {
          const r = window.pdfViewer
            ?.getPageView(1)
            ?.div.getBoundingClientRect()
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          return (
            window.pdfViewer?.pagesRotation === 90 &&
            r?.height > 0 &&
            r.height < 2000 &&
            Math.abs(r.top + r.height * 0.4 - c.getBoundingClientRect().top) <=
              2
          )
        })
        report.cases.push({
          width,
          scale,
          kind: 'rotation-new-display-box',
          percentage: 40
        })
        await page.evaluate(() =>
          window.setCrop({ all: { top: 0.1, bottom: 0.2, left: 0, right: 0 } })
        )
        await page.waitForFunction(() => {
          const r = window.pdfViewer
            ?.getPageView(1)
            ?.div.getBoundingClientRect()
          const c = document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )
          return (
            Math.abs(
              r.top +
                r.height * (0.1 + 0.7 * 0.4) -
                c.getBoundingClientRect().top
            ) <= 2
          )
        })
        report.cases.push({
          width,
          scale,
          kind: 'crop-new-display-box',
          percentage: 40
        })
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
} finally {
  await writeFile(
    resolve(output, 'reading-progress.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await server.close()
}
console.log(JSON.stringify(report, null, 2))
