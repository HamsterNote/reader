import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium, webkit } from 'playwright'
import JSZip from 'jszip'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(
  process.env.READER_BROWSER_OUTPUT ?? resolve(repo, '../ham91-browser')
)
await mkdir(output, { recursive: true })
const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname
    )
    const fixture = {
      '/publication.epub': 'epub/duplicate-text.epub',
      '/publication.pdf': 'pdf/two-column.pdf'
    }[path]
    const assetPath = path === '/' ? '/index.html' : path
    const file = fixture
      ? resolve(repo, 'test/compat/fixtures', fixture)
      : resolve(repo, 'webview-dist', `.${assetPath}`)
    assert(file.startsWith(`${repo}/`))
    const bytes = await readFile(file)
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream'
    })
    response.end(bytes)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const base = `http://127.0.0.1:${server.address().port}`
const report = { command: 'yarn check:browser', cases: [] }
const malicious = await JSZip.loadAsync(
  await readFile(resolve(repo, 'test/compat/fixtures/epub/duplicate-text.epub'))
)
for (const file of Object.values(malicious.files).filter(
  (file) => file.name.endsWith('.xhtml') && !file.name.includes('cover')
)) {
  const source = await file.async('string')
  const payload = `<script>top.__publicationExploit=true;top.ReactNativeWebView.postMessage(JSON.stringify({version:1,sessionId:'browser-session',requestId:'forged',type:'change',payload:{data:{highlights:{version:4,ranges:[],rects:[],paintings:{}}},revision:1}}))</script><img src="broken" onerror="top.__publicationExploit=true"/><iframe srcdoc="&lt;script&gt;top.__publicationExploit=true&lt;/script&gt;"></iframe><svg xmlns="http://www.w3.org/2000/svg" onload="top.__publicationExploit=true"><set attributeName="onload" to="top.__publicationExploit=true"/></svg>`
  malicious.file(file.name, source.replace(/(<body[^>]*>)/i, `$1${payload}`))
}
const maliciousBytes = await malicious.generateAsync({ type: 'nodebuffer' })

// eslint-disable-next-line sonarjs/cognitive-complexity -- Keep this acceptance scenario sequential.
async function run(browserType, mobile, format, version, attack = false) {
  const label = `${browserType.name()}-${mobile ? 'mobile' : 'desktop'}-${format}-v${version}${attack ? '-security' : ''}`
  if (
    process.env.READER_BROWSER_CASE &&
    !label.includes(process.env.READER_BROWSER_CASE)
  )
    return
  let browser
  try {
    browser = await browserType.launch({ headless: true })
  } catch (error) {
    report.cases.push({
      label,
      passed: false,
      unavailable: true,
      failure: error.message
    })
    console.error(`${label}: browser unavailable`)
    return
  }
  const page = await browser.newPage({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 },
    hasTouch: mobile
  })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const highlights = JSON.parse(
    await readFile(
      resolve(
        repo,
        `test/compat/fixtures/highlights/${format === 'epub' ? 'epub-duplicate-text' : 'pdf-two-column'}.v${version}.json`
      ),
      'utf8'
    )
  )
  const initial = {
    highlights,
    comments: {
      version: 2,
      comments: [
        {
          id: 'retained-comment',
          highlightIds: [highlights.ranges[0].id],
          content: 'Keep',
          createdAt: 1735689800000,
          parentId: null
        }
      ]
    },
    readerData: {
      layoutReadingProgress: {
        pageNumber: format === 'epub' ? 2 : 1,
        verticalPercentage: 0
      },
      bookmarks: [{ pageNumber: 1, verticalPercentage: 25 }]
    }
  }
  const result = { label, passed: false, errors }
  report.cases.push(result)
  try {
    console.log(`${label}: opening`)
    if (attack)
      await page.route('**/publication.epub', (route) =>
        route.fulfill({
          body: maliciousBytes,
          contentType: 'application/epub+zip'
        })
      )
    await page.addInitScript(
      ({ format, initial }) => {
        const sessionId = 'browser-session'
        const sourceToken = 'browser-secret'
        let saved = JSON.parse(
          localStorage.getItem('host-snapshot') ?? 'null'
        ) ?? { data: initial, progress: null, revision: 0 }
        window.__READER_HOST__ = { sessionId, sourceToken }
        window.__hostWrites = []
        window.__publicationExploit = false
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
                    fileId: `book-${format}`,
                    format,
                    fileUrl: `${location.origin}/publication.${format}`
                  }
                })
                deliver('restore', saved)
              }, 0)
            if (message.type === 'change' || message.type === 'progress') {
              window.__hostWrites.push(message)
              saved = { ...saved, ...message.payload }
              localStorage.setItem('host-snapshot', JSON.stringify(saved))
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
      { format, initial }
    )
    await page.goto(base)
    await page.locator(`[data-engine=${format}]`).waitFor()
    console.log(`${label}: engine mounted`)
    let frame = page
    if (format === 'epub') {
      await page.waitForFunction(() =>
        (
          document.querySelector('foliate-view')?.renderer?.getContents() ?? []
        ).some((entry) => entry.doc.body.textContent.includes('第一章'))
      )
      frame = page
        .frames()
        .find((candidate) => candidate.url().startsWith('blob:'))
      assert(frame)
      assert(
        (await frame.locator('body').innerText()).includes('重复的段落文本。')
      )
    } else {
      await page
        .locator('.textLayer [data-selection-start-offset]')
        .first()
        .waitFor()
      assert(
        (await page.locator('.pdfViewer').innerText()).includes(
          'Left column line one'
        )
      )
      const nonblank = await page
        .locator('.pdfViewer canvas')
        .first()
        .evaluate((canvas) => {
          const pixels = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data
          let ink = 0
          for (let i = 0; i < pixels.length; i += 4)
            if (
              pixels[i + 3] &&
              pixels[i] < 180 &&
              pixels[i + 1] < 180 &&
              pixels[i + 2] < 180
            )
              ink++
          return ink > 50
        })
      assert(nonblank, 'PDF canvas must contain actual glyphs')
    }
    // Restore must never turn into an edit, including asynchronous engine relocates.
    await page.waitForTimeout(250)
    assert.equal(
      await page.evaluate(() => window.__publicationExploit),
      false,
      'publication executed in host context'
    )
    result.initialWrites = await page.evaluate(() => window.__hostWrites)
    assert.equal(
      await page.evaluate(() => window.__hostWrites.length),
      0,
      'initialization wrote over the snapshot'
    )
    const original = await page.evaluate(() =>
      localStorage.getItem('host-snapshot')
    )
    assert.equal(original, null)
    // Use a real browser Range in the real Foliate/PDF.js text layer.
    await frame.evaluate((format) => {
      const target =
        format === 'epub'
          ? [...document.querySelectorAll('p')].find((p) =>
              p.textContent.includes('第一章独有结尾。')
            )
          : document.querySelector('.textLayer [data-selection-start-offset]')
      const node = target.firstChild
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, Math.min(5, node.textContent.length))
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    }, format)
    const confirm = page.getByRole('button', { name: '高亮', exact: true })
    if (mobile) await confirm.tap()
    else await confirm.click()
    await page.waitForFunction(
      (count) =>
        window.__hostWrites.some(
          (message) => message.payload.data?.highlights?.ranges.length === count
        ),
      highlights.ranges.length + 1
    )
    assert.equal(
      await page.getByTestId('comment-panel').count(),
      0,
      'highlight tap also opened comments'
    )
    let saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('host-snapshot'))
    )
    for (const oldRange of highlights.ranges)
      assert.deepEqual(
        saved.data.highlights.ranges.find((range) => range.id === oldRange.id),
        oldRange
      )
    assert.deepEqual(saved.data.highlights.rects, highlights.rects ?? [])
    assert.deepEqual(
      saved.data.highlights.paintings,
      highlights.paintings ?? {}
    )
    assert.deepEqual(saved.data.comments, initial.comments)
    assert.deepEqual(
      saved.data.readerData.bookmarks,
      initial.readerData.bookmarks
    )
    const added = saved.data.highlights.ranges.at(-1)
    assert.match(added.start.selectionId, /^page-[1-9]\d*$/)
    assert.match(added.end.selectionId, /^page-[1-9]\d*$/)
    assert(added.createdAt > 0 && added.id && added.text)
    if (!mobile && version === 4 && !attack) {
      // Native pointer events, not dispatched DOM events, exercise editable endpoints.
      const textBox = await frame
        .locator(format === 'epub' ? 'p' : '.textLayer span')
        .first()
        .boundingBox()
      await page.mouse.move(textBox.x + 2, textBox.y + 2)
      await page.mouse.down()
      await page.mouse.up()
      // Reactivating through the public Page Browser also exercises stored-range navigation.
      await page.getByRole('button', { name: '页面与标注' }).click()
      await page.getByRole('tab', { name: '高亮', exact: true }).click()
      await page.getByTestId(`page-browser-highlight-${added.id}`).click()
      await page.getByRole('button', { name: '关闭页面浏览' }).click()
      const handle = page.getByRole('button', { name: '调整高亮终点' })
      await handle.waitFor()
      const goal = await frame.evaluate(() => {
        const selection = getSelection()
        const selected = selection.getRangeAt(0)
        const node = selected.endContainer
        const offset = Math.min(selected.endOffset + 1, node.textContent.length)
        const range = document.createRange()
        range.setStart(node, offset)
        range.collapse(true)
        const box = range.getBoundingClientRect()
        const frame = window.frameElement?.getBoundingClientRect()
        return {
          x: box.x + (frame?.x ?? 0),
          y: box.y + box.height / 2 + (frame?.y ?? 0)
        }
      })
      const handleBox = await handle.boundingBox()
      await page.mouse.move(handleBox.x + 7, handleBox.y + 7)
      await page.mouse.down()
      await page.mouse.move(goal.x, goal.y, { steps: 5 })
      await page.mouse.up()
      await page.waitForFunction(
        ({ id, offset }) =>
          JSON.parse(
            localStorage.getItem('host-snapshot')
          ).data.highlights.ranges.find((range) => range.id === id).end.offset >
          offset,
        { id: added.id, offset: added.end.offset }
      )
      const edited = await page.evaluate(
        (id) =>
          JSON.parse(
            localStorage.getItem('host-snapshot')
          ).data.highlights.ranges.find((range) => range.id === id),
        added.id
      )
      assert.equal(edited.createdAt, added.createdAt)
      assert.deepEqual(edited.start, added.start)
      result.endpointPointerEdit = true
      if (format === 'pdf') {
        await page.getByTestId('tool-bottom-bar-rect-selection').click()
        const pageBox = await page
          .locator('.pdfViewer .page')
          .first()
          .boundingBox()
        await page.mouse.move(pageBox.x + 200, pageBox.y + 120)
        await page.mouse.down()
        await page.mouse.move(pageBox.x + 280, pageBox.y + 180, { steps: 6 })
        await page.mouse.up()
        await page.getByRole('button', { name: '高亮', exact: true }).click()
        await page.waitForFunction(
          (count) =>
            JSON.parse(localStorage.getItem('host-snapshot')).data.highlights
              .rects.length === count,
          highlights.rects.length + 1
        )
        const before = await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem('host-snapshot')
          ).data.highlights.rects.at(-1)
        )
        const corner = page.getByRole('button', { name: '调整矩形下右角' })
        const box = await corner.boundingBox()
        await page.mouse.move(box.x + 7, box.y + 7)
        await page.mouse.down()
        await page.mouse.move(box.x + 37, box.y + 22, { steps: 6 })
        await page.mouse.up()
        await page.waitForFunction(
          (original) =>
            JSON.parse(
              localStorage.getItem('host-snapshot')
            ).data.highlights.rects.at(-1).rect.width !== original.rect.width,
          before
        )
        await page.getByTestId('tool-bottom-bar-undo').click()
        await page.waitForFunction(
          (original) =>
            JSON.stringify(
              JSON.parse(
                localStorage.getItem('host-snapshot')
              ).data.highlights.rects.at(-1)
            ) === JSON.stringify(original),
          before
        )
        await page.getByTestId('tool-bottom-bar-redo').click()
        await page.waitForFunction(
          (original) =>
            JSON.parse(
              localStorage.getItem('host-snapshot')
            ).data.highlights.rects.at(-1).rect.width !== original.rect.width,
          before
        )
        result.rectanglePointerEditAndHistory = true
      }
      saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('host-snapshot'))
      )
    }
    await page.locator('body').evaluate(async (body) => {
      await Promise.allSettled(
        body
          .getAnimations({ subtree: true })
          .filter((animation) =>
            Number.isFinite(animation.effect?.getTiming().iterations ?? 1)
          )
          .map((animation) => animation.finished)
      )
    })
    await page.screenshot({ path: resolve(output, `${label}.png`) })
    await page.reload()
    await page.locator(`[data-engine=${format}]`).waitFor()
    if (format === 'pdf')
      await page
        .locator('.textLayer [data-selection-start-offset]')
        .first()
        .waitFor()
    else
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view')?.renderer?.getContents()
            .length > 0
      )
    assert.deepEqual(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('host-snapshot')).data.highlights
      ),
      saved.data.highlights
    )
    assert.equal(errors.length, 0, errors.join('\n'))
    result.passed = true
    result.savedRange = added
  } catch (error) {
    result.failure = error.stack
    result.dom = await page.locator('body').innerHTML()
    await page
      .screenshot({ path: resolve(output, `${label}-failed.png`) })
      .catch(() => {})
    console.error(`${label}: ${error.message}`)
  } finally {
    await browser.close()
  }
}

try {
  for (const browserType of [chromium, webkit]) {
    for (const mobile of [false, true]) {
      for (const format of ['epub', 'pdf']) {
        for (const version of [2, 3, 4])
          await run(browserType, mobile, format, version)
      }
    }
    await run(browserType, false, 'epub', 4, true)
  }
} finally {
  await new Promise((done) => server.close(done))
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
const passed = report.cases.filter((result) => result.passed).length
console.log(
  `Browser integration: ${passed}/${report.cases.length} passed; artifacts: ${output}`
)
if (passed !== report.cases.length) process.exitCode = 1
