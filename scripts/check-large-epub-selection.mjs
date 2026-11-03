import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const repo = resolve(import.meta.dirname, '..')
const snapshot = (page) =>
  page.locator('#snapshot').evaluate((node) => JSON.parse(node.textContent))

async function setColor(page, color) {
  await page.getByLabel('Highlight color').evaluate((input, color) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set.call(input, color)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, color)
}

async function openBody(page, file) {
  console.log(file.name, 'upload')
  await page.getByLabel('Book', { exact: true }).setInputFiles(file)
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="下一页"]')
    return button && !button.disabled
  })
  console.log(file.name, 'ready')
  await page.getByLabel('文本阅读进度', { exact: true }).press('End')
  await page.waitForFunction(() => {
    const contents = document
      .querySelector('foliate-view')
      ?.renderer?.getContents()[0]
    const frame =
      contents?.doc?.defaultView?.frameElement?.getBoundingClientRect()
    const ready = ['上一页', '下一页'].some((label) => {
      const button = document.querySelector(`[aria-label="${label}"]`)
      return button && !button.disabled
    })
    return (
      contents?.index === 1 && frame?.width > 0 && frame?.height > 0 && ready
    )
  })
  console.log(file.name, 'navigate to chapter')
  await page.evaluate(async () => {
    const view = document.querySelector('foliate-view')
    const section = view.book.sections[1]
    await view.goTo(`${section.id}#nav_point_4`)
    await document.fonts.ready
  })
  await page.waitForFunction(() => {
    const doc = document
      .querySelector('foliate-view')
      ?.renderer?.getContents()[0]?.doc
    const box = doc?.getElementById('nav_point_4')?.getBoundingClientRect()
    return (
      box &&
      box.width > 0 &&
      box.height > 0 &&
      box.x >= 0 &&
      box.x < doc.defaultView.innerWidth
    )
  })
}

// Derive actual viewport caret coordinates, then use native mouse input.
async function points(page, start, end) {
  return page.evaluate(
    ({ start, end }) => {
      const doc = document
        .querySelector('foliate-view')
        .renderer.getContents()[0].doc
      const heading = doc.getElementById('nav_point_4')
      const first = heading.nextElementSibling.firstChild
      const second = heading.nextElementSibling.nextElementSibling.firstChild
      const frame = doc.defaultView.frameElement.getBoundingClientRect()
      const point = ([paragraph, offset]) => {
        const node = paragraph === 0 ? first : second
        const position = offset === 'OS' ? node.data.indexOf('OS') : offset
        const range = doc.createRange()
        range.setStart(node, position)
        range.collapse(true)
        const box = range.getBoundingClientRect()
        return { x: frame.x + box.x, y: frame.y + box.y + box.height / 2 }
      }
      return [point(start), point(end)]
    },
    { start, end }
  )
}

async function select(page, start, end, reverse = false) {
  const positions = await points(page, start, end)
  if (reverse) positions.reverse()
  await page.mouse.move(positions[0].x, positions[0].y)
  await page.mouse.down()
  await page.mouse.move(positions[1].x, positions[1].y, { steps: 10 })
  await page.mouse.up()
  await page.getByRole('toolbar', { name: '选区操作' }).waitFor()
}

async function selectOS(page) {
  const offset = await page.evaluate(() =>
    document
      .querySelector('foliate-view')
      .renderer.getContents()[0]
      .doc.getElementById('nav_point_4')
      .nextElementSibling.firstChild.data.indexOf('OS')
  )
  assert(offset >= 0)
  await select(page, [0, offset], [0, offset + 2])
  return offset
}

async function activate(page, id, point) {
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector('#snapshot').textContent).selected ===
      id,
    id
  )
  await page.getByRole('toolbar', { name: '高亮操作' }).waitFor()
}

async function assertIndexes(page, raw) {
  const result = await page.evaluate(async (raw) => {
    const { legacyPageTextFromChapter } =
      await import('/src/epub/legacyText.ts')
    const { buildSectionTextIndex } =
      await import('/src/epub/sectionTextIndex.ts')
    const legacy = legacyPageTextFromChapter(raw)
    const live = document
      .querySelector('foliate-view')
      .renderer.getContents()[0].doc
    return [
      new DOMParser().parseFromString(raw, 'application/xhtml+xml'),
      live
    ].map((doc) => {
      const index = buildSectionTextIndex(doc, legacy)
      const node =
        doc.getElementById('nav_point_4').nextElementSibling.firstChild
      const offset = node.data.indexOf('OS')
      const range = doc.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 2)
      return {
        healthy: index.healthy,
        legacyLength: legacy.length,
        streamLength: index.streamText.length,
        offsets: index.offsetsFromRange(range)
      }
    })
  }, raw)
  assert(
    result.every((index) => index.healthy),
    JSON.stringify(result)
  )
  assert.deepEqual(result[0], result[1])
  return result[0]
}

async function checkJourney(page, file, raw, screenshot, pageId) {
  await openBody(page, file)
  const index = await assertIndexes(page, raw)
  console.log(file.name, 'index healthy')
  const offset = await selectOS(page)
  assert.deepEqual((await snapshot(page)).ranges, [])
  await page.screenshot({ path: `${screenshot}-draft.png` })
  // Replace the ASCII draft with a reverse, cross-paragraph selection.
  await select(page, [0, offset + 4], [1, 10], true)
  assert.deepEqual((await snapshot(page)).ranges, [])
  await setColor(page, '#00ff00')
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  const first = (await snapshot(page)).ranges[0]
  assert(first.text.length > 2)
  assert.equal(first.markerStyle.backgroundColor, '#00ff00')
  await selectOS(page)
  await setColor(page, '#0000ff')
  assert.deepEqual((await snapshot(page)).ranges[0], first)
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  const second = (await snapshot(page)).ranges[1]
  assert.equal(second.text, 'OS')
  assert.deepEqual(second.start, {
    selectionId: pageId,
    offset: index.offsets.start
  })
  assert.deepEqual(second.end, {
    selectionId: pageId,
    offset: index.offsets.end
  })
  assert.equal(
    (await snapshot(page)).events.filter((event) => event.type === 'add')
      .length,
    2
  )
  const [firstPoint] = await points(page, [1, 5], [1, 5])
  await activate(page, first.id, firstPoint)
  await setColor(page, '#ff0000')
  assert.deepEqual((await snapshot(page)).ranges[1], second)
  const handle = page.getByRole('button', { name: '调整高亮终点' })
  const box = await handle.boundingBox()
  const [end] = await points(page, [1, 18], [1, 18])
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 })
  await page.mouse.up()
  const edited = (await snapshot(page)).ranges[0]
  assert.equal(edited.id, first.id)
  assert.equal(edited.createdAt, first.createdAt)
  assert.deepEqual(edited.start, first.start)
  assert(edited.end.offset > first.end.offset)
  assert.equal(edited.markerStyle.backgroundColor, '#ff0000')
  assert.equal(
    (await snapshot(page)).events.filter((event) => event.type === 'update')
      .length,
    2
  )
  await page.screenshot({ path: `${screenshot}-edited.png` })
  await page.getByRole('button', { name: '删除', exact: true }).click()
  assert.deepEqual((await snapshot(page)).ranges, [second])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.deepEqual((await snapshot(page)).ranges, [edited, second])
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.deepEqual((await snapshot(page)).ranges, [second])
  await page.evaluate(
    (ranges) =>
      sessionStorage.setItem(
        'selection-harness:ranges',
        JSON.stringify(ranges)
      ),
    [second]
  )
  await page.reload()
  await openBody(page, file)
  const [osPoint] = await points(page, [0, offset + 1], [0, offset + 1])
  await activate(page, second.id, osPoint)
  assert.deepEqual((await snapshot(page)).ranges, [second])
  await page.getByRole('button', { name: '删除', exact: true }).click()
  assert.deepEqual((await snapshot(page)).ranges, [])
  return index
}

// Sequential browser journeys deliberately keep setup and cleanup together.
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function runLargeSectionChecks(
  base,
  output,
  userBook = process.env.READER_USER_EPUB
) {
  const books = [
    {
      label: 'large-code-section',
      path: resolve(repo, 'test/compat/fixtures/epub/large-code-section.epub'),
      chapter: 'part0000.xhtml'
    }
  ]
  if (userBook) {
    const manifest = JSON.parse(
      await readFile(
        resolve(repo, 'test/compat/fixtures/epub/user-book-regression.json'),
        'utf8'
      )
    )
    books.push({ label: 'user-book', path: resolve(userBook), ...manifest })
  }
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const book of books) {
      if (
        process.env.READER_LARGE_CASE &&
        process.env.READER_LARGE_CASE !== book.label
      )
        continue
      console.log(book.label, 'starting')
      const buffer = await readFile(book.path)
      const sha256 = createHash('sha256').update(buffer).digest('hex')
      if (book.sha256)
        assert.equal(
          sha256,
          book.sha256,
          'The original-book regression requires the recorded attachment'
        )
      const zip = await JSZip.loadAsync(buffer)
      const raw = await zip.file(book.chapter).async('string')
      for (const controlled of [true, false]) {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 }
        })
        page.setDefaultTimeout(20000)
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        const result = { book: book.label, sha256, controlled, passed: false }
        results.push(result)
        try {
          await page.goto(
            `${base}/demo/selection-harness.html${controlled ? '' : '?uncontrolled'}`
          )
          result.index = await checkJourney(
            page,
            {
              name: `${book.label}.epub`,
              mimeType: 'application/epub+zip',
              buffer
            },
            raw,
            resolve(
              output,
              `${book.label}-${controlled ? 'controlled' : 'internal'}`
            ),
            book.pageId ?? 'page-2'
          )
          if (book.legacyLength)
            assert.equal(result.index.legacyLength, book.legacyLength)
          assert.deepEqual(errors, [])
          result.passed = true
        } catch (error) {
          result.failure = error.stack
          result.errors = errors
          result.snapshot = await snapshot(page)
          await page.screenshot({
            path: resolve(output, `${book.label}-failed.png`)
          })
        } finally {
          await page.close()
        }
      }
    }
  } finally {
    await browser.close()
    await writeFile(
      resolve(output, 'large-epub-report.json'),
      JSON.stringify(results, null, 2)
    )
  }
  console.log(JSON.stringify({ largeEpub: results }, null, 2))
  assert(
    results.length > 0,
    'No large EPUB regression matches the requested filter'
  )
  assert(
    results.every((result) => result.passed),
    'large EPUB selection regression failed'
  )
  return results
}

if (process.argv[1] === import.meta.filename) {
  const output = resolve(
    process.env.READER_BROWSER_OUTPUT ?? '../ham138-browser/large-section'
  )
  await mkdir(output, { recursive: true })
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  try {
    await runLargeSectionChecks(
      `http://127.0.0.1:${server.httpServer.address().port}`,
      output,
      process.argv[2] ??
        process.env.READER_USER_EPUB ??
        resolve(repo, 'ham138-dev-assets/user-book.epub')
    )
  } finally {
    await server.close()
  }
}
