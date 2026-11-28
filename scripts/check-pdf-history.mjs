import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(repo, '../pdf-history-check')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: repo,
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [repo, await realpath(resolve(repo, 'node_modules'))] }
  }
})
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const report = { steps: [], errors: [] }
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.setDefaultTimeout(20000)
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') report.errors.push(message.text())
})

const persisted = () =>
  page.evaluate(() => {
    const payload = window.__pdfHistory?.last
    const annotations = payload?.annotations
    if (!annotations) return null
    return {
      colors: Object.fromEntries(
        (annotations.ranges ?? []).map((range) => [
          range.id,
          range.markerStyle?.backgroundColor ?? null
        ])
      ),
      rangeCount: annotations.ranges?.length ?? 0,
      rectCount: annotations.rects?.length ?? 0,
      paintingKeys: Object.keys(annotations.paintings ?? {})
    }
  })

async function selectSpan(index, from, to) {
  const points = await page.evaluate(
    ({ index, from, to }) => {
      const spans = [...document.querySelectorAll('.textLayer span')].filter(
        (node) => node.firstChild?.nodeType === 3
      )
      const point = (character) => {
        const range = document.createRange()
        range.setStart(spans[index].firstChild, character)
        range.collapse(true)
        const box = range.getBoundingClientRect()
        return { x: box.x + 1, y: box.y + box.height / 2 }
      }
      return [point(from), point(to)]
    },
    { index, from, to }
  )
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  await page.mouse.move(points[1].x, points[1].y, { steps: 10 })
  await page.mouse.up()
  await page.getByRole('toolbar', { name: '高亮操作' }).waitFor()
}

const setColor = (hex) =>
  page.getByRole('button', { name: `Highlight color ${hex}` }).click()

const waitForColor = (id, hex) =>
  page.waitForFunction(
    ({ id, hex }) =>
      (window.__pdfHistory?.last?.annotations?.ranges?.find(
        (range) => range.id === id
      )?.markerStyle?.backgroundColor ?? null) === hex,
    { id, hex }
  )

try {
  await page.goto(`${base}/test/browser/pdf-history.html`, {
    waitUntil: 'domcontentloaded'
  })
  await page.locator('.textLayer span').first().waitFor()
  const opened = await persisted()
  assert.ok(opened, 'ReaderSurface should publish a persisted snapshot')
  report.steps.push({ opened })

  await selectSpan(0, 0, 5)
  await setColor('#8eba8e')
  await waitForColor('pdf-range-left-column', '#8eba8e')
  const edit1 = await persisted()
  assert.equal(edit1.colors['pdf-range-left-column'], '#8eba8e')
  report.steps.push({ edit1 })

  await page.mouse.click(5, 700)
  await selectSpan(0, 0, 5)
  await setColor('#d1b88a')
  await waitForColor('pdf-range-left-column', '#d1b88a')
  const edit2 = await persisted()
  assert.equal(edit2.colors['pdf-range-left-column'], '#d1b88a')
  assert.deepEqual(edit2.paintingKeys, opened.paintingKeys)
  assert.equal(edit2.rectCount, opened.rectCount)
  report.steps.push({ edit2 })

  const undo = page.getByTestId('tool-bottom-bar-undo')
  const redo = page.getByTestId('tool-bottom-bar-redo')
  assert.equal(await undo.isDisabled(), false, 'undo should be enabled')
  assert.equal(await redo.isDisabled(), true, 'redo should start disabled')

  await undo.click()
  await waitForColor('pdf-range-left-column', '#8eba8e')
  const afterUndo1 = await persisted()
  assert.equal(afterUndo1.colors['pdf-range-left-column'], '#8eba8e')
  report.steps.push({ afterUndo1 })

  await undo.click()
  await waitForColor(
    'pdf-range-left-column',
    opened.colors['pdf-range-left-column']
  )
  const afterUndo2 = await persisted()
  assert.equal(
    afterUndo2.colors['pdf-range-left-column'],
    opened.colors['pdf-range-left-column']
  )
  assert.deepEqual(afterUndo2.paintingKeys, opened.paintingKeys)
  report.steps.push({ afterUndo2 })

  await redo.click()
  await waitForColor('pdf-range-left-column', '#8eba8e')
  const afterRedo1 = await persisted()
  assert.equal(afterRedo1.colors['pdf-range-left-column'], '#8eba8e')
  report.steps.push({ afterRedo1 })

  await redo.click()
  await waitForColor('pdf-range-left-column', '#d1b88a')
  const afterRedo2 = await persisted()
  assert.equal(afterRedo2.colors['pdf-range-left-column'], '#d1b88a')
  assert.deepEqual(afterRedo2, edit2)
  report.steps.push({ afterRedo2 })
  assert.deepEqual(report.errors, [], 'page should log no errors')
  await page.screenshot({ path: resolve(output, 'after.png') })
} catch (error) {
  report.failure = error.message
  await page
    .screenshot({ path: resolve(output, 'failure.png') })
    .catch(() => undefined)
  process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report, null, 2))
}
