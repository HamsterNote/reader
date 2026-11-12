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
for (let p = 1; p <= 12; p++) {
  const sheet = pdf.addPage([612, 792])
  const label =
    p === 10 ? 'PDF restore target page ten' : `PDF progress page ${p}`
  for (let i = 0; i < 32; i++)
    sheet.drawText(i === 0 ? label : `${label} detail line ${i + 1}`, {
      x: 72,
      y: 740 - i * 20,
      size: 16,
      font
    })
}
const bytes = await pdf.save()
await writeFile(resolve(output, 'progress-fixture.pdf'), bytes)
const entry = `
import React, {useState, useRef} from 'react'
import { createRoot } from 'react-dom/client'
import { Reader } from '/src/components/Reader.tsx'
import { openReaderDocument } from '/src/host/openReaderDocument.ts'
import workerSrc from '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url'
import '/src/styles/index.scss'
const source = { format: 'pdf', workerSrc, data: new Uint8Array(await (await fetch('/publication.pdf')).arrayBuffer()) }
const opened = await openReaderDocument(source, 'legacy')
const params = new URLSearchParams(location.search)
const inset=Number(params.get('inset')), scale=Number(params.get('scale'))
window.saved={}
function App() {
 const [data,setData]=useState({virtualPaper:{x:0,y:0,scale}})
 const progressRef=useRef(null)
 window.flush=()=>progressRef.current.flush()
 return <Reader isPdf document={opened.document} useVirtualPaper data={data} progressRef={progressRef}
 onDataChange={v=>{window.saved=v;setData(v)}} containMarginTop={inset} />
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
await server.listen()
const browser = await chromium.launch({ headless: true })
const records = []
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 600 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  for (const inset of [0, 80])
    for (const scale of [0.5, 1, 1.5]) {
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/?inset=${inset}&scale=${scale}`
      )
      await page.waitForSelector('.hamster-reader__intermediate-page')
      await page.waitForFunction(
        (scale) =>
          Math.abs(
            document
              .querySelector('[data-testid="intermediate-page-2"]')
              .getBoundingClientRect().height -
              792 * scale
          ) < 1,
        scale
      )
      await page.waitForTimeout(500)
      const delta = await page.evaluate(
        ({ inset }) => {
          const page = document.querySelector(
            '[data-testid="intermediate-page-2"]'
          )
          const root = document.querySelector('.virtual-paper-wrapper')
          return (
            page.getBoundingClientRect().top +
            page.getBoundingClientRect().height * 0.65 -
            root.getBoundingClientRect().top -
            inset
          )
        },
        { inset }
      )
      const box = await page.locator('.virtual-paper-wrapper').boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + inset + 30)
      await page.mouse.wheel(0, delta)
      await page.waitForFunction(
        ({ inset }) => {
          const p = document
            .querySelector('[data-testid="intermediate-page-2"]')
            .getBoundingClientRect()
          return (
            Math.abs(
              p.top +
                p.height * 0.65 -
                document
                  .querySelector('.virtual-paper-wrapper')
                  .getBoundingClientRect().top -
                inset
            ) < 2
          )
        },
        { inset }
      )
      // End a real zoom gesture to commit the legacy transform snapshot.
      await page.keyboard.down('Control')
      await page.mouse.wheel(0, -1)
      await page.keyboard.up('Control')
      await page.waitForFunction(() => !!window.saved.virtualPaper?.anchor)
      await page.waitForFunction(
        () =>
          Math.abs(
            document
              .querySelector('[data-testid="intermediate-page-2"]')
              .getBoundingClientRect().height -
              792 * window.saved.virtualPaper.scale
          ) < 0.05
      )
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      await page.evaluate(() => window.flush())
      records.push(
        await page.evaluate(
          ({ inset, scale }) => {
            const p = document
              .querySelector('[data-testid="intermediate-page-2"]')
              .getBoundingClientRect()
            return {
              inset,
              scale,
              expected: {
                pageNumber: 2,
                verticalPercentage:
                  ((document
                    .querySelector('.virtual-paper-wrapper')
                    .getBoundingClientRect().top +
                    inset -
                    p.top) /
                    p.height) *
                  100
              },
              data: window.saved,
              error: Math.abs(
                p.top +
                  p.height * 0.65 -
                  document
                    .querySelector('.virtual-paper-wrapper')
                    .getBoundingClientRect().top -
                  inset
              )
            }
          },
          { inset, scale }
        )
      )
    }
  await writeFile(
    resolve(output, 'legacy-records.json'),
    JSON.stringify(records, null, 2)
  )
  console.log(JSON.stringify(records, null, 2))
} finally {
  await browser.close()
  await server.close()
}
