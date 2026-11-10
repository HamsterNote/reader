import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'

// Real Reader and selection dependency, synthetic initial Selection and drags.
// Confirmation uses trusted browser taps; OS long press and drag capture still
// require separate input/device validation.
const output = resolve('test-results/pdf-text-release')
await mkdir(output, { recursive: true })
const pdf = await PDFDocument.create()
const sheet = pdf.addPage([600, 800])
const lines = [1, 2].map(
  (i) => `Line ${i} alpha beta gamma delta epsilon zeta.`
)
lines.forEach((line, i) =>
  sheet.drawText(line, { x: 40, y: 700 - i * 40, size: 16 })
)
const bytes = Array.from(await pdf.save())
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
const engine =
  process.env.READER_BROWSER_ENGINE === 'chromium' ? chromium : webkit
let browser, page
const errors = []
const report = {
  coverage:
    'Real Reader/PDF.js/selection dependency; controlled linked-snapshot host and uncontrolled host; synthetic initial Selection and pointer drags; trusted confirmation/deselection/reselection taps; saved paint and both handle boundaries measured within 1 CSS px; OS long press/capture pending device validation',
  browser: engine.name(),
  version: '',
  cases: []
}
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const html = (await (await fetch(base)).text()).replace(
    '/demo/main.tsx',
    '/test/browser/review-regressions.tsx'
  )
  browser = await engine.launch({
    executablePath:
      engine === webkit ? process.env.WEBKIT_EXECUTABLE_PATH : undefined
  })
  report.version = browser.version()
  page = await browser.newPage({
    viewport: { width: 402, height: 874 },
    hasTouch: true,
    isMobile: true
  })
  page.setDefaultTimeout(20000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/release.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/release.html`)
  await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
  await page.waitForFunction(() => window.readerRegression)
  await page.evaluate(() => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.hasPointerCapture = () => false
  })
  for (const [controlled, line] of [
    [true, 0],
    [true, 1],
    [false, 0],
    [false, 1]
  ])
    for (const end of [false, true])
      for (const saved of [false, true])
        for (const cancel of [false, true])
          for (const confirmDuringDrag of !saved && !cancel
            ? [false, true]
            : [false]) {
            let action = cancel ? 'cancel' : 'release'
            if (confirmDuringDrag) action = 'confirm-during-drag'
            const label = `${controlled ? 'controlled' : 'uncontrolled'}/line${line + 1}/${end ? 'end' : 'start'}/${saved ? 'saved' : 'draft'}/${action}`
            console.log(`Checking ${label}`)
            await page.evaluate(
              ({ bytes, relative, controlled }) => {
                window.pdfTextFlow = []
                return window.readerRegression.open(
                  'pdf',
                  bytes,
                  {
                    renderMode: 'text',
                    isPdf: true,
                    selectedTool: 'text-selection',
                    popoverRelative: relative,
                    onLinkedDataChange: (data) => {
                      window.pdfTextData = data
                      window.pdfTextFlow.push({
                        text: data.activeRange?.text,
                        selected: data.selectedRangeId
                      })
                    }
                  },
                  controlled
                )
              },
              { bytes, relative: line === 1, controlled }
            )
            await page.waitForFunction(
              (line) =>
                Array.from(
                  document.querySelectorAll(
                    '.hsn-selection-content [data-text-id]'
                  )
                ).some((el) => el.textContent.startsWith(`Line ${line + 1}`)),
              line
            )
            await page.evaluate((line) => {
              const element = Array.from(
                document.querySelectorAll(
                  '.hsn-selection-content [data-text-id]'
                )
              ).find((el) => el.textContent.startsWith(`Line ${line + 1}`))
              const range = document.createRange()
              range.setStart(element.firstChild, 8)
              range.setEnd(element.firstChild, 18)
              getSelection().removeAllRanges()
              getSelection().addRange(range)
              document.dispatchEvent(new Event('selectionchange'))
            }, line)
            const handles = page.locator('.hamster-reader__engine-handle')
            const handle = handles.nth(end ? 1 : 0)
            await handle.waitFor()
            const confirm = page.getByRole('button', {
              name: '高亮',
              exact: true
            })
            await confirm.waitFor({ state: 'visible' })
            assert.equal(
              await page
                .locator('.hamster-reader__engine-popover')
                .evaluate((el) => getComputedStyle(el).position),
              line === 1 ? 'absolute' : 'fixed',
              `${label}: popover coordinate mode`
            )
            let original = await page.evaluate(
              () => window.pdfTextData.activeRange
            )
            if (saved) {
              await confirm.tap()
              await page.waitForFunction(
                () => window.readerRegression.state.ranges.length === 1
              )
              original = await page.evaluate(
                () => window.readerRegression.state.ranges[0]
              )
            }
            const pointAt = (offset) =>
              page.evaluate(
                ({ line, offset }) => {
                  const node = Array.from(
                    document.querySelectorAll(
                      '.hsn-selection-content [data-text-id]'
                    )
                  ).find((el) =>
                    el.textContent.startsWith(`Line ${line + 1}`)
                  ).firstChild
                  const range = document.createRange()
                  range.setStart(node, offset)
                  range.setEnd(node, offset + 1)
                  const box = range.getBoundingClientRect()
                  return { x: box.x + 0.2, y: box.y + box.height / 2 }
                },
                { line, offset }
              )
            const deselect = async () => {
              const viewport = await page
                .locator('.hamster-reader__pdf-text-viewport')
                .boundingBox()
              await page.touchscreen.tap(
                viewport.x + viewport.width / 2,
                viewport.y + viewport.height - 30
              )
              await handles.first().waitFor({ state: 'detached' })
            }
            const reselect = async () => {
              const point = await pointAt(12)
              await page.touchscreen.tap(point.x, point.y)
              await handles.first().waitFor({ state: 'visible' })
            }
            if (saved) {
              await deselect()
              await reselect()
            }
            const before = await handle.boundingBox()
            const moving = await pointAt(end ? 21 : 5)
            const final = await pointAt(end ? 25 : 3)
            await handle.evaluate(
              (el, point) =>
                el.dispatchEvent(
                  new PointerEvent('pointerdown', {
                    bubbles: true,
                    pointerType: 'touch',
                    pointerId: 71,
                    button: 0,
                    clientX: point.x,
                    clientY: point.y
                  })
                ),
              {
                x: before.x + before.width / 2,
                y: before.y + before.height / 2
              }
            )
            const dispatch = (type, point) =>
              page.evaluate(
                ({ type, point }) => {
                  document.dispatchEvent(
                    new PointerEvent(type, {
                      bubbles: true,
                      pointerType: 'touch',
                      pointerId: 71,
                      clientX: point.x,
                      clientY: point.y
                    })
                  )
                },
                { type, point }
              )
            await dispatch('pointermove', moving)
            await page.evaluate(() => new Promise(requestAnimationFrame))
            const during = await handle.boundingBox()
            assert(Math.abs(during.x - before.x) > 5, `${label}: preview moves`)
            if (!saved) {
              assert.equal(
                await confirm.count(),
                1,
                `${label}: one visible confirm during drag`
              )
              assert(
                await confirm.isVisible(),
                `${label}: confirm visible during drag`
              )
              assert(
                await confirm.isEnabled(),
                `${label}: confirm enabled during drag`
              )
            }
            // The release contains a newer point, without a preceding move/frame.
            if (confirmDuringDrag) await confirm.tap()
            await dispatch(cancel ? 'pointercancel' : 'pointerup', final)
            await page.evaluate(
              () =>
                new Promise((done) =>
                  requestAnimationFrame(() => requestAnimationFrame(done))
                )
            )
            const after = await handle.boundingBox()
            if (!saved && !confirmDuringDrag) {
              assert.equal(
                await confirm.count(),
                1,
                `${label}: one confirm after release`
              )
              assert(
                await confirm.isVisible(),
                `${label}: confirm visible after release`
              )
            }
            assert.equal(
              await page.getByTestId('range-magnifier').isVisible(),
              false,
              `${label}: closes lens`
            )
            const movedStart = confirmDuringDrag ? 5 : 3
            const movedEnd = confirmDuringDrag ? 21 : 25
            const expectedStart = !end && !cancel ? movedStart : 8
            const expectedEnd = end && !cancel ? movedEnd : 18
            const expectedText = lines[line].slice(expectedStart, expectedEnd)
            const range = await page.evaluate(
              (saved) =>
                saved
                  ? window.readerRegression.state.ranges[0]
                  : window.pdfTextData.activeRange,
              saved || confirmDuringDrag
            )
            assert.equal(range.text, expectedText, `${label}: committed text`)
            assert.equal(
              range.start.offset,
              original.start.offset + expectedStart - 8,
              `${label}: committed start`
            )
            assert.equal(
              range.end.offset,
              original.end.offset + expectedEnd - 18,
              `${label}: committed end`
            )
            assert.equal(range.id, original.id, `${label}: identity`)
            if (saved) {
              for (const key of ['createdAt', 'markerStyle', 'selectionStyle'])
                assert.deepEqual(
                  range[key],
                  original[key],
                  `${label}: preserves ${key}`
                )
            }
            assert.equal(
              await page.evaluate(() => window.readerRegression.state.updates),
              saved && !cancel ? 1 : 0,
              `${label}: commits once`
            )
            if (cancel)
              assert(
                Math.abs(after.x - before.x) < 1,
                `${label}: restores original handle`
              )
            else
              assert(
                Math.abs(after.x - (confirmDuringDrag ? moving.x : final.x)) <
                  22,
                `${label}: handle retains final gap`
              )
            // Host rerenders must not revive the dependency's retired draft.
            await page.evaluate(() =>
              window.readerRegression.update({ highlightColor: '#00ff00' })
            )
            if (!saved && !confirmDuringDrag) {
              await confirm.tap()
              await page.evaluate(() =>
                window.readerRegression.selection.current.confirm()
              )
              await page.waitForFunction(
                () => window.readerRegression.state.ranges.length === 1
              )
            }
            const confirmed = await page.evaluate(
              () => window.readerRegression.state.ranges
            )
            assert.equal(confirmed.length, 1, `${label}: one highlight`)
            assert.equal(
              confirmed[0].text,
              expectedText,
              `${label}: persisted text after rerender`
            )
            assert.equal(confirmed[0].start.offset, range.start.offset)
            assert.equal(confirmed[0].end.offset, range.end.offset)
            if (saved) {
              const expectedBox = await page.evaluate(
                ({ line, expectedStart, expectedEnd }) => {
                  const node = Array.from(
                    document.querySelectorAll(
                      '.hsn-selection-content [data-text-id]'
                    )
                  ).find((el) =>
                    el.textContent.startsWith(`Line ${line + 1}`)
                  ).firstChild
                  const range = document.createRange()
                  range.setStart(node, expectedStart)
                  range.setEnd(node, expectedEnd)
                  return range.getBoundingClientRect().toJSON()
                },
                { line, expectedStart, expectedEnd }
              )
              await deselect()
              assert.equal(
                await page
                  .locator('.hamster-reader__pdf-selection-preview')
                  .count(),
                0,
                `${label}: clears managed preview`
              )
              const persisted = await page.evaluate(
                () => window.pdfTextData.items[0]
              )
              assert.equal(
                persisted.text,
                expectedText,
                `${label}: linked snapshot keeps edited text`
              )
              assert.deepEqual(
                persisted.start,
                range.start,
                `${label}: linked snapshot start`
              )
              assert.deepEqual(
                persisted.end,
                range.end,
                `${label}: linked snapshot end`
              )
              const painted = await page
                .locator('.hsn-selection-percent-rect-highlight')
                .boundingBox()
              for (const key of ['x', 'y', 'width', 'height'])
                assert(
                  Math.abs(painted[key] - expectedBox[key]) < 1,
                  `${label}: saved paint ${key} matches text`
                )
              await reselect()
              for (const end of [false, true]) {
                const box = await handles.nth(end ? 1 : 0).boundingBox()
                assert(
                  Math.abs(
                    box.x +
                      box.width / 2 -
                      (end ? expectedBox.right : expectedBox.left)
                  ) < 1,
                  `${label}: exact ${end ? 'end' : 'start'} character boundary`
                )
                assert(
                  Math.abs(
                    box.y +
                      box.height / 2 -
                      (end ? expectedBox.bottom + 10 : expectedBox.top - 10)
                  ) < 1,
                  `${label}: exact handle line`
                )
              }
              const reopened = await handle.boundingBox()
              assert(
                Math.abs(reopened.x - after.x) < 1 &&
                  Math.abs(reopened.y - after.y) < 1,
                `${label}: reselected handle matches released endpoint`
              )
            }
            report.cases.push({
              label,
              confirmVisibleDuringDrag: !saved,
              confirmDuringDrag,
              confirmation: 'trusted browser tap',
              reselection: saved ? 'trusted browser tap' : undefined,
              savedGeometryVerified: saved,
              popoverRelative: line === 1,
              passed: true,
              before,
              during,
              after,
              text: expectedText,
              start: range.start.offset,
              end: range.end.offset
            })
          }
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  await writeFile(
    resolve(output, `${report.browser}.json`),
    JSON.stringify(report, null, 2)
  )
  console.log(
    `Passed ${report.cases.length} PDF Text release/cancel cases in ${report.browser} ${report.version}`
  )
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'failure.png') })
  console.log(
    JSON.stringify(
      await page?.evaluate(() => ({
        flow: window.pdfTextFlow,
        data: window.pdfTextData,
        state: window.readerRegression.state
      })),
      null,
      2
    )
  )
  throw error
} finally {
  await browser?.close()
  await server.close()
}
