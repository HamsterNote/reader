import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'

export async function checkSharedSelectionInteraction({
  browser,
  base,
  output
}) {
  const pdf = await PDFDocument.create()
  const sheet = pdf.addPage([600, 800])
  for (let i = 0; i < 3; i++)
    sheet.drawText(`Line ${i + 1} alpha beta gamma delta epsilon zeta.`, {
      x: 40,
      y: 700 - i * 40,
      size: 16
    })
  const pdfBytes = Array.from(await pdf.save())
  const zip = await JSZip.loadAsync(
    await readFile('test/compat/fixtures/epub/duplicate-text.epub')
  )
  zip.file(
    'OPS/chapter1.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body>${[1, 2, 3].map((i) => `<p>Line ${i} alpha beta gamma delta epsilon zeta.</p>`).join('')}</body></html>`
  )
  zip.file(
    'OPS/package.opf',
    (await zip.file('OPS/package.opf').async('string')).replace(
      '<itemref idref="cover" />',
      ''
    )
  )
  const epubBytes = Array.from(await zip.generateAsync({ type: 'uint8array' }))
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  const rows = []
  let page, cdp
  const errors = []
  const resetInputPage = async () => {
    await cdp?.detach()
    await page?.close()
    page = await browser.newPage({
      viewport: { width: 900, height: 900 },
      hasTouch: true
    })
    page.setDefaultTimeout(20000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/shared-selection.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: html })
    )
    cdp = await page.context().newCDPSession(page)
    await page.goto(`${base}/shared-selection.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
    await page.waitForFunction(() => window.readerRegression)
  }
  const pointer = async (type, phase, p) => {
    if (type === 'touch') {
      await cdp.send('Input.dispatchTouchEvent', {
        type: {
          down: 'touchStart',
          move: 'touchMove',
          up: 'touchEnd',
          cancel: 'touchCancel'
        }[phase],
        touchPoints:
          phase === 'up' || phase === 'cancel'
            ? []
            : [{ id: 1, x: p.x, y: p.y }]
      })
    } else if (type === 'pen') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[
          phase
        ],
        x: p.x,
        y: p.y,
        button: phase === 'move' ? 'none' : 'left',
        buttons: phase === 'up' ? 0 : 1,
        clickCount: phase === 'move' ? 0 : 1,
        pointerType: 'pen'
      })
    } else {
      if (phase === 'down') {
        await page.mouse.move(p.x, p.y)
        await page.mouse.down()
      } else if (phase === 'move') await page.mouse.move(p.x, p.y)
      else await page.mouse.up()
    }
  }
  try {
    for (const surface of process.env.READER_SHARED_SURFACES?.split(',') ?? [
      'pdf-layout',
      'epub',
      'pdf-text'
    ]) {
      for (const input of process.env.READER_SHARED_INPUTS?.split(',') ?? [
        'touch',
        'mouse',
        'pen'
      ]) {
        // CDP can reuse inconsistent pen IDs after touch on an EPUB iframe.
        // Give each input a new target; each case still starts via mouse selection.
        await resetInputPage()
        for (const end of [false, true]) {
          for (const saved of [false, true]) {
            const label = `${surface}/${input}/${end ? 'end' : 'start'}/${saved ? 'saved' : 'draft'}`
            console.log(`Checking shared ${label}`)
            await page.evaluate(
              async ({ surface, bytes }) =>
                window.readerRegression.open(
                  surface === 'epub' ? 'epub' : 'pdf',
                  bytes,
                  {
                    renderMode: surface === 'pdf-text' ? 'text' : 'layout',
                    isPdf: surface !== 'epub',
                    isEpub: surface === 'epub',
                    selectedTool: 'text-selection',
                    highlightColor: '#ff1234'
                  }
                ),
              { surface, bytes: surface === 'epub' ? epubBytes : pdfBytes }
            )
            await page.waitForFunction((surface) => {
              const doc =
                surface === 'epub'
                  ? document
                      .querySelector('foliate-view')
                      ?.renderer?.getContents()[0]?.doc
                  : document
              const selector =
                surface === 'epub'
                  ? 'p'
                  : surface === 'pdf-text'
                    ? '.hsn-selection-content [data-text-id]'
                    : '.textLayer [data-selection-start-offset]'
              return doc
                ?.querySelector(selector)
                ?.textContent?.includes('Line 1')
            }, surface)
            // Initial native selection remains a supported entry point. Its
            // subsequent edits use exactly the production managed handles.
            const geometry = await page.evaluate((surface) => {
              const doc =
                surface === 'epub'
                  ? document
                      .querySelector('foliate-view')
                      .renderer.getContents()[0].doc
                  : document
              const element = doc.querySelector(
                surface === 'epub'
                  ? 'p'
                  : surface === 'pdf-text'
                    ? '.hsn-selection-content [data-text-id]'
                    : '.textLayer [data-selection-start-offset]'
              )
              const node = element.firstChild
              const pointAt = (offset) => {
                const r = doc.createRange()
                r.setStart(node, offset)
                r.setEnd(node, offset + 1)
                const box = r.getBoundingClientRect(),
                  parent = element.getBoundingClientRect()
                const frame =
                  doc.defaultView.frameElement?.getBoundingClientRect()
                return {
                  x:
                    box.left +
                    Math.min(0.4, box.width / 4) +
                    (frame?.left ?? 0),
                  y:
                    (Math.max(box.top, parent.top) +
                      Math.min(box.bottom, parent.bottom)) /
                      2 +
                    (frame?.top ?? 0)
                }
              }
              return {
                start: pointAt(6),
                end: pointAt(21),
                initialStart: pointAt(8),
                initialEnd: pointAt(18)
              }
            }, surface)
            await page.mouse.move(
              geometry.initialStart.x,
              geometry.initialStart.y
            )
            await page.mouse.down()
            await page.mouse.move(
              geometry.initialEnd.x,
              geometry.initialEnd.y,
              { steps: 6 }
            )
            await page.mouse.up()
            const handles = page.locator('.hamster-reader__engine-handle')
            await handles.first().waitFor()
            assert.equal(await handles.count(), 2, label)
            if (saved) {
              await page.evaluate(() =>
                window.readerRegression.selection.current.confirm()
              )
              await page.waitForFunction(
                () => window.readerRegression.state.ranges.length === 1
              )
              // Tool colour differs from the saved target's retained colour.
              await page.evaluate(() =>
                window.readerRegression.update({ highlightColor: '#00ff00' })
              )
            }
            const before = await page.evaluate(() =>
              JSON.parse(JSON.stringify(window.readerRegression.state.ranges))
            )
            const target = geometry[end ? 'end' : 'start']
            const box = await handles.nth(end ? 1 : 0).boundingBox()
            const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
            await pointer(input, 'down', grab)
            await pointer(input, 'move', target)
            await page.evaluate(() => new Promise(requestAnimationFrame))
            const lens = page.getByTestId('range-magnifier')
            assert.equal(await lens.isVisible(), input === 'touch', label)
            assert.equal(await handles.count(), 2, label)
            let tracking = null
            if (input === 'touch') {
              tracking = await lens.evaluate((lens, point) => {
                const text = lens.querySelector(
                  '.hamster-reader__range-magnifier-text'
                )
                window.lensMutations = 0
                window.lensObserver?.disconnect()
                window.lensObserver = new MutationObserver((records) => {
                  window.lensMutations += records.filter(
                    (r) => r.type === 'childList'
                  ).length
                })
                window.lensObserver.observe(text, {
                  subtree: true,
                  childList: true
                })
                const marker = lens.querySelector(
                  '.hamster-reader__range-magnifier-marker'
                )
                const rect = lens.getBoundingClientRect()
                return {
                  left: rect.left,
                  anchor: point.x + (parseFloat(marker.style.left) - 30) / 2,
                  markerHidden: marker.hidden,
                  color: marker.style.backgroundColor,
                  text: text.textContent,
                  unwanted: text.querySelectorAll(
                    'svg, canvas, button, [style*="background-color"], .hsn-selection-overlay'
                  ).length,
                  size: rect.width,
                  distance: point.y - (rect.y + rect.height / 2)
                }
              }, target)
              assert.equal(tracking.size, 60, label)
              assert(Math.abs(Math.abs(tracking.distance) - 38) < 1, label)
              assert.equal(tracking.markerHidden, false, label)
              assert.equal(
                tracking.color,
                surface === 'epub'
                  ? 'rgb(255, 18, 52)'
                  : 'rgba(255, 18, 52, 0.35)',
                label
              )
              assert(tracking.text.length > 0, label)
              assert.equal(tracking.unwanted, 0, label)
            }
            for (const dx of [0.1, 0.2, 0.3]) {
              const point = { x: target.x + dx, y: target.y }
              await pointer(input, 'move', point)
              await page.evaluate(() => new Promise(requestAnimationFrame))
              assert(
                (await handles.nth(0).isVisible()) &&
                  (await handles.nth(1).isVisible()),
                label
              )
              if (tracking) {
                const current = await lens.evaluate(
                  (lens, point) => ({
                    left: lens.getBoundingClientRect().left,
                    anchor:
                      point.x +
                      (parseFloat(
                        lens.querySelector(
                          '.hamster-reader__range-magnifier-marker'
                        ).style.left
                      ) -
                        30) /
                        2,
                    mutations: window.lensMutations
                  }),
                  point
                )
                assert(
                  Math.abs(current.anchor - tracking.anchor) < 0.1,
                  `${label}: character anchor drift`
                )
                assert(
                  Math.abs(current.left - tracking.left - dx) < 0.1,
                  `${label}: finger tracking`
                )
                assert.equal(
                  current.mutations,
                  0,
                  `${label}: selection changed text cache`
                )
              }
            }
            if (tracking && !saved) {
              const beforeColor = await handles.first().boundingBox()
              await page.evaluate(() =>
                window.readerRegression.update({ highlightColor: '#00ff00' })
              )
              const color = await lens
                .locator('.hamster-reader__range-magnifier-marker')
                .evaluate((marker) => marker.style.backgroundColor)
              assert.equal(
                color,
                surface === 'epub' ? 'rgb(0, 255, 0)' : 'rgba(0, 255, 0, 0.35)',
                `${label}: live draft colour`
              )
              assert.deepEqual(
                await handles.first().boundingBox(),
                beforeColor,
                `${label}: colour moved endpoint`
              )
              assert.equal(
                await page.evaluate(() => window.lensMutations),
                0,
                `${label}: colour recopied text`
              )
            }
            await pointer(input, 'up', { x: target.x + 0.3, y: target.y })
            await page.evaluate(() => new Promise(requestAnimationFrame))
            assert.equal(await lens.isVisible(), false, label)
            if (saved) {
              await page.waitForFunction(
                () => window.readerRegression.state.updates === 1
              )
              const after = await page.evaluate(
                () => window.readerRegression.state.ranges
              )
              assert.equal(after.length, 1, label)
              assert.equal(after[0].id, before[0].id, label)
              assert.deepEqual(
                after[0].markerStyle,
                before[0].markerStyle,
                label
              )
              assert.deepEqual(
                after[0][end ? 'start' : 'end'],
                before[0][end ? 'start' : 'end'],
                label
              )
              assert.notEqual(after[0].text, before[0].text, label)
            } else {
              await page.evaluate(() =>
                window.readerRegression.selection.current.confirm()
              )
              await page.waitForFunction(
                () => window.readerRegression.state.ranges.length === 1
              )
            }
            rows.push({
              surface,
              input,
              endpoint: end ? 'end' : 'start',
              target: saved ? 'saved' : 'draft',
              passed: true,
              selectionTextRecopies: tracking ? 0 : null
            })
          }
        }
      }
    }
    assert.deepEqual(errors, [])
    await writeFile(
      resolve(output, 'shared-interaction.json'),
      JSON.stringify(
        {
          rows,
          deviceCoverage:
            'Chromium CDP touch/mouse/pen; physical WebViews pending'
        },
        null,
        2
      )
    )
    return {
      label: 'shared-selection-interaction',
      passed: true,
      combinations: rows.length
    }
  } catch (error) {
    await page.screenshot({ path: resolve(output, 'failure.png') })
    console.log(
      await page.evaluate(() => ({
        text: document.body.innerText.slice(-3000),
        state: window.readerRegression.state,
        handles: document.querySelectorAll('.hamster-reader__engine-handle')
          .length
      }))
    )
    throw error
  } finally {
    await cdp?.detach()
    await page?.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createServer } = await import('vite')
  const { chromium } = await import('playwright')
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  const browser = await chromium.launch()
  const output = resolve('test-results/shared-selection')
  await mkdir(output, { recursive: true })
  try {
    console.log(
      await checkSharedSelectionInteraction({
        browser,
        base: `http://127.0.0.1:${server.httpServer.address().port}`,
        output
      })
    )
  } finally {
    await browser.close()
    await server.close()
  }
}
