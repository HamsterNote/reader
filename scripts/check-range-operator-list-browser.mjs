import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({
  root: resolve(import.meta.dirname, '..'),
  configFile: false,
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { include: ['pdfjs-dist', 'pdf-lib'], noDiscovery: true },
  logLevel: 'error'
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/range-probe.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>PDF range probe</title>'
    })
  )
  await page.goto(
    new URL('range-probe.html', server.resolvedUrls.local[0]).href
  )
  for (const concurrent of [false, true]) {
    const closed = page
      .waitForEvent('worker', {
        predicate: (worker) => worker.url().endsWith('/pdf.worker.min.mjs'),
        timeout: 10000
      })
      .then((worker) => worker.waitForEvent('close', { timeout: 10000 }))
    const run = page.evaluate(async (concurrent) => {
      const { readBrokenOperatorList } =
        await import('/test/pdf-viewer/range-failure.ts')
      const { configurePdfJsWorker } = await import('/src/pdf/pdfjsRuntime.ts')
      configurePdfJsWorker('/node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
      let timer
      try {
        return await Promise.race([
          readBrokenOperatorList(concurrent),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('operator list or dispose still pending')),
              10000
            )
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    }, concurrent)
    const [result] = await Promise.all([run, closed])
    assert.deepEqual(result, {
      originalErrors: concurrent ? 4 : 2,
      aborts: 1,
      disposed: true
    })
    assert.deepEqual(errors, [])
    console.log(
      JSON.stringify({
        chromium: browser.version(),
        mode: concurrent ? 'concurrent' : 'standalone',
        workerClosed: true,
        ...result
      })
    )
  }
} finally {
  await browser?.close()
  await server.close()
}
