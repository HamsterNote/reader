import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { chromium, webkit } from 'playwright'
import { createServer as createViteServer } from 'vite'
import react from '@vitejs/plugin-react'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../ham130-browser')
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
  devices: 'Linux headless Chromium/WebKit; no physical iOS or Android WebView'
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
async function clearance(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect()
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom
      }
    }
    return {
      paper: rect('.hamster-reader__intermediate-text-spacer'),
      toolbar: rect('[data-testid="tool-bottom-bar"]'),
      controls: rect('.hamster-reader__viewport-pagination')
    }
  })
}
async function assertAnchorVisible(page, offset) {
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
async function checkTxtScroll() {
  const result = { label: 'chromium-txt-scroll', passed: false }
  report.cases.push(result)
  const vite = await createViteServer({
    root: repo,
    configFile: false,
    plugins: [react()],
    logLevel: 'error',
    optimizeDeps: { entries: ['scripts/fixtures/text-reader.html'] },
    server: { host: '127.0.0.1', port: 0 }
  })
  let browser
  try {
    await vite.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({
      viewport: { width: 960, height: 700 }
    })
    await page.goto(
      `${vite.resolvedUrls.local[0]}scripts/fixtures/text-reader.html`
    )
    await page
      .getByText('Original scrolling line 100', { exact: true })
      .waitFor({ state: 'attached' })
    assert.equal(
      await page.getByRole('button', { name: '下一页', exact: true }).count(),
      0
    )
    await page.mouse.move(300, 200)
    result.geometry = await page
      .locator('.hamster-reader__intermediate-text-scroll')
      .evaluate((element) => ({
        height: element.clientHeight,
        scrollHeight: element.scrollHeight,
        box: element.getBoundingClientRect().toJSON(),
        hit: document.elementFromPoint(300, 200)?.outerHTML.slice(0, 300)
      }))
    await page.mouse.wheel(0, 500)
    await page.waitForFunction(
      () =>
        document.querySelector('.hamster-reader__intermediate-text-scroll')
          .scrollTop > 0
    )
    result.scrollTop = await page
      .locator('.hamster-reader__intermediate-text-scroll')
      .evaluate((element) => element.scrollTop)
    await page.screenshot({ path: resolve(output, 'chromium-txt-scroll.png') })
    result.passed = true
  } catch (error) {
    result.failure = error.stack
    console.error('TXT', error.message)
  } finally {
    await browser?.close()
    await vite.close()
  }
}

try {
  for (const type of [chromium, webkit]) {
    const result = { label: type.name(), passed: false, evidence: [] }
    report.cases.push(result)
    let browser
    let page
    try {
      browser = await type.launch({ headless: true })
      page = await browser.newPage({
        viewport: { width: 960, height: 700 },
        hasTouch: true
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await boot(page)
      const first = await state(page)
      assert.equal(first.source, sourceText)
      assert(
        await page
          .getByRole('button', { name: '上一页', exact: true })
          .isDisabled()
      )
      await turn(page, '下一页', 2)
      const second = await state(page)
      assert.equal(second.transform, 'translateX(-984px)')
      result.fastClicksOneScreen = true
      await turn(page, '下一页')
      const third = await state(page)
      assert.equal(third.page, 1)
      assert(second.progress.anchor.offset > 0)
      assert(third.progress.anchor.offset > second.progress.anchor.offset)
      result.evidence.push({ first, second, third })
      await page.screenshot({
        path: resolve(output, `${type.name()}-third.png`)
      })
      // Real native Range on an interior column of the same source span.
      await page.evaluate((offset) => {
        const span = document.querySelector(
          '.hsn-selection-content [data-text-id]'
        )
        const range = document.createRange()
        range.setStart(span.firstChild, offset + 102)
        range.setEnd(span.firstChild, offset + 114)
        getSelection().removeAllRanges()
        getSelection().addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      }, third.progress.anchor.offset)
      await page.getByRole('button', { name: '高亮', exact: true }).click()
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem('pdf-snapshot')).data.highlights
            .ranges.length === 2
      )
      const highlight = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem('pdf-snapshot')
        ).data.highlights.ranges.find(
          (range) => range.id !== 'historic-cross-page'
        )
      )
      assert.equal(
        highlight.text,
        sourceText.slice(
          third.progress.anchor.offset + 102,
          third.progress.anchor.offset + 114
        )
      )
      assert.equal(highlight.start.offset, third.progress.anchor.offset + 102)
      assert.equal(highlight.end.offset, third.progress.anchor.offset + 114)
      result.highlight = highlight
      await page.mouse.click(900, 300)
      await page.getByRole('button', { name: '页面与标注' }).click()
      await page.getByRole('tab', { name: '高亮', exact: true }).click()
      await page.getByTestId(`page-browser-highlight-${highlight.id}`).click()
      await page.getByRole('button', { name: '关闭页面浏览' }).focus()
      await page.keyboard.press('Enter')
      const handle = page.locator('[data-range-handle-circle="end"]')
      await handle.waitFor({ state: 'visible' })
      const goal = await page.evaluate((offset) => {
        const node = document.querySelector(
          '.hsn-selection-content [data-text-id]'
        ).firstChild
        const range = document.createRange()
        range.setStart(node, offset + 2)
        range.setEnd(node, offset + 3)
        const rect = range.getBoundingClientRect()
        return { x: rect.left, y: rect.top + rect.height / 2 }
      }, highlight.end.offset)
      const handleBox = await handle.boundingBox()
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2
      )
      await page.mouse.down()
      await page.mouse.move(goal.x, goal.y, { steps: 5 })
      await page.mouse.up()
      await page.waitForFunction(
        ({ id, end }) =>
          JSON.parse(
            localStorage.getItem('pdf-snapshot')
          ).data.highlights.ranges.find((range) => range.id === id).end.offset >
          end,
        { id: highlight.id, end: highlight.end.offset }
      )
      result.endpointEdited = true
      await page.getByRole('button', { name: '评论', exact: true }).click()
      await page
        .getByRole('textbox', { name: '评论内容' })
        .fill('PDF Text pagination comment')
      await page.getByRole('button', { name: '添加评论', exact: true }).click()
      await page.waitForFunction(
        (id) =>
          JSON.parse(
            localStorage.getItem('pdf-snapshot')
          ).data.comments.comments.some((comment) =>
            comment.highlightIds.includes(id)
          ),
        highlight.id
      )
      await page.getByRole('button', { name: '关闭评论' }).click()
      result.commentLinked = true

      await turn(page, '上一页')
      assert.equal(
        (await state(page)).progress.anchor.offset,
        second.progress.anchor.offset
      )
      await turn(page, '下一页')
      await page.reload()
      await ready(page)
      assert.equal((await state(page)).transform, third.transform)
      await page.getByRole('button', { name: '切换到布局渲染模式' }).click()
      await page.locator('.pdfViewer').waitFor()
      assert.equal(
        await page.getByRole('button', { name: '下一页', exact: true }).count(),
        0
      )
      await page.getByRole('button', { name: '切换到文字渲染模式' }).click()
      await ready(page)
      assert.equal((await state(page)).transform, third.transform)
      result.modeBridge = true
      for (const label of ['中', '特大', '大']) {
        await page.getByTestId('tool-bottom-bar-font-scale').click()
        await page.getByRole('menuitem', { name: label, exact: true }).click()
        await ready(page)
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              )
            )
        )
        await assertAnchorVisible(page, third.progress.anchor.offset)
        assert.equal(
          (await state(page)).progress.anchor.offset,
          third.progress.anchor.offset
        )
      }
      result.fontReflow = true
      for (const viewport of [
        { width: 320, height: 740 },
        { width: 740, height: 320 },
        { width: 960, height: 700 }
      ]) {
        await page.setViewportSize(viewport)
        await page.waitForFunction(
          () => !document.querySelector('[aria-label="下一页"]').disabled
        )
        // Wait for the ResizeObserver + pagination frame, without relying on a timer.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              )
            )
        )
        const boxes = await clearance(page)
        assert(
          boxes.paper.bottom <= Math.min(boxes.toolbar.top, boxes.controls.top),
          JSON.stringify(boxes)
        )
        const value = await state(page)
        await assertAnchorVisible(page, third.progress.anchor.offset)
        assert.equal(value.progress.anchor.offset, third.progress.anchor.offset)
        result.evidence.push({
          viewport,
          boxes,
          progress: value.progress,
          transform: value.transform
        })
        await page.screenshot({
          path: resolve(output, `${type.name()}-${viewport.width}.png`)
        })
      }
      for (const width of [800, 600, 1000, 960])
        await page.setViewportSize({ width, height: 700 })
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
          )
      )
      await ready(page)
      await assertAnchorVisible(page, third.progress.anchor.offset)
      // A transient zero-size frame must not replace the last successful anchor.
      await page.evaluate(() => {
        document.querySelector(
          '.hamster-reader__pdf-text-viewport'
        ).style.height = '0px'
      })
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      await page.evaluate(() => {
        document.querySelector(
          '.hamster-reader__pdf-text-viewport'
        ).style.height = ''
      })
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
          )
      )
      await ready(page)
      assert.equal(
        (await state(page)).progress.anchor.offset,
        third.progress.anchor.offset
      )
      // All paper input must leave both the visible column and outer scroll unchanged.
      const before = await state(page)
      for (const point of [
        { x: 100, y: 100 },
        { x: 650, y: 590 }
      ]) {
        await page.mouse.move(point.x, point.y)
        await page.mouse.wheel(0, 500)
        await page.mouse.wheel(500, 0)
      }
      await page
        .locator('[role="document"]')
        .evaluate((element) => element.setAttribute('tabindex', '-1'))
      await page.locator('[role="document"]').focus()
      for (const key of [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Space',
        'PageUp',
        'PageDown',
        'Home',
        'End'
      ])
        await page.keyboard.press(key)
      if (type === chromium) {
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: 300, y: 300 }]
        })
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: 300, y: 100 }]
        })
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: []
        })
        await cdp.detach()
      }
      assert.equal((await state(page)).transform, before.transform)
      assert.equal((await state(page)).scroll, 0)
      assert.equal(await page.evaluate(() => window.scrollY), 0)
      result.paperInputsBlocked = true
      // Both keyboard activation paths use the same one-screen navigation.
      await page.getByRole('button', { name: '上一页', exact: true }).focus()
      await page.keyboard.press('Enter')
      await ready(page)
      await page.waitForFunction(
        (transform) =>
          document.querySelector('.hsn-selection-content')?.style.transform !==
          transform,
        before.transform
      )
      await page.getByRole('button', { name: '下一页', exact: true }).focus()
      await page.keyboard.press('Space')
      await ready(page)
      await page.waitForFunction(
        (transform) =>
          document.querySelector('.hsn-selection-content')?.style.transform ===
          transform,
        before.transform
      )
      result.keyboardTurns = true
      await page.getByRole('button', { name: '页面与标注' }).click()
      await page.getByRole('tab', { name: '书签', exact: true }).click()
      const list = page.locator('.hamster-reader__bookmark-list')
      const listBox = await list.boundingBox()
      await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + 120)
      await page.mouse.wheel(0, 650)
      await page.waitForFunction(
        () =>
          document.querySelector('.hamster-reader__bookmark-list').scrollTop > 0
      )
      assert.equal((await state(page)).transform, before.transform)
      await page
        .getByRole('button', {
          name: '跳转到书签：saved bookmark 30',
          exact: true
        })
        .click()
      await ready(page)
      await page.getByRole('button', { name: '关闭页面浏览' }).click()
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem('pdf-snapshot')).data.readerData
            .textReadingProgress.anchor.offset === 3000
      )
      assert.equal((await state(page)).progress.anchor.offset, 3000)
      result.bookmarkAndSidebarScroll = true
      // Page-number navigation is a source-page seek and opens the first column.
      const rail = page.getByRole('slider', { name: '文本阅读进度' })
      await rail.focus()
      await page.keyboard.press('End')
      await ready(page)
      await page.waitForFunction(
        () =>
          Number(
            document.querySelector('.hamster-reader__intermediate-text-page')
              ?.dataset.pageNumber
          ) === 3
      )
      assert.equal((await state(page)).transform, 'translateX(0px)')
      await rail.focus()
      await page.keyboard.press('Home')
      await ready(page)
      await page.waitForFunction(
        () =>
          Number(
            document.querySelector('.hamster-reader__intermediate-text-page')
              ?.dataset.pageNumber
          ) === 1
      )
      assert.equal((await state(page)).transform, 'translateX(0px)')
      result.sourcePageSeek = true
      while (
        await page
          .getByRole('button', { name: '上一页', exact: true })
          .isEnabled()
      )
        await turn(page, '上一页')
      const seen = new Set()
      result.screens = []
      let guard = 0
      while ((await state(page)).page === 1) {
        assert(guard++ < 40)
        const offsets = await page.evaluate(() => {
          const viewport = document
            .querySelector('.hsn-selection-container')
            .getBoundingClientRect()
          const span = document.querySelector(
            '.hsn-selection-content [data-text-id]'
          )
          const node = span.firstChild
          const offsets = []
          const range = document.createRange()
          for (let offset = 0; offset < node.length; offset++) {
            if (/\s/.test(node.textContent[offset])) continue
            range.setStart(node, offset)
            range.setEnd(node, offset + 1)
            const box = range.getBoundingClientRect()
            if (
              box.left >= viewport.left - 0.5 &&
              box.right <= viewport.right + 0.5 &&
              box.top >= viewport.top - 0.5 &&
              box.bottom <= viewport.bottom + 0.5
            )
              offsets.push(offset)
          }
          return offsets
        })
        assert(
          offsets.length > 0,
          'no blank column before the source page ends'
        )
        for (const offset of offsets) {
          assert(!seen.has(offset), `repeated source character ${offset}`)
          seen.add(offset)
        }
        result.screens.push({
          first: offsets[0],
          last: offsets.at(-1),
          characters: offsets.length
        })
        await turn(page, '下一页')
      }
      assert.equal(
        seen.size,
        sourceText.replace(/\s/g, '').length,
        'no lost source characters'
      )
      assert.equal((await state(page)).page, 2)
      await page.getByText('第 2 页没有可提取的文字').waitFor()
      await page
        .getByRole('button', { name: '返回 Layout', exact: true })
        .waitFor()
      await turn(page, '上一页')
      const lastOfFirst = await state(page)
      await turn(page, '下一页')
      await turn(page, '下一页')
      assert.equal((await state(page)).page, 3)
      assert(
        await page
          .getByRole('button', { name: '下一页', exact: true })
          .isDisabled()
      )
      await turn(page, '上一页')
      await turn(page, '上一页')
      assert.equal((await state(page)).transform, lastOfFirst.transform)
      await page.getByRole('button', { name: '页面与标注' }).click()
      await page.getByRole('tab', { name: '高亮', exact: true }).click()
      await page
        .getByTestId('page-browser-highlight-historic-cross-page')
        .click()
      await ready(page)
      await page.getByRole('button', { name: '关闭页面浏览' }).focus()
      await page.keyboard.press('Enter')
      await page
        .locator('[data-range-handle-circle="start"]')
        .waitFor({ state: 'visible' })
      assert.equal(
        await page.locator('[data-range-handle-circle="end"]').count(),
        0,
        'the historic end is on another source page'
      )
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem('pdf-snapshot')).data.readerData
            .textReadingProgress.anchor.offset === 6
      )
      assert.equal((await state(page)).progress.anchor.offset, 6)
      const clipped = await page.evaluate(() => {
        const viewport = document
          .querySelector('.hsn-selection-container')
          .getBoundingClientRect()
        const rects = Array.from(
          document.querySelectorAll(
            '.hsn-selection-container .hsn-selection-percent-rect-highlight'
          )
        )
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width && rect.height)
        return {
          count: rects.length,
          inside: rects.every(
            (rect) =>
              rect.left >= viewport.left - 12 &&
              rect.right <= viewport.right + 12 &&
              rect.top >= viewport.top - 12 &&
              rect.bottom <= viewport.bottom + 12
          )
        }
      })
      assert(clipped.count > 0 && clipped.inside, JSON.stringify(clipped))
      result.historicCrossPage = true
      await page.mouse.click(900, 590)
      await page.getByRole('button', { name: '页面与标注' }).click()
      await page.getByTestId(`page-browser-highlight-${highlight.id}`).click()
      await ready(page)
      await page.getByRole('button', { name: '关闭页面浏览' }).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: '删除', exact: true }).click()
      await page.waitForFunction(
        (id) =>
          !JSON.parse(
            localStorage.getItem('pdf-snapshot')
          ).data.highlights.ranges.some((range) => range.id === id),
        highlight.id
      )
      result.highlightDeleted = true
      const edgeBefore = await state(page)
      const viewportBox = await page
        .locator('.hsn-selection-container')
        .boundingBox()
      await page.mouse.move(450, viewportBox.y + 180)
      await page.mouse.down()
      await page.mouse.move(960, 699, { steps: 15 })
      await page.mouse.up()
      assert.equal((await state(page)).transform, edgeBefore.transform)
      assert.equal((await state(page)).scroll, 0)
      assert.equal(await page.evaluate(() => window.scrollY), 0)
      result.edgeSelectionNoTurn = true
      const persisted = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('pdf-snapshot'))
      )
      assert.equal(persisted.data.highlights.version, 4)
      assert.deepEqual(
        persisted.data.highlights.ranges.map((range) => range.id),
        ['historic-cross-page']
      )
      await page.screenshot({
        path: resolve(output, `${type.name()}-annotations.png`)
      })
      assert.deepEqual(errors, [])
      result.passed = true
    } catch (error) {
      result.failure = error.stack
      result.state = page ? await state(page).catch(() => null) : null
      result.layout = page
        ? await page
            .evaluate(() =>
              Array.from(
                document.querySelectorAll(
                  '[data-testid="reader-root"], .hamster-reader__intermediate-text-shell, .hamster-reader__pdf-text-viewport, .hsn-selection-container, .hsn-selection-content'
                )
              ).map((element) => ({
                className: element.className,
                box: element.getBoundingClientRect().toJSON(),
                style: element.getAttribute('style')
              }))
            )
            .catch(() => null)
        : null
      await page
        ?.screenshot({ path: resolve(output, `${type.name()}-failed.png`) })
        .catch(() => {})
      console.error(type.name(), error.message)
    } finally {
      await browser?.close()
    }
  }
  await checkTxtScroll()
} finally {
  await new Promise((done) => server.close(done))
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
console.log(
  `PDF Text pagination: ${report.cases.filter((item) => item.passed).length}/${report.cases.length} passed`
)
if (report.cases.some((item) => !item.passed)) process.exitCode = 1
