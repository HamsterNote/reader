import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import JSZip from 'jszip'

// Real mouse selection -> managed handoff -> trusted keyboard Select All ->
// click the visible default Highlight button. No Selection seeding or API confirm.
const paragraphs = [
  'Alpha beta gamma delta epsilon.',
  'Second paragraph for select all.'
]
const normalize = (text) => text.replace(/\s+/g, '')
const zip = await JSZip.loadAsync(
  await readFile('test/compat/fixtures/epub/duplicate-text.epub')
)
zip.file(
  'OPS/chapter1.xhtml',
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Keyboard</title></head><body>${paragraphs.map((text) => `<p>${text}</p>`).join('')}</body></html>`
)
zip.file(
  'OPS/package.opf',
  (await zip.file('OPS/package.opf').async('string')).replace(
    '<itemref idref="cover" />',
    ''
  )
)
const bytes = Array.from(await zip.generateAsync({ type: 'uint8array' }))
const output = resolve('test-results/epub-keyboard-selection')
await mkdir(output, { recursive: true })
const engine =
  process.env.READER_BROWSER_ENGINE === 'webkit' ? webkit : chromium
const report = {
  browser: engine.name(),
  version: '',
  coverage:
    'Linux browser trusted mouse, Control+A and visible button click; native iOS/WKWebView keyboard validation pending',
  cases: []
}
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser, page
const errors = []
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
  for (const saved of [false, true]) {
    page = await browser.newPage({ viewport: { width: 900, height: 900 } })
    page.setDefaultTimeout(15000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/keyboard.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: html })
    )
    await page.goto(`${base}/keyboard.html`)
    await page.addStyleTag({ content: '.hamster-reader { height: 100%; }' })
    await page.waitForFunction(() => window.readerRegression)
    await page.evaluate(
      (bytes) =>
        window.readerRegression.open('epub', bytes, {
          isEpub: true,
          selectedTool: 'text-selection'
        }),
      bytes
    )
    await page.waitForFunction(() =>
      document
        .querySelector('foliate-view')
        ?.renderer?.getContents()[0]
        ?.doc.querySelector('p')
    )
    const points = await page.evaluate(() => {
      const doc = document
        .querySelector('foliate-view')
        .renderer.getContents()[0].doc
      const node = doc.querySelector('p').firstChild
      const frame = doc.defaultView.frameElement.getBoundingClientRect()
      const at = (offset) => {
        const range = doc.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const box = range.getBoundingClientRect()
        return {
          x: box.left + frame.left + 0.1,
          y: box.top + frame.top + box.height / 2
        }
      }
      return { start: at(0), end: at(10) }
    })
    await page.mouse.move(points.start.x, points.start.y)
    await page.mouse.down()
    await page.mouse.move(points.end.x, points.end.y, { steps: 8 })
    await page.mouse.up()
    const handles = page.locator('.hamster-reader__engine-handle')
    await handles.first().waitFor()
    await page.waitForFunction(
      () =>
        document
          .querySelector('foliate-view')
          .renderer.getContents()[0]
          .doc.getSelection().rangeCount === 0
    )
    const initialText = await page.evaluate(() =>
      window.readerRegression.state.selectionTexts.at(-1)
    )
    assert.equal(initialText, 'Alpha beta')
    const confirm = page.getByRole('button', { name: '高亮', exact: true })
    if (saved) {
      await confirm.click()
      await page.waitForFunction(
        () => window.readerRegression.state.ranges.length === 1
      )
      await handles.first().waitFor()
    }
    const before = await page.evaluate(
      () => window.readerRegression.state.ranges
    )
    await page.evaluate(() => {
      const doc = document
        .querySelector('foliate-view')
        .renderer.getContents()[0].doc
      if (!doc.hasFocus()) throw new Error('EPUB iframe lost keyboard focus')
      window.keyboardTrace = []
      doc.addEventListener('keydown', (event) =>
        window.keyboardTrace.push({
          type: event.type,
          key: event.key,
          ctrl: event.ctrlKey,
          trusted: event.isTrusted
        })
      )
      doc.addEventListener('pointerdown', (event) =>
        window.keyboardTrace.push({
          type: event.type,
          trusted: event.isTrusted
        })
      )
      window.readerRegression.state.selectionTexts = []
    })
    await page.keyboard.press('Control+a')
    // Wait for the same lifecycle gate that a user sees before touching handles.
    await page.waitForFunction(() => {
      const doc = document
        .querySelector('foliate-view')
        .renderer.getContents()[0].doc
      return (
        doc.getSelection().rangeCount === 0 &&
        window.readerRegression.state.selectionTexts.some((text) =>
          text.includes('Second paragraph')
        )
      )
    })
    await handles.first().waitFor()
    await confirm.waitFor({ state: 'visible' })
    assert.equal(await confirm.count(), 1)
    const trace = await page.evaluate(() => window.keyboardTrace)
    assert(
      trace.some(
        (event) =>
          event.type === 'keydown' &&
          event.key.toLowerCase() === 'a' &&
          event.ctrl &&
          event.trusted
      )
    )
    assert(
      !trace.some((event) => event.type === 'pointerdown'),
      'keyboard takes over without iframe pointerdown'
    )
    await confirm.click()
    await page.waitForFunction(
      (count) => window.readerRegression.state.ranges.length === count,
      before.length + 1
    )
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    )
    const ranges = await page.evaluate(
      () => window.readerRegression.state.ranges
    )
    assert.equal(ranges.length, before.length + 1, 'one new highlight')
    const result = ranges.at(-1)
    assert.equal(
      normalize(result.text),
      normalize(paragraphs.join('')),
      'visible confirmation saves keyboard selection, not old managed text'
    )
    assert.equal(result.start.offset, 0)
    if (saved)
      assert.deepEqual(
        ranges[0],
        before[0],
        'existing highlight stays unchanged'
      )
    report.cases.push({
      from: saved ? 'saved' : 'draft',
      initialText,
      savedText: result.text,
      start: result.start,
      end: result.end,
      savedCount: ranges.length,
      trace,
      passed: true
    })
    console.log(
      `Passed ${engine.name()} keyboard takeover from ${saved ? 'saved' : 'draft'}`
    )
    await page.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, `${engine.name()}.json`),
    JSON.stringify(report, null, 2)
  )
} catch (error) {
  await page?.screenshot({
    path: resolve(output, `${engine.name()}-failure.png`)
  })
  const failure = await page?.evaluate(() => ({
    text: window.readerRegression.state.selectionTexts,
    ranges: window.readerRegression.state.ranges,
    trace: window.keyboardTrace,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    outerSelection: getSelection().toString(),
    native: document
      .querySelector('foliate-view')
      ?.renderer?.getContents()[0]
      ?.doc.getSelection()
      .toString()
  }))
  // Some Linux WPE builds deliver trusted keys but do not implement Select
  // All in read-only documents. Compare a plain iframe without Reader so a
  // missing native selection is not mistaken for an engine handoff failure.
  if (engine === webkit && browser) {
    const control = await browser.newPage()
    try {
      await control.setContent(
        '<iframe srcdoc="<p>Plain iframe select all control</p>"></iframe>'
      )
      const frame = control.frames()[1]
      await frame.locator('p').click()
      failure.plainIframe = []
      for (const shortcut of ['Control+a', 'Meta+a']) {
        await control.keyboard.press(shortcut)
        failure.plainIframe.push({
          shortcut,
          ...(await frame.evaluate(() => ({
            text: getSelection().toString(),
            focused: document.hasFocus()
          })))
        })
      }
    } finally {
      await control.close()
    }
  }
  console.log(failure)
  await writeFile(
    resolve(output, `${engine.name()}-failure.json`),
    JSON.stringify({ ...report, passed: false, failure }, null, 2)
  )
  throw error
} finally {
  await browser?.close()
  await server.close()
}
