import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import JSZip from 'jszip'

// Run against `yarn dev`; READER_BROWSER_URL can point at a LAN HTTP preview.
const base = process.env.READER_BROWSER_URL ?? 'http://127.0.0.1:5577'
const output = resolve(
  process.env.READER_BROWSER_OUTPUT ?? 'test-results/web-selection'
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const results = []

async function saved(page) {
  return page.evaluate(() =>
    JSON.parse(
      localStorage.getItem('hamster-reader-demo:highlights:two-column.pdf') ??
        '{"ranges":[],"rects":[]}'
    )
  )
}

async function dragText(page, index) {
  const span = page
    .locator('.textLayer [data-selection-start-offset]')
    .nth(index)
  const box = await span.boundingBox()
  assert(box)
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.getByRole('button', { name: '高亮', exact: true }).waitFor()
}

async function pdfSelection(withoutUUID) {
  const label = withoutUUID ? 'pdf-without-randomUUID' : 'pdf-desktop'
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  if (withoutUUID)
    await page.addInitScript(() => {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined })
    })
  try {
    await page.goto(base)
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles('test/compat/fixtures/pdf/two-column.pdf')
    await page.getByRole('button', { name: '加载文件', exact: true }).click()
    await page
      .locator('.textLayer [data-selection-start-offset]')
      .first()
      .waitFor()
    await dragText(page, 0)
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    assert.equal(
      (await saved(page)).ranges.length,
      1,
      'text highlight must persist'
    )
    assert(
      await page.locator('[data-range-id]').count(),
      'highlight must render'
    )
    await page.evaluate(() => getSelection().removeAllRanges())
    await page
      .locator('.hamster-reader__pdf-highlight-rect')
      .first()
      .waitFor({ state: 'visible' })
    await page.screenshot({ path: resolve(output, `${label}-highlight.png`) })

    await page.getByTestId('tool-bottom-bar-rect-selection').click()
    const box = await page.locator('.pdfViewer .page').first().boundingBox()
    await page.mouse.move(box.x + 200, box.y + 300)
    await page.mouse.down()
    await page.mouse.move(box.x + 280, box.y + 360, { steps: 6 })
    await page.mouse.up()
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    assert.equal((await saved(page)).rects.length, 1)
    await page.getByTestId('tool-bottom-bar-text-selection').click()
    // Re-select the saved rectangle, then start a new native text selection.
    await page.mouse.click(box.x + 220, box.y + 320)
    await page.getByRole('button', { name: '删除', exact: true }).waitFor()
    await dragText(page, 1)
    assert.equal(
      await page.locator('.hsn-selection-popover').count(),
      1,
      'text selection must dismiss the selected rectangle popup'
    )
    assert.equal(
      await page.getByRole('button', { name: '删除', exact: true }).count(),
      0
    )
    await page.screenshot({ path: resolve(output, `${label}-one-popover.png`) })
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    const highlights = await saved(page)
    assert.equal(highlights.ranges.length, 2)
    assert.equal(new Set(highlights.ranges.map((range) => range.id)).size, 2)
    assert.equal(
      highlights.rects.length,
      1,
      'deselection must retain the rectangle'
    )
    // A new text selection must also stop editing the preceding text highlight.
    await dragText(page, 2)
    assert.equal(await page.locator('.hsn-selection-popover').count(), 1)
    assert.equal(
      await page.getByRole('button', { name: '删除', exact: true }).count(),
      0
    )
    assert.deepEqual(errors, [])
    results.push({
      label,
      passed: true,
      ranges: highlights.ranges.length,
      rects: highlights.rects.length,
      secureContext: await page.evaluate(() => isSecureContext)
    })
  } finally {
    await page.close()
  }
}

async function tocFixture() {
  const zip = await JSZip.loadAsync(
    await readFile('test/compat/fixtures/epub/duplicate-text.epub')
  )
  const first = await zip.file('OPS/chapter1.xhtml').async('string')
  zip.file(
    'OPS/chapter1.xhtml',
    first.replace(
      '</body>',
      `<nav><a href="chapter2.xhtml#${encodeURIComponent('浏览器博弈论')}">浏览器博弈论</a></nav></body>`
    )
  )
  const second = await zip.file('OPS/chapter2.xhtml').async('string')
  zip.file(
    'OPS/chapter2.xhtml',
    second.replace('<h1>', '<h1 id="浏览器博弈论">')
  )
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  await writeFile(resolve(output, 'toc-relative.epub'), buffer)
  return buffer
}

async function epubNavigation(buffer) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  const errors = []
  const externalRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('://undefined'))
      externalRequests.push(request.url())
  })
  try {
    await page.goto(base)
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'toc-relative.epub',
      mimeType: 'application/epub+zip',
      buffer
    })
    await page.locator('foliate-view').waitFor()
    for (const mode of ['layout', 'text']) {
      await page.getByTestId('render-mode-select').selectOption(mode)
      await page.getByTestId('page-browser-toggle').check()
      const outline = page.locator('.hamster-reader__epub-outline')
      await outline.waitFor()
      if (!(await outline.evaluate((details) => details.open)))
        await outline.locator('summary').click()
      await page.getByRole('button', { name: 'Chapter 1', exact: true }).click()
      await page
        .getByRole('button', { name: '关闭页面浏览', exact: true })
        .click()
      await page.waitForFunction(() =>
        document
          .querySelector('foliate-view')
          ?.renderer?.getContents()
          .some(
            ({ doc }) =>
              doc.querySelector('a[href]')?.textContent === '浏览器博弈论'
          )
      )
      const frames = await Promise.all(
        page.frames().map(async (frame) => ({
          frame,
          matches: await frame
            .getByRole('link', { name: '浏览器博弈论' })
            .count()
        }))
      )
      const frame = frames.find((item) => item.matches)?.frame
      assert(frame)
      const link = frame.getByRole('link', { name: '浏览器博弈论' })
      assert(!String(await link.getAttribute('href')).includes('undefined'))
      await link.click()
      // Foliate replaces its iframe on chapter navigation.
      await page.waitForFunction(() =>
        document
          .querySelector('foliate-view')
          ?.renderer?.getContents()
          .some(
            ({ doc }) =>
              doc.querySelector('#浏览器博弈论')?.textContent === '第二章'
          )
      )
      await page.screenshot({ path: resolve(output, `epub-${mode}-toc.png`) })
      results.push({ label: `epub-${mode}-toc`, passed: true })
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(externalRequests, [])
    assert.equal(
      page.context().pages().length,
      1,
      'internal links must not open a tab'
    )
  } finally {
    await page.close()
  }
}

try {
  await pdfSelection(false)
  await pdfSelection(true)
  await epubNavigation(await tocFixture())
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify({ base, results }, null, 2)
  )
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
