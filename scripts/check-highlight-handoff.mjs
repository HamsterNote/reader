import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import JSZip from 'jszip'
const output = resolve(
  process.env.READER_BROWSER_OUTPUT ?? 'test-results/highlight-handoff'
)
await mkdir(output, { recursive: true })
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false }
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const html = (await (await fetch(base)).text()).replace(
  '/demo/main.tsx',
  '/test/browser/review-regressions.tsx'
)
const browser = await chromium.launch()
const report = {
  environment: {
    node: process.version,
    browser: browser.version(),
    platform: process.platform
  },
  startedAt: new Date().toISOString(),
  cases: []
}
try {
  for (const surface of ['pdf-layout', 'pdf-text', 'epub']) {
    console.log(`Handoff: ${surface}`)
    const page = await browser.newPage({
      viewport: { width: 900, height: 900 },
      hasTouch: true
    })
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(error.message)
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error(msg.text())
    })
    await page.route('**/handoff.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: html })
    )
    await page.goto(`${base}/handoff.html`)
    await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
    await page.waitForFunction(() => window.readerRegression)
    let data = await readFile(
      `test/compat/fixtures/${surface === 'epub' ? 'epub/duplicate-text.epub' : 'pdf/two-column.pdf'}`
    )
    if (surface === 'epub') {
      const zip = await JSZip.loadAsync(data)
      zip.file(
        'OPS/chapter1.xhtml',
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body><p>Line 1 alpha beta gamma delta epsilon zeta.</p></body></html>'
      )
      zip.file(
        'OPS/package.opf',
        (await zip.file('OPS/package.opf').async('string')).replace(
          '<itemref idref="cover" />',
          ''
        )
      )
      data = await zip.generateAsync({ type: 'uint8array' })
    }
    const bytes = [...data]
    const props = {
      renderMode: surface === 'pdf-text' ? 'text' : 'layout',
      isPdf: surface !== 'epub',
      isEpub: surface === 'epub',
      selectedTool: 'text-selection'
    }
    await page.evaluate(
      ({ bytes, props, surface }) =>
        window.readerRegression.open(
          surface === 'epub' ? 'epub' : 'pdf',
          bytes,
          props
        ),
      { bytes, props, surface }
    )
    await page
      .waitForFunction((surface) => {
        const doc =
          surface === 'epub'
            ? document.querySelector('foliate-view')?.renderer?.getContents()[0]
                ?.doc
            : document
        return [
          ...(doc?.querySelectorAll(
            surface === 'epub'
              ? 'p'
              : surface === 'pdf-text'
                ? '.hsn-selection-content [data-text-id]'
                : '.textLayer [data-selection-start-offset]'
          ) ?? [])
        ].some((e) => e.firstChild?.nodeType === 3 && e.firstChild.length >= 19)
      }, surface)
      .catch(async (error) => {
        console.error(await page.locator('body').innerText())
        await page.screenshot({
          path: resolve(output, surface + '-failed.png')
        })
        throw error
      })
    const points = await page.evaluate((surface) => {
      const doc =
        surface === 'epub'
          ? document.querySelector('foliate-view').renderer.getContents()[0].doc
          : document
      const e = [
        ...doc.querySelectorAll(
          surface === 'epub'
            ? 'p'
            : surface === 'pdf-text'
              ? '.hsn-selection-content [data-text-id]'
              : '.textLayer [data-selection-start-offset]'
        )
      ].find((e) => e.firstChild?.nodeType === 3 && e.firstChild.length >= 19)
      const point = (offset) => {
        const r = doc.createRange()
        r.setStart(e.firstChild, offset)
        r.setEnd(e.firstChild, offset + 1)
        const b = r.getBoundingClientRect(),
          f = doc.defaultView.frameElement?.getBoundingClientRect()
        return {
          x: b.left + b.width / 2 + (f?.left ?? 0),
          y: b.top + b.height / 2 + (f?.top ?? 0)
        }
      }
      return [point(8), point(18), point(12)]
    }, surface)
    await page.evaluate((surface) => {
      const doc =
        surface === 'epub'
          ? document.querySelector('foliate-view').renderer.getContents()[0].doc
          : document
      const e = [
        ...doc.querySelectorAll(
          surface === 'epub'
            ? 'p'
            : surface === 'pdf-text'
              ? '.hsn-selection-content [data-text-id]'
              : '.textLayer [data-selection-start-offset]'
        )
      ].find((e) => e.firstChild?.nodeType === 3 && e.firstChild.length >= 19)
      const range = doc.createRange()
      range.setStart(e.firstChild, 8)
      range.setEnd(e.firstChild, 18)
      const selection = doc.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      doc.dispatchEvent(new Event('selectionchange'))
      e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    }, surface)
    await page
      .locator('.hamster-reader__engine-handle')
      .first()
      .waitFor()
      .catch(async (error) => {
        console.error(
          await page.evaluate(() => ({
            selection: getSelection()?.toString(),
            text: document.body.innerText.slice(0, 200)
          }))
        )
        await page.screenshot({
          path: resolve(output, surface + '-selection-failed.png')
        })
        throw error
      })
    await page.evaluate(() =>
      window.readerRegression.selection.current.confirm()
    )
    await page.waitForFunction(
      () => window.readerRegression.state.ranges.length === 1
    )
    const original = await page.evaluate(
      () => window.readerRegression.state.ranges[0]
    )
    await page.evaluate(() => {
      window.handoffEvents = []
      window.legacyCalls = 0
      window.handoff = {
        contract: 'pane-highlight-drag-v1',
        onGesture: (gesture, acknowledge) => {
          window.handoffEvents.push(JSON.parse(JSON.stringify(gesture)))
          if (gesture.phase === 'start') {
            window.endHandoff = () => acknowledge('ended')
            acknowledge('accepted')
          }
        }
      }
      window.readerRegression.update({
        highlightDragHandoff: window.handoff,
        onDragHighlight: () => window.legacyCalls++
      })
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, ...points[2] }]
    })
    await page.waitForFunction(() => window.handoffEvents.length > 0)
    const start = await page.evaluate(() => window.handoffEvents[0])
    assert.equal(start.phase, 'start')
    assert.deepEqual(start.highlight, original)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x: points[2].x + 60, y: points[2].y + 60 }]
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: []
    })
    const state = await page.evaluate(() => ({
      events: window.handoffEvents,
      legacyCalls: window.legacyCalls,
      ghosts: [
        document,
        ...(document
          .querySelector('foliate-view')
          ?.renderer?.getContents()
          .map((e) => e.doc) ?? [])
      ].reduce(
        (n, doc) =>
          n +
          doc.querySelectorAll('[data-testid="highlight-drag-preview"]').length,
        0
      )
    }))
    assert.equal(state.legacyCalls, 0)
    assert.equal(state.events.length, 1)
    assert.equal(state.ghosts, 0)
    await page.evaluate(() => window.endHandoff())
    for (let i = 0; i < 20; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 1, ...points[2] }]
      })
      await page.evaluate(
        ({ bytes, props, surface, original }) =>
          window.readerRegression.open(
            surface === 'epub' ? 'epub' : 'pdf',
            bytes,
            {
              ...props,
              ranges: [original],
              highlightDragHandoff: window.handoff
            }
          ),
        { bytes, props, surface, original }
      )
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: []
      })
      await page.waitForFunction((surface) => {
        const doc =
          surface === 'epub'
            ? document.querySelector('foliate-view')?.renderer?.getContents()[0]
                ?.doc
            : document
        return (
          doc?.querySelector(
            surface === 'epub'
              ? 'p'
              : surface === 'pdf-text'
                ? '.hsn-selection-content [data-text-id]'
                : '.textLayer [data-selection-start-offset]'
          )?.textContent?.length > 0
        )
      }, surface)
    }
    assert.equal(
      await page.evaluate(
        () => window.handoffEvents.filter((e) => e.phase === 'start').length
      ),
      1,
      'old pending timers cannot fire in new documents'
    )
    assert.deepEqual(errors, [])
    await page.screenshot({ path: resolve(output, `${surface}.png`) })
    report.cases.push({
      surface,
      original,
      ...state,
      switches: 20,
      passed: true
    })
    await page.close()
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await browser.close()
  await server.close()
}
