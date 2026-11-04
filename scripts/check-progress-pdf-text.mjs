import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham161-pagination-pdf')
await mkdir(output, { recursive: true })
// One source span spanning many CSS columns, then an empty and a short page.
const sourceText = Array.from({ length: 1100 }, (_, i) => `word${i}`).join(' ')
function pdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'
  ]
  for (const text of [sourceText, '', 'LAST SOURCE PAGE']) {
    const stream = `BT /F1 12 Tf 10 780 Td (${text}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100000 800] /Resources << /Font << /F1 9 0 R >> >> /Contents ${objects.length + 2} 0 R >>`
    )
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let result = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, i) => {
    offsets.push(result.length)
    result += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = result.length
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      ''
    )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(result)
}
const bytes = pdf()
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    const asset = path === '/' ? '/index.html' : path
    const data =
      path === '/long.pdf'
        ? bytes
        : await readFile(resolve(repo, 'webview-dist', `.${asset}`))
    response
      .writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.wasm': 'application/wasm'
          }[extname(path === '/' ? '/index.html' : path)] ??
          'application/octet-stream'
      })
      .end(data)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const report = {
  cases: [],
  devices: 'Linux headless Chromium; no physical iOS or Android WebView'
}
async function boot(page) {
  await page.addInitScript(
    ({ base, sourceText }) => {
      const sessionId = 'pdf-pagination'
      window.__READER_HOST__ = { sessionId, sourceToken: 'fixture' }
      window.__hostWrites = []
      let saved = JSON.parse(
        localStorage.getItem('pdf-snapshot') ?? 'null'
      ) ?? {
        data: {
          readerData: {
            renderMode: 'text',
            bookmarks: Array.from({ length: 50 }, (_, index) => ({
              pageNumber: 1,
              textId: 'page-1-item-0',
              offset: index * 100,
              text: `saved bookmark ${index}`
            }))
          },
          highlights: {
            version: 4,
            ranges: [
              {
                id: 'historic-cross-page',
                text: sourceText.slice(6) + 'LAST',
                start: { selectionId: 'page-1', offset: 6 },
                end: { selectionId: 'page-3', offset: 4 },
                createdAt: 1,
                overlayRectType: 'percent',
                rectsBySelectionId: {},
                markerStyle: { backgroundColor: 'rgba(255,193,7,0.35)' }
              }
            ],
            rects: [],
            paintings: {}
          }
        },
        revision: 0,
        progress: null
      }
      const deliver = (type, payload) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              version: 1,
              sessionId,
              requestId: `host-${type}`,
              type,
              payload
            })
          })
        )
      window.ReactNativeWebView = {
        postMessage(raw) {
          const message = JSON.parse(raw)
          if (message.type === 'ready')
            setTimeout(() => {
              deliver('open', {
                document: {
                  fileId: 'pdf-long',
                  format: 'pdf',
                  fileUrl: `${base}/long.pdf`
                }
              })
              deliver('restore', saved)
            }, 0)
          if (['change', 'progress'].includes(message.type)) {
            saved = { ...saved, ...message.payload }
            window.__hostWrites.push(message)
            localStorage.setItem('pdf-snapshot', JSON.stringify(saved))
            setTimeout(
              () =>
                deliver('ack', {
                  requestId: message.requestId,
                  revision: saved.revision
                }),
              0
            )
          }
        }
      }
    },
    { base, sourceText }
  )
  await page.goto(base)
  await ready(page)
}
async function ready(page) {
  await page.waitForFunction(() => {
    const next = document.querySelector('[aria-label="下一页"]')
    const previous = document.querySelector('[aria-label="上一页"]')
    return next && previous && !(next.disabled && previous.disabled)
  })
}
async function state(page) {
  return page.evaluate(() => {
    const content = document.querySelector(
      '.hamster-reader__pdf-text-viewport .hsn-selection-content'
    )
    const saved = JSON.parse(localStorage.getItem('pdf-snapshot') ?? 'null')
    return {
      page: Number(
        document.querySelector('.hamster-reader__intermediate-text-page')
          ?.dataset.pageNumber
      ),
      transform: content?.style.transform,
      progress: saved?.data?.readerData?.textReadingProgress,
      source: Array.from(content?.querySelectorAll('[data-text-id]') ?? [])
        .map((span) => span.textContent)
        .join(''),
      scroll: document.querySelector('.hamster-reader__pdf-text-viewport')
        ?.scrollTop
    }
  })
}
async function turn(page, name, clicks = 1) {
  const writes = await page.evaluate(() => window.__hostWrites.length)
  const button = page.getByRole('button', { name, exact: true })
  if (clicks === 1) await button.click()
  else
    await button.evaluate((element, clicks) => {
      for (let i = 0; i < clicks; i++) element.click()
    }, clicks)
  await ready(page)
  await page.waitForFunction(
    (count) => window.__hostWrites.length > count,
    writes
  )
  await page.waitForFunction(
    () =>
      document.querySelector('.hsn-selection-content')?.style.transform ||
      document.querySelector('.hamster-reader__pdf-text-empty')
  )
}

async function assertAnchorVisible(page, offset) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const tick = () => {
          if (++frames === 10) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
  )
  const geometry = await page.evaluate((offset) => {
    const viewport = document
      .querySelector('.hsn-selection-container')
      .getBoundingClientRect()
    const span = document.querySelector('.hsn-selection-content [data-text-id]')
    const range = document.createRange()
    range.setStart(span.firstChild, offset)
    range.setEnd(span.firstChild, offset + 1)
    const rect = range.getBoundingClientRect()
    return {
      viewport: viewport.toJSON(),
      rect: rect.toJSON(),
      visible:
        rect.left >= viewport.left - 1 &&
        rect.right <= viewport.right + 1 &&
        rect.top >= viewport.top - 1 &&
        rect.bottom <= viewport.bottom + 1
    }
  }, offset)
  assert(geometry.visible, JSON.stringify(geometry))
}

let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [320, 960]) {
    const page = await browser.newPage({ viewport: { width, height: 740 } })
    page.setDefaultTimeout(15000)
    await boot(page)
    await turn(page, '下一页')
    await turn(page, '下一页')
    const before = await state(page)
    assert(before.progress.anchor.offset > 0)
    await page.reload()
    await ready(page)
    await assertAnchorVisible(page, before.progress.anchor.offset)
    const same = await state(page)
    assert.equal(same.transform, before.transform)
    await page.setViewportSize({
      width: width === 320 ? 740 : 440,
      height: 740
    })
    await ready(page)
    await assertAnchorVisible(page, before.progress.anchor.offset)
    for (const label of ['中', '特大', '大']) {
      await page.getByTestId('tool-bottom-bar-font-scale').click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
          )
      )
      await assertAnchorVisible(page, before.progress.anchor.offset)
    }
    await page.setViewportSize({ width: 740, height: 380 })
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
        )
    )
    await assertAnchorVisible(page, before.progress.anchor.offset)
    const transform = (await state(page)).transform
    await page
      .locator('.hamster-reader__pdf-text-viewport')
      .dispatchEvent('wheel', { deltaY: 600 })
    await page.keyboard.press('PageDown')
    assert.equal((await state(page)).transform, transform)
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('pdf-snapshot'))
      saved.data.readerData.textReadingProgress = {
        currentPageNumber: 2,
        verticalPercentage: 0
      }
      localStorage.setItem('pdf-snapshot', JSON.stringify(saved))
    })
    await page.reload()
    await ready(page)
    await page.locator('.hamster-reader__pdf-text-empty').waitFor()
    assert.equal((await state(page)).page, 2)
    await turn(page, '下一页')
    assert.equal((await state(page)).page, 3)
    report.cases.push({
      width,
      kind: 'text-reopen-reflow-empty-buttons',
      offset: before.progress.anchor.offset,
      transform: before.transform,
      passed: true
    })
    await page.close()
  }
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
console.log(JSON.stringify(report, null, 2))
