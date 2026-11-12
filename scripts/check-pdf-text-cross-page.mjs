import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const output = 'test-results/pdf-text-cross-page'
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
const report = { browser: '', cases: [] }
const creationSupport = {
  enabled: false,
  reason:
    'openspec/specs/pdfjs-web-reader/spec.md:67 forbids selection overflow from turning pages; PDF Text does not support continuing a draft across original pages.'
}

// Future creation regression against the real host, starting without
// annotations. Enable only when a separate product requirement introduces a
// continuation interaction. Never seed a spanning range or mount hidden pages.
async function checkCreation(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  page.setDefaultTimeout(15000)
  const creation = { steps: [], errors: [], saved: [] }
  report.creation = creation
  page.on('pageerror', (error) => creation.errors.push(error.message))
  const capture = async (step) => {
    const state = await page.evaluate(() => ({
      mountedPages: Array.from(
        document.querySelectorAll('[data-testid^="intermediate-text-page-"]'),
        (element) => element.dataset.pageNumber
      ),
      nativeText: getSelection()?.toString() ?? '',
      handles: document.querySelectorAll('[data-pdf-handle-hit-target]').length,
      highlights: window.creationWrites.at(-1) ?? []
    }))
    creation.steps.push({ step, ...state })
    console.log(JSON.stringify({ step, ...state }))
    await page.screenshot({ path: `${output}/creation-${step}.png` })
    return state
  }
  const point = (word, offset) =>
    page.getByText(word, { exact: true }).evaluate((element, offset) => {
      const range = document.createRange()
      range.setStart(element.firstChild, offset)
      range.setEnd(element.firstChild, offset + 1)
      const box = range.getBoundingClientRect()
      return { x: box.left + 0.2, y: box.top + box.height / 2 }
    }, offset)
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
  }
  const adjust = async (side, target) => {
    const handle = page.getByRole('button', { name: `调整高亮${side}` })
    const box = await handle.boundingBox()
    assert.ok(box, `visible ${side} handle`)
    await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, target)
  }
  try {
    await page.goto(
      process.env.WEBBASE_BROWSER_URL ?? 'http://127.0.0.1:6229/?demo=1'
    )
    await page.getByRole('heading', { name: 'WebView Demo' }).waitFor()
    await page.evaluate(() => {
      window.creationWrites = []
      const bridge = window.ReactNativeWebView
      const send = bridge.postMessage.bind(bridge)
      bridge.postMessage = (text) => {
        try {
          const message = JSON.parse(text)
          if (['file.write', 'file.create'].includes(message.request)) {
            const data = JSON.parse(message.payload.contents)
            if (data.highlights) window.creationWrites.push(data.highlights)
          }
        } catch {
          /* Non-document bridge payload. */
        }
        send(text)
      }
    })
    await page
      .locator('.browser-demo__controls input[type=file]')
      .setInputFiles({
        name: 'two-page-positioned-runs.pdf',
        mimeType: 'application/pdf',
        buffer: await readFile(
          new URL(
            '../test/fixtures/pdf/two-page-positioned-runs.pdf',
            import.meta.url
          )
        )
      })
    await page.getByRole('button', { name: '写入并打开', exact: true }).click()
    await page
      .getByRole('button', { name: '切换到文字渲染模式', exact: true })
      .click()
    await page.getByText('def', { exact: true }).waitFor()
    const initial = await capture('empty-page-1')
    assert.equal(initial.highlights.length, 0)
    const start = await point('def', 0)
    const tail = await point('jkl', 2)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(tail.x, tail.y, { steps: 12 })
    const viewport = await page
      .getByTestId('intermediate-document-text-viewer')
      .boundingBox()
    await page.mouse.move(tail.x, viewport.y + viewport.height - 5, {
      steps: 12
    })
    // Allow several rendering frames at the edge; no DOM selection is injected.
    await page.evaluate(async () => {
      for (let frame = 0; frame < 30; frame++)
        await new Promise(requestAnimationFrame)
    })
    await page.mouse.up()
    await capture('edge-release')
    await adjust('终点', await point('jkl', 2))
    await adjust('起点', await point('ghi', 0))
    await capture('adjusted-page-1-draft')
    // The only available UI route to original page 2 is the Next button.
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await page.getByText('mno', { exact: true }).waitFor()
    const afterTurn = await capture('after-next-page')
    creation.continuationAvailable = afterTurn.handles > 0
    if (!creation.continuationAvailable) {
      // With today's UI the previous draft is gone. Record what a subsequent
      // page-2 selection actually saves, while retaining the spanning assertion.
      await drag(await point('mno', 0), await point('vwx', 2))
      await adjust('起点', await point('mno', 1))
    }
    await adjust('终点', await point('vwx', 1))
    await capture('adjusted-page-2-draft')
    const count = await page.evaluate(() => window.creationWrites.length)
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    await page.waitForFunction(
      (count) =>
        window.creationWrites.length > count &&
        window.creationWrites.at(-1).length > 0,
      count
    )
    creation.saved = (await capture('confirmed')).highlights
    assert.equal(creation.saved.length, 1)
    await page
      .getByRole('button', { name: '切换到布局渲染模式', exact: true })
      .click()
    await page
      .locator('.hsn-selection-percent-rect-highlight')
      .first()
      .waitFor()
    assert.equal(
      await page.locator('[data-testid^="page-browser-highlight-"]').count(),
      1
    )
    assert.equal(
      await page
        .locator('[data-testid^="page-browser-highlight-"]')
        .getAttribute('data-range-id'),
      creation.saved[0].id
    )
    assert.deepEqual((await capture('layout')).highlights, creation.saved)
    await page
      .getByRole('button', { name: '切换到文字渲染模式', exact: true })
      .click()
    await page.getByText('pqr', { exact: true }).waitFor()
    const blank = await page
      .getByTestId('intermediate-document-text-viewer')
      .boundingBox()
    await page.mouse.click(
      blank.x + blank.width / 2,
      blank.y + blank.height - 100
    )
    await page.waitForFunction(
      () => !document.querySelector('[data-pdf-handle-hit-target]')
    )
    await capture('deselected')
    const middle = await page.getByText('pqr', { exact: true }).boundingBox()
    await page.mouse.click(
      middle.x + middle.width / 2,
      middle.y + middle.height / 2
    )
    await page.getByRole('button', { name: '调整高亮终点' }).waitFor()
    assert.deepEqual((await capture('reselected')).highlights, creation.saved)
    assert.deepEqual(creation.errors, [])
    // A single-page round trip cannot substitute for a spanning annotation
    // when this future regression is enabled.
    assert.equal(
      creation.saved[0].start.selectionId,
      'page-1',
      'a cross-page creation must retain its page-1 start'
    )
    assert.equal(creation.saved[0].end.selectionId, 'page-2')
  } catch (error) {
    creation.failure = error.message
    throw error
  } finally {
    await page.close()
  }
}
let browser
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/pdf-text-cross-page.tsx'
  )
  browser = await chromium.launch()
  report.browser = browser.version()
  for (const spaced of [false, true]) {
    for (const controlled of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 900, height: 900 }
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/cross-page.html*', (route) =>
        route.fulfill({ contentType: 'text/html', body: html })
      )
      await page.goto(
        `${base}/cross-page.html?${spaced ? 'spaced&' : ''}${controlled ? 'controlled' : ''}`
      )
      await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
      const handle = page.getByRole('button', { name: '调整高亮终点' })
      await handle.waitFor()
      assert.equal(
        await page.getByRole('button', { name: '调整高亮起点' }).count(),
        0
      )
      assert.equal(
        await page.getByTestId('intermediate-text-page-1').count(),
        0
      )
      const anchors = await page
        .locator('[data-selection-start-offset]')
        .evaluateAll((elements) =>
          elements.map((element) =>
            Number(element.dataset.selectionStartOffset)
          )
        )
      assert.deepEqual(anchors, spaced ? [0, 14] : [0])
      // Use real Chromium caret hit testing. The final character is excluded;
      // DOM end 6 maps to canonical 6 or 16 depending on source whitespace.
      const target = await page
        .locator('[data-selection-start-offset]')
        .last()
        .evaluate(
          (element, offset) => {
            const range = document.createRange()
            range.setStart(element.firstChild, offset)
            range.setEnd(element.firstChild, offset + 1)
            const box = range.getBoundingClientRect()
            return { x: box.left + 0.2, y: box.top + box.height / 2 }
          },
          spaced ? 2 : 6
        )
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(target.x, target.y, { steps: 5 })
      await page.mouse.up()
      await page.waitForFunction(
        (expected) =>
          window.crossPageSnapshots.at(-1)?.items[0]?.end.offset === expected,
        spaced ? 16 : 6
      )
      assert.equal(
        await page.evaluate(() =>
          window.crossPageSnapshots.every((snapshot) =>
            snapshot.items.some((item) => item.id === 'saved')
          )
        ),
        true,
        'no snapshot may delete the highlight'
      )
      const snapshot = await page.evaluate(() =>
        window.crossPageSnapshots.at(-1)
      )
      assert.equal(
        snapshot.items.length,
        1,
        'edit must not delete the saved highlight'
      )
      const item = snapshot.items[0]
      assert.equal(item.id, 'saved')
      assert.deepEqual(item.selectionGroup, { id: 'logical', index: 0 })
      assert.deepEqual(item.start, { selectionId: 'page-1', offset: 0 })
      assert.deepEqual(item.end, {
        selectionId: 'page-2',
        offset: spaced ? 16 : 6
      })
      assert.equal(item.text, spaced ? 'previousabc de' : 'previousabcdef')
      await handle.waitFor()
      assert.deepEqual(errors, [])
      const result = {
        spaced,
        controlled,
        start: item.start,
        end: item.end,
        items: snapshot.items.length
      }
      report.cases.push(result)
      console.log(JSON.stringify(result))
      await page.close()
    }
  }
  console.log(`PASS: ${report.cases.length} PDF cross-page edit/snapshot cases`)
  if (process.env.PDF_CROSS_PAGE_CREATE === '1') {
    if (creationSupport.enabled) await checkCreation(browser)
    else {
      report.creation = {
        status: 'skipped',
        reason: creationSupport.reason,
        fixture: 'test/fixtures/pdf/two-page-positioned-runs.pdf'
      }
      console.log(`SKIP: PDF cross-page creation: ${creationSupport.reason}`)
    }
  }
} finally {
  await writeFile(`${output}/chromium.json`, JSON.stringify(report, null, 2))
  await browser?.close()
  await server.close()
}
