import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'

const engine =
  process.env.READER_BROWSER_ENGINE === 'chromium' ? chromium : webkit
const output = resolve('test-results/pdf-text-cross-line')
await mkdir(output, { recursive: true })
const pdf = await PDFDocument.create()
const sheet = pdf.addPage([600, 800])
const lines = [1, 2, 3, 4].map(
  (i) => `Line ${i} alpha beta gamma delta epsilon zeta.`
)
lines.forEach((line, i) =>
  sheet.drawText(line, { x: 40, y: 700 - i * 40, size: 16 })
)
const bytes = Array.from(await pdf.save())
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser, page
const errors = []
const report = {
  browser: engine.name(),
  coverage:
    'Real controlled Reader/PDF.js; synthetic initial selection and pointer drags; actual popover text deliberately positioned over third/fourth-line character targets; trusted menu confirmation and deselection/reselection taps. OS touch remains device validation.',
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
  page = await browser.newPage({
    viewport: { width: 402, height: 874 },
    hasTouch: true,
    isMobile: true
  })
  page.setDefaultTimeout(20000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/cross-line.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  )
  await page.goto(`${base}/cross-line.html`)
  await page.addStyleTag({
    content:
      '.hamster-reader { height: 100%; } .hamster-reader-popover { animation: none !important; }'
  })
  await page.waitForFunction(() => window.readerRegression)
  await page.evaluate(() => {
    HTMLElement.prototype.setPointerCapture = () => {}
    HTMLElement.prototype.hasPointerCapture = () => false
  })
  for (const targetLine of [2, 3])
    for (const relative of [false, true])
      for (const saved of [true, false])
        for (const action of saved
          ? ['release', 'cancel']
          : ['release', 'cancel', 'confirm']) {
          const label = `line2-to-${targetLine + 1}/${relative ? 'relative' : 'fixed'}/${saved ? 'saved' : 'draft'}/${action}`
          console.log(`Checking ${label}`)
          await page.evaluate(
            ({ bytes, relative }) =>
              window.readerRegression.open(
                'pdf',
                bytes,
                {
                  renderMode: 'text',
                  isPdf: true,
                  selectedTool: 'text-selection',
                  popoverRelative: relative,
                  onLinkedDataChange: (data) => {
                    window.pdfTextData = data
                  }
                },
                true
              ),
            { bytes, relative }
          )
          await page.waitForFunction(
            () =>
              document.querySelectorAll('.hsn-selection-content [data-text-id]')
                .length === 4
          )
          await page.evaluate(() => {
            const node = document.querySelectorAll(
              '.hsn-selection-content [data-text-id]'
            )[1].firstChild
            const range = document.createRange()
            range.setStart(node, 8)
            range.setEnd(node, 25)
            getSelection().removeAllRanges()
            getSelection().addRange(range)
            document.dispatchEvent(new Event('selectionchange'))
          })
          const confirm = page.getByRole('button', {
            name: '高亮',
            exact: true
          })
          await confirm.waitFor({ state: 'visible' })
          if (saved) await confirm.tap()
          const original = await page.evaluate(
            (saved) =>
              saved
                ? window.pdfTextData.items[0]
                : window.pdfTextData.activeRange,
            saved
          )
          assert.equal(original.start.offset, 51)
          assert.equal(original.end.offset, 68)
          const handles = page.locator('.hamster-reader__engine-handle')
          const endHandle = handles.nth(1)
          await endHandle.waitFor({ state: 'visible' })
          const target = await page.evaluate((targetLine) => {
            const node = document.querySelectorAll(
              '.hsn-selection-content [data-text-id]'
            )[targetLine].firstChild
            const range = document.createRange()
            range.setStart(node, 25)
            range.setEnd(node, 26)
            const box = range.getBoundingClientRect()
            // Stay below the old endpoint's 40px hit area on WebKit.
            return { x: box.left + 0.2, y: box.top + box.height * 0.8 }
          }, targetLine)
          // Position real menu text over this exact character, including a child
          // which explicitly opts into hit testing. Keep the menu usable throughout.
          const obstruction = await page.evaluate(async (target) => {
            const menu = document.querySelector(
              '.hamster-reader__engine-popover'
            )
            const walker = document.createTreeWalker(menu, NodeFilter.SHOW_TEXT)
            let node
            while (walker.nextNode()) {
              if (walker.currentNode.textContent.includes('背景颜色设置')) {
                node = walker.currentNode
                break
              }
            }
            const text = document.createRange()
            text.setStart(node, 0)
            text.setEnd(node, 1)
            const box = text.getBoundingClientRect()
            const style = getComputedStyle(menu)
            const placement = document.createElement('style')
            placement.id = 'cross-line-menu-placement'
            placement.textContent = `.hamster-reader__engine-popover {
              left: ${parseFloat(style.left) + target.x - box.left - box.width / 2}px !important;
              top: ${parseFloat(style.top) + target.y - box.top - box.height / 2}px !important;
            }`
            document.head.append(placement)
            menu.style.setProperty('pointer-events', 'auto', 'important')
            node.parentElement.style.setProperty(
              'pointer-events',
              'auto',
              'important'
            )
            // WebKit updates composited hit regions after the placement frame.
            await new Promise((done) =>
              requestAnimationFrame(() => requestAnimationFrame(done))
            )
            const hit = document.elementFromPoint(target.x, target.y)
            const caretNode =
              document.caretPositionFromPoint?.(target.x, target.y)
                ?.offsetNode ??
              document.caretRangeFromPoint?.(target.x, target.y)?.startContainer
            return {
              rawCaretInMenu: menu.contains(caretNode),
              rawCaretText: caretNode?.textContent,
              text: hit?.textContent,
              hitMenu: menu.contains(hit),
              position: getComputedStyle(menu).position,
              styles: [
                menu.getAttribute('style'),
                node.parentElement.getAttribute('style')
              ]
            }
          }, target)
          assert(
            obstruction.rawCaretInMenu,
            `${label}: native caret query hits menu text ${JSON.stringify(obstruction)}`
          )
          assert(obstruction.hitMenu, `${label}: menu really covers target`)
          assert.equal(obstruction.position, relative ? 'absolute' : 'fixed')
          const before = await endHandle.boundingBox()
          await endHandle.evaluate(
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
            { x: before.x + before.width / 2, y: before.y + before.height / 2 }
          )
          const dispatch = (type) =>
            page.evaluate(
              ({ type, target }) =>
                document.dispatchEvent(
                  new PointerEvent(type, {
                    bubbles: true,
                    pointerType: 'touch',
                    pointerId: 71,
                    clientX: target.x,
                    clientY: target.y
                  })
                ),
              { type, target }
            )
          await dispatch('pointermove')
          await page.evaluate(() => new Promise(requestAnimationFrame))
          const during = await endHandle.boundingBox()
          assert(
            Math.abs(during.y + during.height / 2 - target.y) < 40,
            `${label}: preview follows lower line through menu`
          )
          assert(during.y > before.y + 25, `${label}: preview moved down`)
          const menuRestored = await page.evaluate(() => {
            const menu = document.querySelector(
              '.hamster-reader__engine-popover'
            )
            const button = menu.querySelector('button')
            const box = button.getBoundingClientRect()
            const buttonHit = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2
            )
            return {
              menu: menu.style.pointerEvents,
              priority: menu.style.getPropertyPriority('pointer-events'),
              button: getComputedStyle(button).pointerEvents,
              buttonHit: menu.contains(buttonHit)
            }
          })
          assert(
            menuRestored.menu === 'auto' &&
              menuRestored.priority === 'important' &&
              menuRestored.button === 'auto' &&
              menuRestored.buttonHit,
            `${label}: restores menu hit testing immediately ${JSON.stringify(menuRestored)}`
          )
          if (action === 'confirm') await confirm.tap()
          await dispatch(action === 'cancel' ? 'pointercancel' : 'pointerup')
          await page.evaluate(
            () =>
              new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done))
              )
          )
          const expectedEnd =
            action === 'cancel'
              ? 68
              : lines.slice(0, targetLine).join('').length + 25
          const next = await page.evaluate(
            (saved) =>
              saved
                ? window.pdfTextData.items[0]
                : window.pdfTextData.activeRange,
            saved || action === 'confirm'
          )
          assert.equal(
            next.start.offset,
            51,
            `${label}: preserves fixed endpoint`
          )
          assert.equal(
            next.end.offset,
            expectedEnd,
            `${label}: release keeps lower endpoint`
          )
          assert.equal(next.id, original.id)
          if (saved) {
            for (const key of ['createdAt', 'markerStyle', 'selectionStyle'])
              assert.deepEqual(next[key], original[key])
            assert.equal(
              await page.evaluate(() => window.readerRegression.state.updates),
              action === 'cancel' ? 0 : 1
            )
            assert.deepEqual(
              await page.evaluate(
                () => window.readerRegression.state.ranges[0]
              ),
              next
            )
          } else if (action !== 'confirm') await confirm.tap()
          await page.evaluate(() =>
            document.getElementById('cross-line-menu-placement').remove()
          )
          const viewport = await page
            .locator('.hamster-reader__pdf-text-viewport')
            .boundingBox()
          await page.touchscreen.tap(
            viewport.x + viewport.width / 2,
            viewport.y + viewport.height - 30
          )
          await handles.first().waitFor({ state: 'detached' })
          assert.equal(
            await page
              .locator('.hamster-reader__pdf-selection-preview')
              .count(),
            0
          )
          const point = await page.evaluate(() => {
            const range = document.createRange()
            const node = document.querySelectorAll(
              '.hsn-selection-content [data-text-id]'
            )[1].firstChild
            range.setStart(node, 12)
            range.setEnd(node, 13)
            const box = range.getBoundingClientRect()
            return { x: box.x + 0.2, y: box.y + box.height / 2 }
          })
          await page.touchscreen.tap(point.x, point.y)
          await endHandle.waitFor({ state: 'visible' })
          const reopened = await endHandle.boundingBox()
          const expectedBox = await page.evaluate(
            ({ targetLine, cancel }) => {
              const node = document.querySelectorAll(
                '.hsn-selection-content [data-text-id]'
              )[cancel ? 1 : targetLine].firstChild
              const range = document.createRange()
              const end = 25
              range.setStart(node, end - 1)
              range.setEnd(node, end)
              return range.getBoundingClientRect().toJSON()
            },
            { targetLine, cancel: action === 'cancel' }
          )
          assert(
            Math.abs(reopened.x + reopened.width / 2 - expectedBox.right) < 1,
            `${label}: reselected character`
          )
          assert(
            Math.abs(
              reopened.y + reopened.height / 2 - expectedBox.bottom - 10
            ) < 1,
            `${label}: reselected line`
          )
          report.cases.push({
            label,
            obstruction,
            start: next.start.offset,
            end: next.end.offset,
            passed: true
          })
        }
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, `${engine.name()}.json`),
    JSON.stringify(report, null, 2)
  )
  console.log(
    `Passed ${report.cases.length} cross-line popover cases in ${engine.name()}`
  )
} catch (error) {
  console.error(error, { pageErrors: errors })
  await page?.screenshot({
    path: resolve(output, `${engine.name()}-failure.png`)
  })
  throw error
} finally {
  await browser?.close()
  await server.close()
}
