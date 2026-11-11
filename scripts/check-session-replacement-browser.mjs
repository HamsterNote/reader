import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, extname } from 'node:path'
import { chromium } from 'playwright'
const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../artifacts/reader-session-browser')
await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url, 'http://localhost').pathname
    const fixture = {
      '/webview-dist/publication.pdf': '/test/browser/eight-pages.pdf',
      '/webview-dist/publication.epub':
        '/test/compat/fixtures/epub/duplicate-text.epub'
    }[requestPath]
    const path = resolve(repo, '.' + (fixture ?? requestPath))
    assert(path.startsWith(repo + '/'))
    const bytes = await readFile(path)
    const type =
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.wasm': 'application/wasm',
        '.pdf': 'application/pdf',
        '.epub': 'application/epub+zip',
        '.json': 'application/json'
      }[extname(path)] ?? 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': type })
    response.end(bytes)
  } catch {
    response.writeHead(404).end()
  }
})
const report = { cases: [], errors: [] }
let browser, page
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 800, height: 900 } })
  page.on('pageerror', (error) => {
    report.errors.push(error.message)
    console.error(error.stack)
  })
  await page.addInitScript(() => {
    const token = 'replacement-contract'
    let id = 'session-a',
      format = 'pdf',
      replacing = null,
      counter = 0
    const writes = [],
      ready = [],
      saved = new Map()
    const initial = {
      data: {
        readerData: {
          layoutReadingProgress: { pageNumber: 8, verticalPercentage: 45 }
        }
      },
      progress: null,
      revision: 0
    }
    saved.set('pdf', initial)
    saved.set('epub', {
      data: {
        readerData: {
          layoutReadingProgress: { pageNumber: 2, verticalPercentage: 0 }
        }
      },
      progress: null,
      revision: 0
    })
    const deliver = (type, payload, sessionId = id) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            version: 1,
            type,
            payload,
            sessionId,
            requestId: `host-${++counter}`
          })
        })
      )
    window.__READER_HOST__ = { sessionId: id, sourceToken: token }
    window.ReactNativeWebView = {
      postMessage(raw) {
        const message = JSON.parse(raw)
        if (message.sourceToken !== token || message.sessionId !== id) return
        if (message.type === 'document-ready') ready.push(message.sessionId)
        if (message.type === 'ready') {
          if (replacing) {
            const previousSessionId = id
            deliver('dispose', {})
            id = `session-${++counter}`
            format = replacing
            replacing = null
            window.dispatchEvent(
              new MessageEvent('message', {
                data: JSON.stringify({
                  type: 'reader:replace-session',
                  version: 1,
                  sourceToken: token,
                  previousSessionId,
                  sessionId: id,
                  requestId: `replace-${counter}`
                })
              })
            )
            return
          }
          setTimeout(() => {
            deliver('open', {
              document: {
                fileId: `file-${format}`,
                format,
                fileUrl:
                  location.origin +
                  (format === 'pdf'
                    ? '/webview-dist/publication.pdf'
                    : '/webview-dist/publication.epub')
              }
            })
            deliver(
              'restore',
              saved.get(format) ?? { data: null, progress: null, revision: 0 }
            )
          }, 0)
        }
        if (['change', 'progress'].includes(message.type)) {
          writes.push(message)
          saved.set(format, {
            ...(saved.get(format) ?? {}),
            ...message.payload
          })
          setTimeout(
            () =>
              deliver('ack', {
                requestId: message.requestId,
                revision: message.payload.revision
              }),
            0
          )
        }
      }
    }
    window.replacementTest = {
      writes,
      ready,
      saved,
      select: (next) => {
        replacing = next
        deliver('command', { name: 'flush' })
      },
      stale: () =>
        deliver(
          'restore',
          {
            data: {
              layoutReadingProgress: { pageNumber: 1, verticalPercentage: 0 }
            },
            progress: null,
            revision: 0
          },
          'session-a'
        ),
      id: () => id
    }
  })
  await page.goto(
    `http://127.0.0.1:${server.address().port}/webview-dist/index.html`
  )
  await page
    .locator('[data-engine="pdf"] .page[data-page-number="8"]')
    .waitFor()
  await page.waitForFunction(() =>
    document.querySelector(
      '[data-engine="pdf"] .page[data-page-number="8"] canvas'
    )
  )
  await page.evaluate(() => {
    window.__sameRoot = document.getElementById('reader')
    window.__mountId = crypto.randomUUID()
  })
  const original = await page.evaluate(() => ({
    mountId: window.__mountId,
    navigation: performance.getEntriesByType('navigation').length
  }))
  await page.evaluate(() => window.replacementTest.select('epub'))
  await page.locator('[data-engine="epub"]').waitFor({ timeout: 45000 })
  await page.waitForFunction(() =>
    (
      document.querySelector('foliate-view')?.renderer?.getContents() ?? []
    ).some((item) => item.doc.body.textContent.includes('第一章'))
  )
  await page.evaluate(() => window.replacementTest.select('pdf'))
  await page
    .locator('[data-engine="pdf"] .page[data-page-number="8"]')
    .waitFor({ timeout: 45000 })
  await page.waitForFunction(() => window.replacementTest.ready.length === 2)
  await page.evaluate(() => window.replacementTest.stale())
  const result = await page.evaluate(() => ({
    sameRoot: window.__sameRoot === document.getElementById('reader'),
    mountId: window.__mountId,
    navigation: performance.getEntriesByType('navigation').length,
    saved: window.replacementTest.saved.get('pdf'),
    readySessions: window.replacementTest.ready,
    sessionId: window.replacementTest.id(),
    staleWrites: window.replacementTest.writes.filter(
      (message) =>
        message.sessionId === 'session-a' &&
        message.payload.data?.layoutReadingProgress?.pageNumber === 1
    )
  }))
  assert.equal(result.sameRoot, true)
  assert.equal(result.mountId, original.mountId)
  assert.equal(result.navigation, original.navigation)
  assert.equal(result.saved.data.readerData.layoutReadingProgress.pageNumber, 8)
  assert.notEqual(result.sessionId, 'session-a')
  assert.deepEqual(result.staleWrites, [])
  assert.deepEqual(report.errors, [])
  await page.screenshot({
    path: resolve(output, 'webview-pdf-epub-roundtrip.png')
  })
  report.cases.push({
    name: 'packaged WebView keeps root and navigation count across new isolated PDF/EPUB sessions',
    ...result
  })
} catch (error) {
  report.failure = {
    message: String(error),
    text: await page?.evaluate(() => document.body.innerText).catch(() => '')
  }
  await page?.screenshot({ path: resolve(output, 'failure.png') })
  throw error
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
console.log(JSON.stringify(report, null, 2))
