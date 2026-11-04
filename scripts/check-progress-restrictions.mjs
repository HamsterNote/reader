import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham161-restrictions')
await mkdir(output, { recursive: true })
const publications = {
  pdf: await readFile(resolve(repo, 'test/compat/fixtures/pdf/two-column.pdf')),
  epub: await readFile(
    resolve(repo, 'test/compat/fixtures/epub/duplicate-text.epub')
  )
}
// PDF needs three source pages so the hidden target can fall forward inside the range.
const { PDFDocument } = await import('pdf-lib')
const pdf = await PDFDocument.create()
for (let i = 0; i < 3; i++)
  pdf.addPage([400, 600]).drawText(`SOURCE PAGE ${i + 1}`)
publications.pdf = await pdf.save()
const entry = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Reader} from '/src/components/Reader.tsx'
import {openReaderDocument} from '/src/host/openReaderDocument.ts'
import {configurePdfJsWorker} from '/src/pdf/pdfjsRuntime.ts'
import workerSrc from '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url'
import '/src/styles/index.scss'
configurePdfJsWorker(workerSrc)
const format=new URLSearchParams(location.search).get('format')
const source={format,workerSrc,data:new Uint8Array(await (await fetch('/publication.'+format)).arrayBuffer())}
const opened=await openReaderDocument(source,'restrictions-'+format)
window.readerWrites=[]
createRoot(document.getElementById('root')).render(<Reader document={opened.document} engineSource={source}
  isPdf={format==='pdf'} isEpub={format==='epub'} pageRange={{start:2,end:3}}
  data={{renderMode:'text',hiddenPages:[2],textReadingProgress:{currentPageNumber:2}}}
  onDataChange={data=>window.readerWrites.push(data)} useVirtualPaper={false}/>)
`
const server = await createServer({
  configFile: false,
  root: repo,
  cacheDir: resolve(output, 'vite-cache'),
  plugins: [
    react(),
    {
      name: 'progress-restrictions',
      resolveId: (id) => (id === '/restriction-entry.jsx' ? id : undefined),
      load: (id) => (id === '/restriction-entry.jsx' ? entry : undefined),
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const format = /^\/publication\.(pdf|epub)$/.exec(req.url)?.[1]
          if (format) return res.end(publications[format])
          if (req.url?.split('?')[0] !== '/') return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(
            await vite.transformIndexHtml(
              '/',
              '<html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/restriction-entry.jsx"></script></body></html>'
            )
          )
        })
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
const report = { cases: [] }
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  for (const format of ['pdf', 'epub']) {
    const page = await browser.newPage({
      viewport: { width: 960, height: 740 }
    })
    page.setDefaultTimeout(30000)
    page.on('pageerror', (error) => console.error('browser', error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('console', message.text())
    })
    await page.goto(server.resolvedUrls.local[0] + '?format=' + format)
    if (format === 'pdf') {
      await page
        .locator(
          '.hamster-reader__intermediate-text-page[data-page-number="3"]'
        )
        .waitFor()
        .catch(async (error) => {
          console.error('DOM', await page.locator('body').innerText())
          throw error
        })
      await page.getByText('SOURCE PAGE 3', { exact: true }).waitFor()
    } else {
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view')?.renderer?.getContents()[0]
            ?.index === 2
      )
    }
    await page.waitForFunction(() => {
      const p = document.querySelector('[aria-label="上一页"]'),
        n = document.querySelector('[aria-label="下一页"]')
      return p && n && p.disabled
    })
    assert.equal(
      await page
        .getByRole('button', { name: '上一页', exact: true })
        .isDisabled(),
      true
    )
    let turns = 0
    while (
      await page
        .getByRole('button', { name: '下一页', exact: true })
        .isEnabled()
    ) {
      assert(turns++ < 20, 'range boundary must stop navigation')
      await page.getByRole('button', { name: '下一页', exact: true }).click()
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="上一页"]').disabled
      )
    }
    if (format === 'epub')
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector('foliate-view').renderer.getContents()[0]
              .index
        ),
        2
      )
    const writes = await page.evaluate(() => window.readerWrites)
    assert(
      writes.every(
        (data) =>
          !data.textReadingProgress ||
          data.textReadingProgress.currentPageNumber === 3
      )
    )
    report.cases.push({
      format,
      hidden: [2],
      range: { start: 2, end: 3 },
      displayedSourcePage: 3,
      turns,
      passed: true
    })
    await page.close()
  }
} finally {
  await browser?.close()
  await server.close()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
console.log(JSON.stringify(report, null, 2))
