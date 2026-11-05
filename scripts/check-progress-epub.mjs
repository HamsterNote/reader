import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'
import JSZip from 'jszip'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham161-pagination-epub')
await mkdir(output, { recursive: true })
const source = await readFile(
  resolve(repo, 'test/compat/fixtures/epub/duplicate-text.epub')
)
const paragraphCount = (chapter) => (chapter === 1 ? 70 : 4)
async function fixture(fixed = false) {
  const zip = await JSZip.loadAsync(source)
  for (const file of Object.values(zip.files).filter((file) =>
    /chapter\d\.xhtml$/.test(file.name)
  )) {
    const chapter = Number(file.name.match(/chapter(\d)/)[1])
    const paragraphs = Array.from(
      { length: fixed ? 3 : paragraphCount(chapter) },
      (_, i) =>
        `<p id="p-${i}">第${chapter}章第${i}段。${'这是逐页阅读测试正文，翻页应继续同一章节，并保留稳定字符位置。'.repeat(6)}</p>`
    ).join('')
    zip.file(
      file.name,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>章节${chapter}</title>${fixed ? '<meta name="viewport" content="width=600,height=800"/>' : ''}<style>body{font-family:serif;line-height:1.5}p{margin:0 0 1em}</style></head><body><h1>章节${chapter}</h1>${chapter === 2 && !fixed ? '<img src="images/chapter.png" style="width:900px;height:1800px" alt="tall image"/>' : ''}${chapter === 2 && !fixed ? Array.from({ length: 3 }, () => '<div style="break-before:column;height:500px"><img src="images/chapter.png" style="width:100%;height:400px"/></div>').join('') + '<p>After image text</p>' : paragraphs}</body></html>`
    )
  }
  if (fixed) {
    const opf = Object.values(zip.files).find((file) =>
      file.name.endsWith('.opf')
    )
    zip.file(
      opf.name,
      (await opf.async('string')).replace(
        '</metadata>',
        '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">both</meta></metadata>'
      )
    )
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}
const books = {
  '/long.epub': await fixture(),
  '/fixed.epub': await fixture(true)
}
await writeFile(resolve(output, 'progress-fixture.epub'), books['/long.epub'])
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
}
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    const bytes =
      books[path] ??
      (await readFile(
        resolve(repo, 'webview-dist', `.${path === '/' ? '/index.html' : path}`)
      ))
    response
      .writeHead(200, {
        'Content-Type':
          types[extname(path === '/' ? 'index.html' : path)] ??
          'application/octet-stream'
      })
      .end(bytes)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const report = {
  cases: [],
  devices: 'Linux headless Chromium; no physical iOS/Android WebView'
}

async function boot(page, fixed) {
  await page.addInitScript(
    ({ base, fixed }) => {
      window.__hostWrites = []
      window.__READER_HOST__ = {
        sessionId: 'pagination',
        sourceToken: 'test-token'
      }
      const deliver = (type, payload) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              version: 1,
              sessionId: 'pagination',
              requestId: `host-${type}`,
              type,
              payload
            })
          })
        )
      let saved = JSON.parse(
        localStorage.getItem('pagination-snapshot') ?? 'null'
      ) ?? {
        data: {
          readerData: {
            layoutReadingProgress: { pageNumber: 2, verticalPercentage: 0 }
          }
        },
        revision: 0,
        progress: null
      }
      window.ReactNativeWebView = {
        postMessage(raw) {
          const message = JSON.parse(raw)
          if (message.type === 'ready')
            setTimeout(() => {
              deliver('open', {
                document: {
                  fileId: fixed ? 'fixed' : 'long',
                  format: 'epub',
                  fileUrl: `${base}/${fixed ? 'fixed' : 'long'}.epub`
                }
              })
              deliver('restore', saved)
            }, 0)
          if (message.type === 'change' || message.type === 'progress') {
            window.__hostWrites.push(message)
            saved = { ...saved, ...message.payload }
            localStorage.setItem('pagination-snapshot', JSON.stringify(saved))
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
    { base, fixed }
  )
  await page.goto(base)
  await page.getByRole('button', { name: '下一页', exact: true }).waitFor()
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="下一页"]').disabled
  )
}
const state = (page) =>
  page.evaluate(() => {
    const renderer = document.querySelector('foliate-view').renderer
    const range = renderer.getContents()[0]?.doc.createRange()
    const saved = JSON.parse(
      localStorage.getItem('pagination-snapshot') ?? 'null'
    )
    return {
      index: renderer.getContents()[0]?.index ?? renderer.index,
      page: renderer.page,
      pages: renderer.pages,
      progress: saved?.data?.readerData?.layoutReadingProgress,
      range: !!range
    }
  })
async function turn(page, name) {
  const button = page.getByRole('button', { name, exact: true })
  const writes = await page.evaluate(() => window.__hostWrites.length)
  await button.click()
  await page.waitForFunction(() => {
    const previous = document.querySelector('[aria-label="上一页"]')
    const next = document.querySelector('[aria-label="下一页"]')
    return !(previous.disabled && next.disabled)
  })
  await page.waitForFunction(
    (count) => window.__hostWrites.length > count,
    writes
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
  await page.waitForFunction((offset) => {
    const r = document.querySelector('foliate-view')?.renderer
    const doc = r?.getContents()[0]?.doc
    if (!doc) return false
    const frame = doc.defaultView.frameElement,
      box = frame.getBoundingClientRect()
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    let n,
      base = 0
    while ((n = walker.nextNode())) {
      if (base + n.length > offset) {
        const range = doc.createRange()
        range.setStart(n, offset - base)
        range.setEnd(n, offset - base + 1)
        const rect = range.getBoundingClientRect()
        return (
          rect.right + box.left > 0 &&
          rect.left + box.left < innerWidth &&
          rect.bottom + box.top > 0 &&
          rect.top + box.top < innerHeight
        )
      }
      base += n.length
    }
    return false
  }, offset)
}

let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [320, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 740 } })
    page.setDefaultTimeout(15000)
    await boot(page, false)
    await turn(page, '下一页')
    await turn(page, '下一页')
    const before = await state(page)
    assert(before.progress?.offset > 0)
    await page.reload()
    await page.getByRole('button', { name: '下一页', exact: true }).waitFor()
    await page.waitForFunction((expected) => {
      const r = document.querySelector('foliate-view')?.renderer
      return (
        r?.page === expected.page &&
        r?.getContents()[0]?.index === expected.index
      )
    }, before)
    const same = await state(page)
    assert.equal(same.page, before.page)
    await page.setViewportSize({
      width: width === 320 ? 740 : 440,
      height: 740
    })
    await assertAnchorVisible(page, before.progress.offset)
    await page.getByTestId('tool-bottom-bar-font-scale').click()
    await page.getByRole('menuitem', { name: '特大', exact: true }).click()
    await assertAnchorVisible(page, before.progress.offset)
    await page.setViewportSize({ width: 740, height: 380 })
    await assertAnchorVisible(page, before.progress.offset)
    const gate = await page
      .frames()
      .find((frame) => frame.url().startsWith('blob:'))
      .evaluate(() => {
        const event = new WheelEvent('wheel', { deltaY: 400, cancelable: true })
        document.dispatchEvent(event)
        return event.defaultPrevented
      })
    assert(gate)
    report.cases.push({
      width,
      kind: 'same-screen-reopen-and-reflow',
      before,
      same,
      wheelBlocked: gate
    })
    await page.close()
  }
  const mixed = await browser.newPage({ viewport: { width: 320, height: 740 } })
  await boot(mixed, false)
  await mixed.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('pagination-snapshot')) ?? {
      data: { readerData: {} }
    }
    saved.data.readerData.layoutReadingProgress = {
      pageNumber: 3,
      verticalPercentage: 0
    }
    localStorage.setItem('pagination-snapshot', JSON.stringify(saved))
  })
  await mixed.reload()
  await mixed.getByRole('button', { name: '下一页', exact: true }).waitFor()
  await turn(mixed, '下一页')
  const imageScreen = await state(mixed)
  assert.equal(imageScreen.progress.pageNumber, 3)
  assert(
    imageScreen.progress.verticalPercentage > 0,
    JSON.stringify(imageScreen)
  )
  assert(!('offset' in imageScreen.progress))
  await mixed.reload()
  await mixed.waitForFunction((expected) => {
    const r = document.querySelector('foliate-view')?.renderer
    return (
      r?.page === expected.page && r?.getContents()[0]?.index === expected.index
    )
  }, imageScreen)
  report.cases.push({
    kind: 'mixed-chapter-image-ratio-roundtrip',
    before: imageScreen,
    after: await state(mixed)
  })
  await mixed.setViewportSize({ width: 740, height: 380 })
  await mixed.evaluate(
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
  await mixed.waitForFunction((percentage) => {
    const r = document.querySelector('foliate-view')?.renderer,
      count = (r?.pages ?? 2) - 2
    return (
      count > 0 &&
      r.page ===
        Math.min(count - 1, Math.floor((percentage / 100) * count + 1e-7)) + 1
    )
  }, imageScreen.progress.verticalPercentage)
  report.cases.push({
    kind: 'image-ratio-projected-after-reflow',
    percentage: imageScreen.progress.verticalPercentage,
    after: await state(mixed)
  })
  await mixed.close()
  const fixed = await browser.newPage({ viewport: { width: 320, height: 740 } })
  await boot(fixed, true)
  const initial = await state(fixed)
  await turn(fixed, '下一页')
  const next = await state(fixed)
  assert.equal(next.index, initial.index + 1)
  await turn(fixed, '上一页')
  assert.equal((await state(fixed)).index, initial.index)
  report.cases.push({ kind: 'fixed-layout-button-pages', passed: true })
  await fixed.close()
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
