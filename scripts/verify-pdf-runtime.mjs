import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const temporary = await mkdtemp(join(tmpdir(), 'reader-pdf-consumer-'))
let server
let browser
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}
try {
  const [pack] = JSON.parse(
    run('npm', [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporary
    ])
  )
  run('tar', ['-xzf', join(temporary, pack.filename), '-C', temporary])
  const dist = join(temporary, 'package/dist')
  run(process.execPath, [
    join(dist, 'sync-pdf-runtime.mjs'),
    '--target',
    join(temporary, 'public')
  ])
  const root = join(temporary, 'public/pdf-runtime')
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8')
  )
  assert.equal(manifest.pdfjsVersion, '5.4.530')
  for (const file of manifest.files) {
    const bytes = await readFile(join(root, file.path))
    assert.equal(bytes.length, file.size)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
  }
  server = createServer(async (request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><html><body style="margin:0"><main style="height:650px;overflow:auto;position:relative"></main></body></html>'
      )
      return
    }
    const file = manifest.files.find(
      (entry) => request.url === `/pdf-runtime/${entry.path}`
    )
    if (!file) {
      response.writeHead(404).end()
      return
    }
    response.setHeader('Content-Type', file.mimeType)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.end(await readFile(join(root, file.path)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let number = 1; number <= 2; number += 1)
    pdf.addPage([400, 520]).drawText(`Packed offline PDF page ${number}`, {
      x: 30,
      y: 450,
      size: 16,
      font
    })
  const bytes = Array.from(await pdf.save())
  browser = await chromium.launch()
  const page = await browser.newPage()
  const external = []
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue()
    external.push(route.request().url())
    return route.abort()
  })
  await page.goto(origin)
  const evidence = await page.evaluate(
    async ({ bytes, origin }) => {
      const { createPdfDomSession } = await import(
        `${origin}/pdf-runtime/adapter.js`
      )
      const style = document.createElement('link')
      style.rel = 'stylesheet'
      style.href = '/pdf-runtime/pdf.css'
      document.head.append(style)
      await new Promise((resolve, reject) => {
        style.onload = resolve
        style.onerror = reject
      })
      const viewport = document.querySelector('main')
      const input = new Uint8Array(bytes)
      const states = []
      let ready, reject
      const displayed = new Promise((resolve, failure) => {
        ready = resolve
        reject = failure
      })
      const session = createPdfDomSession({
        viewport,
        coordinateRoot: viewport,
        bytes: input,
        identity: { sessionId: 'packed-consumer', generation: 1 },
        assetBaseUrl: `${origin}/pdf-runtime/`,
        events: {
          onStateChange(state) {
            states.push(state.status)
            if (state.status === 'ready') ready()
            if (state.status === 'error') reject(new Error(state.error.code))
          },
          onMetadata() {},
          onPageChange() {},
          onSelectionChange() {}
        }
      })
      try {
        await displayed
        const text = viewport.textContent
        const canvas = viewport.querySelector('canvas')
        const data = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data
        const colors = new Set()
        for (let index = 0; index < data.length; index += 4)
          colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`)
        const thumbnail = await session.getThumbnail(2)
        return {
          states,
          text,
          colors: colors.size,
          thumbnail: thumbnail?.pageNumber,
          boundary: [await session.goToPage(0), await session.goToPage(3)],
          hostBytesIntact:
            input.length === bytes.length &&
            input.every((value, index) => value === bytes[index])
        }
      } finally {
        session.dispose()
        session.dispose()
      }
    },
    { bytes, origin }
  )
  assert.deepEqual(evidence.states, ['loading', 'ready'])
  assert.match(evidence.text, /Packed offline PDF page 1/)
  assert(evidence.colors > 10)
  assert.equal(evidence.thumbnail, 2)
  assert.deepEqual(evidence.boundary, [false, false])
  assert(evidence.hostBytesIntact)
  assert.deepEqual(external, [])
  console.log(
    `Packed offline consumer passed: ${manifest.files.length} integrity-checked assets, canvas/text/thumbnail, bounds and idempotent cleanup`
  )
} finally {
  await browser?.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  await rm(temporary, { recursive: true, force: true })
}
