import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { webkit } from 'playwright'
import { createServer } from 'vite'
import JSZip from 'jszip'

// WebKit's public Playwright input supports native taps, not sustained touch
// drags. Seed the Selection a long press would produce, then test native tap
// capture/release and explicitly synthetic paired/interrupted event streams.
const zip = await JSZip.loadAsync(
  await readFile('test/compat/fixtures/epub/duplicate-text.epub')
)
const text = 'Line 1 alpha beta gamma delta epsilon zeta.'
zip.file(
  'OPS/chapter1.xhtml',
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Touch regression</title></head><body><p>${text}</p><p>Line 2 alpha beta gamma delta epsilon zeta.</p></body></html>`
)
zip.file(
  'OPS/package.opf',
  (await zip.file('OPS/package.opf').async('string')).replace(
    '<itemref idref="cover" />',
    ''
  )
)
const bytes = Array.from(await zip.generateAsync({ type: 'uint8array' }))
const output = resolve('test-results/webkit-selection-touch')
const report = {
  platform: `${process.platform}/${process.arch}`,
  browserVersion: '',
  coverage:
    'Linux Playwright WebKit mobile viewport: trusted taps; synthetic touch drags/fault injection. Native long press, sustained OS touch, iOS Safari/WKWebView and Android devices pending.',
  cases: [],
  events: []
}
const errors = []
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser, page
try {
  await mkdir(output, { recursive: true })
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  browser = await webkit.launch({
    executablePath: process.env.WEBKIT_EXECUTABLE_PATH
  })
  report.browserVersion = browser.version()
  for (const saved of [false, true])
    for (const end of [false, true]) {
      page = await browser.newPage({
        viewport: { width: 402, height: 874 },
        hasTouch: true,
        isMobile: true
      })
      page.setDefaultTimeout(20000)
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/touch.html', (route) =>
        route.fulfill({ contentType: 'text/html', body: html })
      )
      await page.goto(`${base}/touch.html`)
      await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
      await page.waitForFunction(() => window.readerRegression)
      await page.evaluate(
        (bytes) =>
          window.readerRegression.open('epub', bytes, {
            isEpub: true,
            isPdf: false,
            selectedTool: 'text-selection',
            highlightColor: '#ff1234'
          }),
        bytes
      )
      await page.waitForFunction(() =>
        document
          .querySelector('foliate-view')
          ?.renderer?.getContents()[0]
          ?.doc.querySelector('p')
      )
      await page.evaluate(() => {
        const doc = document
          .querySelector('foliate-view')
          .renderer.getContents()[0].doc
        const node = doc.querySelector('p').firstChild
        const range = doc.createRange()
        doc.querySelector('p').dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerId: 4001,
            pointerType: 'touch',
            clientX: 80,
            clientY: 83
          })
        )
        const start = new Event('touchstart', { bubbles: true })
        Object.defineProperties(start, {
          touches: { value: [{ identifier: 4001 }] },
          changedTouches: { value: [{ identifier: 4001 }] }
        })
        doc.querySelector('p').dispatchEvent(start)
        range.setStart(node, 8)
        range.setEnd(node, 18)
        doc.getSelection().removeAllRanges()
        doc.getSelection().addRange(range)
        doc.dispatchEvent(new Event('selectionchange'))
        window.touchTrace = []
        for (const type of [
          'pointerdown',
          'pointermove',
          'pointerup',
          'pointercancel',
          'gotpointercapture',
          'lostpointercapture',
          'touchstart',
          'touchmove',
          'touchend',
          'touchcancel'
        ]) {
          document.addEventListener(
            type,
            (event) => {
              const record = {
                type,
                target: event.target?.className,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                clientX: event.clientX,
                clientY: event.clientY,
                buttons: event.buttons,
                changedTouches: Array.from(
                  event.changedTouches ?? [],
                  (touch) => ({
                    identifier: touch.identifier,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                  })
                ),
                trusted: event.isTrusted,
                cancelable: event.cancelable,
                prevented: event.defaultPrevented
              }
              window.touchTrace.push(record)
              queueMicrotask(() => {
                record.prevented = event.defaultPrevented
              })
            },
            true
          )
        }
      })
      const handles = page.locator('.hamster-reader__engine-handle')
      const handle = handles.nth(end ? 1 : 0)
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      assert.equal(
        await handles.count(),
        0,
        'native gesture still owns selection; managed handles cannot be pressed'
      )
      assert.equal(
        await page.evaluate(() =>
          document
            .querySelector('foliate-view')
            .renderer.getContents()[0]
            .doc.getSelection()
            .toString()
        ),
        text.slice(8, 18)
      )
      await page.evaluate(() => {
        const doc = document
          .querySelector('foliate-view')
          .renderer.getContents()[0].doc
        const element = doc.querySelector('p')
        element.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            pointerId: 4001,
            pointerType: 'touch',
            clientX: 168,
            clientY: 83
          })
        )
        const end = new Event('touchend', { bubbles: true })
        Object.defineProperties(end, {
          touches: { value: [] },
          changedTouches: {
            value: [{ identifier: 4001, clientX: 168, clientY: 83 }]
          }
        })
        element.dispatchEvent(end)
      })
      await handle.waitFor()
      assert.equal(
        await page.evaluate(
          () =>
            document
              .querySelector('foliate-view')
              .renderer.getContents()[0]
              .doc.getSelection().rangeCount
        ),
        0,
        'native Selection is empty before the first managed handle can receive input'
      )
      // Keep the native capture assertions below separate from setup events.
      await page.evaluate(() => {
        window.touchTrace = []
      })
      if (saved) {
        await page.evaluate(() =>
          window.readerRegression.selection.current.confirm()
        )
        await page.waitForFunction(
          () => window.readerRegression.state.ranges.length === 1
        )
      }
      // Saving activates/restores against the live iframe on the next frame.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      const before = await page.evaluate(() =>
        structuredClone(window.readerRegression.state.ranges)
      )
      const lens = page.getByTestId('range-magnifier')
      const label = `${saved ? 'saved' : 'draft'}/${end ? 'end' : 'start'}`
      // Real browser capture must work without stubs. Tap is not a drag proof.
      for (let i = 0; i < 2; i++) {
        const box = await handle.boundingBox()
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2
        )
        assert.equal(
          await lens.isVisible(),
          false,
          `${label}: native tap closes`
        )
      }
      const native = await page.evaluate(() => window.touchTrace)
      assert.equal(
        native.filter((event) => event.type === 'pointerup' && event.trusted)
          .length,
        2
      )
      assert.equal(
        native.filter(
          (event) => event.type === 'gotpointercapture' && event.trusted
        ).length,
        2
      )
      const updatesBefore = await page.evaluate(
        () => window.readerRegression.state.updates
      )
      await page.evaluate(() => {
        const capture = HTMLElement.prototype.setPointerCapture
        // Untrusted pointers are not registered in the browser's pointer table.
        // Leave native mouse/touch capture intact and stub only our synthetic IDs.
        HTMLElement.prototype.setPointerCapture = function (id) {
          if (id < 5000) capture.call(this, id)
        }
      })
      async function gesture({
        offset,
        fallback,
        cancel = false,
        stale = false
      }) {
        const box = await handle.boundingBox()
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const target = await page.evaluate((offset) => {
          const doc = document
            .querySelector('foliate-view')
            .renderer.getContents()[0].doc
          const range = doc.createRange(),
            frame = doc.defaultView.frameElement.getBoundingClientRect()
          range.setStart(doc.querySelector('p').firstChild, offset)
          range.setEnd(doc.querySelector('p').firstChild, offset + 1)
          const box = range.getBoundingClientRect()
          return {
            x: frame.x + box.left + 0.1,
            y: frame.y + box.top + box.height / 2
          }
        }, offset)
        const pointer = (type, point) =>
          handle.dispatchEvent(type, {
            pointerId: 5001,
            pointerType: 'touch',
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: point.x,
            clientY: point.y,
            bubbles: true
          })
        const touch = (type, point, identifier = 17) =>
          handle.evaluate(
            (element, { type, point, identifier }) => {
              // Linux WebKit does not expose a constructible Touch. These events are
              // deliberately untrusted fault injection, separate from native taps.
              const touch = {
                identifier,
                target: element,
                clientX: point.x,
                clientY: point.y
              }
              const touches =
                type === 'touchend' || type === 'touchcancel' ? [] : [touch]
              const event = new Event(type, { bubbles: true, cancelable: true })
              Object.defineProperties(event, {
                changedTouches: { value: [touch] },
                touches: { value: touches },
                targetTouches: { value: touches }
              })
              return element.dispatchEvent(event)
            },
            { type, point, identifier }
          )
        await pointer('pointerdown', start)
        await touch('touchstart', start)
        await page.evaluate(() => new Promise(requestAnimationFrame))
        assert.equal(await lens.isVisible(), true, `${label}: lens starts`)
        assert(
          (
            await lens
              .locator('.hamster-reader__range-magnifier-text')
              .textContent()
          ).length > 0,
          `${label}: repeated start has text`
        )
        if (stale) {
          // No terminal event at all: a fresh down with the same ID replaces it.
          await pointer('pointerdown', start)
          await touch('touchstart', start)
        }
        if (!fallback) await pointer('pointermove', target)
        await touch('touchmove', target)
        assert.equal(await handles.count(), 2)
        assert.equal(await lens.isVisible(), true)
        assert(
          (
            await lens
              .locator('.hamster-reader__range-magnifier-text')
              .textContent()
          ).length > 0
        )
        if (cancel) await touch('touchcancel', target)
        else {
          await touch('touchend', target, 99)
          assert.equal(
            await lens.isVisible(),
            true,
            'unrelated touch cannot close session'
          )
          if (!fallback) await pointer('pointerup', target)
          await touch('touchend', target)
          // A late pointer event from a completed touch must not commit twice.
          await pointer('pointerup', target)
        }
        assert.equal(
          await lens.isVisible(),
          false,
          `${label}: release/cancel closes`
        )
        assert.equal(
          await lens
            .locator('.hamster-reader__range-magnifier-text')
            .textContent(),
          ''
        )
      }
      await gesture({ offset: end ? 22 : 6, fallback: false })
      await gesture({ offset: end ? 26 : 4, fallback: true })
      await gesture({ offset: end ? 28 : 2, fallback: true, stale: true })
      await gesture({ offset: end ? 30 : 0, fallback: true, cancel: true })
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 0.1, box.y + box.height / 2)
      assert.equal(
        await lens.isVisible(),
        false,
        'native mouse never opens a lens'
      )
      await page.mouse.up()
      if (!saved)
        await page.evaluate(() =>
          window.readerRegression.selection.current.confirm()
        )
      const state = await page.evaluate(() =>
        structuredClone(window.readerRegression.state)
      )
      assert.equal(state.ranges.length, 1)
      assert.equal(
        state.ranges[0].text,
        text.slice(end ? 8 : 2, end ? 28 : 18),
        `${label}: source endpoints and cancel restore`
      )
      if (saved) {
        assert.equal(
          state.updates - updatesBefore,
          3,
          `${label}: each edit commits once; cancel never commits`
        )
        assert.equal(state.ranges[0].id, before[0].id)
        assert.deepEqual(state.ranges[0].markerStyle, before[0].markerStyle)
        assert.deepEqual(
          state.ranges[0][end ? 'start' : 'end'],
          before[0][end ? 'start' : 'end']
        )
      }
      await page.evaluate(
        (id) => window.readerRegression.selection.current.scrollToRange(id),
        state.ranges[0].id
      )
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      await handle.waitFor()
      const reopened = await page.evaluate(() => {
        const selection = document
          .querySelector('foliate-view')
          .renderer.getContents()[0]
          .doc.getSelection()
        return { collapsed: selection.isCollapsed, text: selection.toString() }
      })
      // Foliate may create a collapsed focus caret while navigating. It must
      // never reinstall a native text selection with endpoint handles.
      assert.deepEqual(
        reopened,
        { collapsed: true, text: '' },
        'reopening a saved highlight must stay managed'
      )
      const trace = await page.evaluate(() => window.touchTrace)
      assert(
        trace.some((event) => event.type === 'touchmove' && event.prevented),
        'touchmove listener must be non-passive'
      )
      assert(
        trace.some(
          (event) =>
            event.type === 'pointerup' &&
            event.pointerType === 'mouse' &&
            event.trusted
        ),
        'native mouse release arrives'
      )
      report.cases.push({
        label,
        nativeHandoffBeforeHandles: true,
        reopenedNativeTextSelection: false,
        nativeTaps: 2,
        nativeMouse: 1,
        pairedDrag: 1,
        interruptedDrags: 2,
        touchCancel: 1,
        passed: true
      })
      report.events.push({ label, trace })
      console.log(`Passed WebKit touch ${label}`)
      await page.close()
    }
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(report.coverage)
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(output, 'failure.png') })
    await writeFile(
      resolve(output, 'failure-events.json'),
      JSON.stringify(await page.evaluate(() => window.touchTrace), null, 2)
    )
  }
  throw error
} finally {
  await browser?.close()
  await server.close()
}
