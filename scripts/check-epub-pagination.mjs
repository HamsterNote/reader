import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium, webkit } from 'playwright'
import JSZip from 'jszip'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham129-browser')
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
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>章节${chapter}</title>${fixed ? '<meta name="viewport" content="width=600,height=800"/>' : ''}<style>body{font-family:serif;line-height:1.5}p{margin:0 0 1em}</style></head><body><h1>章节${chapter}</h1>${chapter === 2 && !fixed ? '<img src="images/chapter.png" style="width:900px;height:1800px" alt="tall image"/>' : ''}${paragraphs}</body></html>`
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
  devices:
    'Linux headless Chromium/WebKit; touch emulation only, no physical iOS/Android WebView'
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
async function clearance(page) {
  const result = await page.evaluate(() => {
    const box = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect()
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        height: r.height
      }
    }
    return {
      paper: box('.hamster-reader__epub-container'),
      controls: box('.hamster-reader__epub-pagination'),
      toolbar: box('[data-testid="tool-bottom-bar"]')
    }
  })
  assert(
    result.paper.bottom <= Math.min(result.controls.top, result.toolbar.top),
    JSON.stringify(result)
  )
  assert(
    result.controls.left >= result.toolbar.right ||
      result.controls.top >= result.toolbar.bottom,
    JSON.stringify(result)
  )
  return result
}
// eslint-disable-next-line sonarjs/cognitive-complexity -- Sequential browser acceptance scenario.
async function run(browserType, mobile, fixed = false) {
  const label = `${browserType.name()}-${mobile ? 'touch-320' : 'desktop'}-${fixed ? 'fixed' : 'reflow'}`
  if (
    process.env.READER_BROWSER_CASE &&
    !label.includes(process.env.READER_BROWSER_CASE)
  )
    return
  const result = { label, passed: false }
  report.cases.push(result)
  let browser
  try {
    browser = await browserType.launch({ headless: true })
  } catch (error) {
    result.unavailable = true
    result.failure = error.message
    console.error(`${label}: browser unavailable`)
    return
  }
  const page = await browser.newPage({
    viewport: mobile
      ? { width: 320, height: 740 }
      : { width: 1280, height: 800 },
    hasTouch: mobile
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await boot(page, fixed)
    assert.equal(
      await page.evaluate(() => window.__hostWrites.length),
      0,
      'restore must not save intermediate progress'
    )
    result.clearance = await clearance(page)
    await page.screenshot({ path: resolve(output, `${label}-initial.png`) })
    if (fixed) {
      assert.equal(
        await page.evaluate(
          () => document.querySelector('foliate-view').renderer.spread
        ),
        'none'
      )
      const first = await state(page)
      await turn(page, '下一页')
      const second = await state(page)
      assert.equal(second.index, first.index + 1)
      await turn(page, '上一页')
      assert.equal((await state(page)).index, first.index)
    } else {
      const first = await state(page)
      assert(first.pages > 5, JSON.stringify(first))
      const turns = []
      for (let i = 0; i < 3; i++) {
        await turn(page, '下一页')
        turns.push(await state(page))
      }
      assert(
        turns.every((item) => item.index === first.index),
        JSON.stringify(turns)
      )
      assert.equal(turns[2].page, first.page + 3)
      assert(
        turns[2].progress.offset > turns[1].progress.offset &&
          turns[1].progress.offset > turns[0].progress.offset
      )
      await turn(page, '上一页')
      assert.equal((await state(page)).page, turns[1].page)
      await turn(page, '下一页')
      const anchor = (await state(page)).progress
      assert.equal(anchor.pageNumber, 2)
      result.anchor = anchor
      await page.reload()
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="下一页"]')?.disabled === false
      )
      assert.equal(
        (await state(page)).page,
        turns[2].page,
        'reopen must retain same chapter visual page'
      )
      assert.equal(
        await page.evaluate(() => window.__hostWrites.length),
        0,
        'reload must not overwrite old progress'
      )
      const before = await state(page)
      const frame = page
        .frames()
        .find((frame) => frame.url().startsWith('blob:'))
      const blocked = await frame.evaluate(() => {
        const results = []
        for (const event of [
          new WheelEvent('wheel', { deltaY: 300, cancelable: true }),
          new Event('touchmove', { cancelable: true }),
          ...['ArrowDown', ' ', 'PageDown', 'End'].map(
            (key) => new KeyboardEvent('keydown', { key, cancelable: true })
          )
        ]) {
          document.dispatchEvent(event)
          results.push(event.defaultPrevented)
        }
        return results
      })
      assert(blocked.every(Boolean))
      const box = await page
        .locator('.hamster-reader__epub-container')
        .boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 600)
      await page.keyboard.press('PageDown')
      // Exercise native touch dispatch in Chromium in addition to DOM input gates.
      if (mobile && browserType === chromium) {
        const cdp = await page.context().newCDPSession(page)
        for (const [type, y] of [
          ['touchStart', 250],
          ['touchMove', 80],
          ['touchEnd', 80]
        ])
          await cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{ x: 120, y }]
          })
      }
      await page.waitForTimeout(800) // exceeds Foliate's delayed selection/gesture handlers
      assert.equal((await state(page)).page, before.page)
      assert.equal((await state(page)).index, before.index)
      await frame.evaluate(() => {
        document.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true })
        )
        const range = document.createRange()
        range.selectNodeContents(document.body)
        const selection = getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      })
      await page.waitForTimeout(800)
      assert.equal(
        (await state(page)).page,
        before.page,
        'edge selection must not flip'
      )
      await frame.evaluate(() => {
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        getSelection().removeAllRanges()
      })
      const savedBefore = await page.evaluate(() =>
        localStorage.getItem('pagination-snapshot')
      )
      await page.setViewportSize(
        mobile ? { width: 740, height: 480 } : { width: 440, height: 780 }
      )
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="下一页"]').disabled
      )
      await page.waitForTimeout(200)
      assert.equal(
        await page.evaluate(() => localStorage.getItem('pagination-snapshot')),
        savedBefore,
        'reflow must not persist intermediate locations'
      )
      result.resized = await clearance(page)
      // Locate the old character through the same compatible page text stream:
      // after narrowing, the next saved page start must still surround it.
      await turn(page, '下一页')
      const next = (await state(page)).progress
      assert(next.offset > anchor.offset, JSON.stringify({ next, anchor }))
      await turn(page, '上一页')
      const previous = (await state(page)).progress
      assert(
        previous.offset <= anchor.offset,
        JSON.stringify({ previous, anchor })
      )
      // A transient hidden viewport must preserve the stable character anchor.
      const snapshotBeforeZero = await page.evaluate(() =>
        localStorage.getItem('pagination-snapshot')
      )
      await page.locator('[data-testid="reader-root"]').evaluate((element) => {
        element.style.height = '0px'
      })
      await page.waitForTimeout(100)
      await page.locator('[data-testid="reader-root"]').evaluate((element) => {
        element.style.height = ''
      })
      await page.waitForTimeout(200)
      assert.equal(
        await page.evaluate(() => localStorage.getItem('pagination-snapshot')),
        snapshotBeforeZero
      )
      // Font menu reflow, then drawing tool expansion must reserve real space.
      await page.getByTestId('tool-bottom-bar-font-scale').click()
      await page.getByRole('menuitem', { name: '特大' }).click()
      await page.waitForTimeout(300)
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="下一页"]').disabled
      )
      await clearance(page)
      if (await page.getByTestId('tool-bottom-bar-drawing').count())
        await page.getByTestId('tool-bottom-bar-drawing').click()
      else {
        await page
          .getByRole('button', { name: '工具菜单', exact: true })
          .click()
        await page.getByTestId('tool-bottom-bar-drawing').click()
      }
      await page.waitForTimeout(300)
      result.drawingClearance = await clearance(page)
      await page.screenshot({ path: resolve(output, `${label}-drawing.png`) })
      if (!mobile) {
        const paper = await page
          .locator('.hamster-reader__epub-container')
          .boundingBox()
        await page.mouse.move(paper.x + 100, paper.y + 100)
        await page.mouse.down()
        await page.mouse.move(paper.x + 160, paper.y + 140, { steps: 8 })
        await page.mouse.up()
        await page.waitForFunction(() => {
          const saved = JSON.parse(localStorage.getItem('pagination-snapshot'))
          return (
            saved?.data?.highlights?.paintings?.['page-2']?.strokes?.length > 0
          )
        })
        result.drawingSaved = true
      }
      // Explicit outline navigation tests the whole-book final boundary cheaply.
      await page.getByRole('button', { name: '页面与标注' }).click()
      await page.locator('.hamster-reader__epub-outline summary').click()
      await page.getByRole('button', { name: 'Chapter 2', exact: true }).click()
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view').renderer.getContents()[0]
            ?.index === 2
      )
      await page.waitForFunction(() => {
        const doc = document
          .querySelector('foliate-view')
          .renderer.getContents()[0]?.doc
        const image = doc?.querySelector('img')
        return image?.complete && image.naturalWidth > 0
      })
      const image = await page.evaluate(() => {
        const doc = document
          .querySelector('foliate-view')
          .renderer.getContents()[0].doc
        const image = doc.querySelector('img')
        const box = image.getBoundingClientRect()
        return {
          loaded: image.complete && image.naturalWidth > 0,
          width: box.width,
          height: box.height,
          viewport: document.querySelector('.hamster-reader__epub-container')
            .clientHeight
        }
      })
      assert(
        image.loaded && image.height <= image.viewport,
        JSON.stringify(image)
      )
      result.image = image
      await page.getByRole('button', { name: 'Chapter 3', exact: true }).click()
      await page.getByRole('button', { name: '关闭页面浏览' }).click()
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view').renderer.getContents()[0]
            ?.index === 3
      )
      await turn(page, '上一页')
      assert.equal((await state(page)).index, 2)
      assert.equal(
        (await state(page)).page,
        (await state(page)).pages - 2,
        'previous chapter must open at last page'
      )
      await turn(page, '下一页')
      assert.equal((await state(page)).index, 3)
      let guard = 0
      while (
        await page
          .getByRole('button', { name: '下一页', exact: true })
          .isEnabled()
      ) {
        assert(guard++ < 80, 'book navigation must terminate')
        await turn(page, '下一页')
      }
      result.last = await state(page)
      assert(
        result.last.page <= result.last.pages - 2,
        'no blank trailing page'
      )
      result.turns = turns
    }
    await page.screenshot({ path: resolve(output, `${label}.png`) })
    assert.deepEqual(errors, [])
    result.passed = true
  } catch (error) {
    result.failure = error.stack
    result.errors = errors
    result.state = await state(page).catch(() => null)
    await page
      .screenshot({ path: resolve(output, `${label}-failed.png`) })
      .catch(() => {})
    console.error(label, error.message)
  } finally {
    await browser.close()
  }
}
try {
  for (const type of [chromium, webkit])
    for (const mobile of [false, true]) await run(type, mobile)
  await run(chromium, false, true)
  await run(webkit, true, true)
} finally {
  await new Promise((done) => server.close(done))
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
console.log(
  `EPUB pagination: ${report.cases.filter((item) => item.passed).length}/${report.cases.length} passed`
)
if (report.cases.some((item) => !item.passed)) process.exitCode = 1
