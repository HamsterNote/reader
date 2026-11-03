import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import JSZip from 'jszip'
import { PDFDocument, PDFName, PDFString, PDFOperator } from 'pdf-lib'

// Run against `yarn dev`; READER_BROWSER_URL can point at a LAN HTTP preview.
const base = process.env.READER_BROWSER_URL ?? 'http://127.0.0.1:5577'
const output = resolve(
  process.env.READER_BROWSER_OUTPUT ?? 'test-results/web-selection'
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const results = []

async function saved(page, name = 'two-column.pdf') {
  return page.evaluate(
    (name) =>
      JSON.parse(
        localStorage.getItem(`hamster-reader-demo:highlights:${name}`) ??
          '{"ranges":[],"rects":[]}'
      ),
    name
  )
}

function textSpan(scope, index) {
  const spans = scope.locator('.textLayer [data-selection-start-offset]')
  return typeof index === 'number'
    ? spans.nth(index)
    : spans.filter({ hasText: index }).first()
}

async function dragText(page, index, scope = page) {
  const span = textSpan(scope, index)
  await span.scrollIntoViewIfNeeded()
  const box = await span.boundingBox()
  assert(box)
  await page.mouse.move(box.x + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    box.x + Math.min(100, box.width - 2),
    box.y + box.height / 2,
    { steps: 10 }
  )
  await page.mouse.up()
  await page.getByRole('button', { name: '高亮', exact: true }).waitFor()
}

// A small tagged, concatenated-web-print PDF. The heading's native /Dest is
// intentionally stale; the physical heading and retained source URL are valid.
async function printedPdfFixture() {
  const doc = await PDFDocument.create()
  const pages = Array.from({ length: 3 }, () => doc.addPage([600, 800]))
  const link = (page, uri, rect) => {
    const annotation = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: rect,
        Border: [0, 0, 0],
        A: { S: 'URI', URI: PDFString.of(uri) }
      })
    )
    page.node.addAnnot(annotation)
  }
  pages[0].pushOperators(
    PDFOperator.of('BDC', [PDFName.of('P'), doc.context.obj({ MCID: 0 })])
  )
  pages[0].drawText('Tagged PDF text selection remains available.', {
    x: 40,
    y: 740,
    size: 16
  })
  pages[0].drawText('Select this second line after a rectangle.', {
    x: 40,
    y: 700,
    size: 16
  })
  pages[0].drawText('And select a third independent line.', {
    x: 40,
    y: 660,
    size: 16
  })
  pages[0].pushOperators(PDFOperator.of('EMC'))
  pages[0].drawText('Browser Game Theory (TOC)', { x: 40, y: 580, size: 16 })
  link(
    pages[0],
    'https://undefined/part-2.html#browser-game-theory',
    [40, 578, 280, 597]
  )
  pages[1].drawText('Chapter Two', { x: 40, y: 740, size: 16 })
  pages[1].drawText('§', { x: 250, y: 740, size: 16 })
  link(
    pages[1],
    'chrome-extension://example/reader?url=' +
      encodeURIComponent('https://source.example/part-2.html') +
      '#chapter-two',
    [250, 738, 265, 757]
  )
  pages[2].drawText('Browser Game Theory', { x: 40, y: 650, size: 16 })
  pages[2].drawText('§', { x: 250, y: 650, size: 16 })
  pages[2].node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [250, 648, 265, 667],
        Border: [0, 0, 0],
        Dest: [pages[0].ref, PDFName.of('XYZ'), 40, 650, null]
      })
    )
  )
  const buffer = Buffer.from(await doc.save())
  await writeFile(resolve(output, 'printed-toc.pdf'), buffer)
  return {
    name: 'printed-toc.pdf',
    mimeType: 'application/pdf',
    buffer
  }
}

async function printedPdf(file, original = false) {
  const label = original ? 'original-pdf' : 'tagged-pdf'
  const name = original ? file.split('/').at(-1) : file.name
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  const errors = []
  const brokenRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('://undefined'))
      brokenRequests.push(request.url())
  })
  try {
    console.log(`Checking ${label}`)
    await page.goto(base)
    await page.locator('input[type=file]').first().setInputFiles(file)
    await page.getByRole('button', { name: '加载文件', exact: true }).click()
    const sheet = page.locator('.pdfViewer .page').nth(original ? 1 : 0)
    await sheet.waitFor({ timeout: 60000 })
    await sheet.scrollIntoViewIfNeeded()
    await sheet
      .locator('.textLayer [data-selection-start-offset]')
      .first()
      .waitFor()
    const first = original ? 'Modernizing JavaScript' : 0
    await dragText(page, first, sheet)
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    assert.equal((await saved(page, name)).ranges.length, 1)
    const textBox = await textSpan(sheet, first).boundingBox()
    const x = textBox.x + 400,
      y = textBox.y + 100
    await page.getByTestId('tool-bottom-bar-rect-selection').click()
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 100, y + 60, { steps: 10 })
    await page.mouse.up()
    assert.equal(await page.locator('.hsn-selection-popover').count(), 1)
    await sheet
      .locator('.hamster-reader__pdf-highlight-rect')
      .first()
      .waitFor({ state: 'visible' })
    await page.screenshot({ path: resolve(output, `${label}-highlight.png`) })
    await page.screenshot({
      path: resolve(output, `${label}-rectangle-popover.png`)
    })
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    assert.equal((await saved(page, name)).rects.length, 1)
    await page.getByTestId('tool-bottom-bar-text-selection').click()
    await page.mouse.click(x + 30, y + 30)
    await page.getByRole('button', { name: '删除', exact: true }).waitFor()
    await dragText(page, original ? '2009' : 1, sheet)
    assert.equal(await page.locator('.hsn-selection-popover').count(), 1)
    assert.equal(
      await page.getByRole('button', { name: '删除', exact: true }).count(),
      0
    )
    await page.screenshot({ path: resolve(output, `${label}-one-popover.png`) })
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    assert.equal((await saved(page, name)).ranges.length, 2)
    assert.equal((await saved(page, name)).rects.length, 1)

    // Test TOC independently of the preceding live native text selection,
    // which PDF.js intentionally places above annotations while selecting.
    await page.reload()
    await page.locator('input[type=file]').first().setInputFiles(file)
    await page.getByRole('button', { name: '加载文件', exact: true }).click()
    const tocPage = page.locator('.pdfViewer .page').nth(original ? 1 : 0)
    await tocPage.waitFor({ timeout: 60000 })
    await tocPage.scrollIntoViewIfNeeded()
    const target = original ? 45 : 2
    const link = page.locator(
      `.annotationLayer a[href*="${encodeURIComponent(JSON.stringify([target, { name: 'XYZ' }])).slice(0, -3)}"]`
    )
    await link.waitFor({ timeout: 60000 })
    await link.click()
    const destination = page.locator('.pdfViewer .page').nth(target)
    await destination.locator('.textLayer').waitFor()
    await page.waitForFunction((target) => {
      const box = document
        .querySelectorAll('.pdfViewer .page')
        [target].getBoundingClientRect()
      return box.top < innerHeight && box.bottom > 0
    }, target)
    // Tagged headings can contain one span per Chinese glyph; match their
    // marked-content parent as well as ordinary single-span headings.
    const heading = destination
      .locator('.textLayer span')
      .filter({
        hasText: original ? /^浏览器博弈论$/ : /^Browser Game Theory$/
      })
      .first()
    await heading.waitFor()
    // .markedContent uses display:contents, so measure its glyphs without
    // changing the browser's native selection.
    const headingBox = await heading.evaluate((element) => {
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(element)
      const { top, bottom } = range.getBoundingClientRect()
      return { top, bottom }
    })
    assert(
      headingBox.top >= 0 && headingBox.bottom <= 1000,
      'the linked heading must be in view'
    )
    await page.screenshot({ path: resolve(output, `${label}-toc.png`) })
    assert.deepEqual(errors, [])
    assert.deepEqual(brokenRequests, [])
    assert.equal(page.context().pages().length, 1)
    results.push({
      label,
      passed: true,
      ranges: 2,
      rects: 1,
      tocPage: target + 1
    })
  } catch (error) {
    await page.screenshot({ path: resolve(output, `${label}-error.png`) })
    console.error(
      await page.evaluate(() => ({
        selection: getSelection()?.toString(),
        popovers: document.querySelectorAll('.hsn-selection-popover').length
      }))
    )
    throw error
  } finally {
    await page.close()
  }
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

async function pdfAnnotationEditing(file, original = false) {
  const label = original ? 'original-pdf-colors' : 'pdf-colors'
  const name = original ? file.split('/').at(-1) : file.name
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const popup = page.locator('.hsn-selection-popover')
  const dismiss = async (x, y) => {
    await page.mouse.click(x, y)
    await popup.waitFor({ state: 'hidden', timeout: 5000 })
    assert.equal(
      await page.locator('.hamster-reader__engine-handle').count(),
      0
    )
    assert.equal(await page.evaluate(() => getSelection().isCollapsed), true)
  }
  try {
    await page.goto(base)
    await page.locator('input[type=file]').first().setInputFiles(file)
    await page.getByRole('button', { name: '加载文件', exact: true }).click()
    const sheet = page.locator('.pdfViewer .page').nth(original ? 1 : 0)
    await sheet.waitFor({ timeout: 60000 })
    await sheet.scrollIntoViewIfNeeded()
    await sheet
      .locator('.textLayer [data-selection-start-offset]')
      .first()
      .waitFor()
    await page.getByTestId('tool-bottom-bar-color-blue').click()
    await dragText(page, original ? 'Modernizing JavaScript' : 0, sheet)
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    await page.getByRole('button', { name: '删除', exact: true }).waitFor()
    assert.equal(
      await page.getByLabel('Highlight color', { exact: true }).inputValue(),
      '#7d9ec0'
    )
    const text = sheet.locator('.hamster-reader__pdf-highlight-rect').first()
    const textBox = await text.boundingBox()
    const blank = { x: textBox.x + 650, y: textBox.y + 180 }
    await dismiss(blank.x, blank.y)
    const textStyle = await text.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        opacity: style.opacity,
        visibility: style.visibility
      }
    })
    assert.deepEqual(textStyle, {
      background: 'rgba(125, 158, 192, 0.35)',
      opacity: '1',
      visibility: 'visible'
    })
    assert.equal(
      (await saved(page, name)).ranges[0].markerStyle.backgroundColor,
      textStyle.background
    )

    await page.getByTestId('tool-bottom-bar-color-rose').click()
    await page.getByTestId('tool-bottom-bar-rect-selection').click()
    const x = textBox.x + 400,
      y = textBox.y + 100
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 100, y + 60, { steps: 10 })
    await page.mouse.up()
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    const rectangle = sheet.locator('[data-rect-id]').first()
    await rectangle.locator('.hamster-reader__engine-handle').first().waitFor()
    assert.equal(
      await page.getByLabel('Highlight color', { exact: true }).inputValue(),
      '#cf9cab'
    )
    await dismiss(blank.x, blank.y)
    const rectStyle = await rectangle.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        opacity: style.opacity
      }
    })
    assert.deepEqual(rectStyle, {
      background: 'rgba(207, 156, 171, 0.35)',
      border: 'rgba(207, 156, 171, 0.35)',
      opacity: '1'
    })
    assert.equal(
      (await saved(page, name)).rects[0].markerStyle.backgroundColor,
      rectStyle.background
    )
    await page.screenshot({ path: resolve(output, `${label}-deselected.png`) })

    await page.getByTestId('tool-bottom-bar-text-selection').click()
    await page.mouse.click(textBox.x + 20, textBox.y + textBox.height / 2)
    await page.getByRole('button', { name: '删除', exact: true }).waitFor()
    // Clicking another annotation must transfer selection, not dismiss it.
    await page.mouse.click(x + 30, y + 30)
    await rectangle.locator('.hamster-reader__engine-handle').first().waitFor()
    assert.equal(await popup.count(), 1)
    await page.screenshot({
      path: resolve(output, `${label}-rectangle-selected.png`)
    })
    await page.mouse.click(textBox.x + 20, textBox.y + textBox.height / 2)
    await rectangle
      .locator('.hamster-reader__engine-handle')
      .first()
      .waitFor({ state: 'hidden' })
    assert.equal(
      await page.getByLabel('Highlight color', { exact: true }).inputValue(),
      '#7d9ec0'
    )
    assert.equal(await popup.count(), 1)
    await dismiss(blank.x, blank.y)

    // New text must still be selectable after dismissal or a saved rectangle.
    await page.mouse.click(x + 30, y + 30)
    await rectangle.locator('.hamster-reader__engine-handle').first().waitFor()
    await dragText(page, original ? '2009' : 1, sheet)
    assert.equal(await popup.count(), 1)
    assert.equal(
      await page.getByRole('button', { name: '删除', exact: true }).count(),
      0
    )
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    await page.getByRole('button', { name: '删除', exact: true }).waitFor()
    await dismiss(blank.x, blank.y)
    const data = await saved(page, name)
    assert.equal(data.ranges.length, 2)
    assert.equal(
      data.ranges[1].markerStyle.backgroundColor,
      rectStyle.background
    )
    assert.equal(
      data.ranges[0].markerStyle.backgroundColor,
      textStyle.background,
      'switching toolbar color must preserve saved colors'
    )
    assert.equal(data.rects.length, 1)
    await page.screenshot({
      path: resolve(output, `${label}-changed-and-dismissed.png`)
    })
    assert.deepEqual(errors, [])
    results.push({
      label,
      passed: true,
      textStyle,
      rectStyle,
      popoversAfterDismiss: await popup.count()
    })
  } catch (error) {
    await page.screenshot({ path: resolve(output, `${label}-error.png`) })
    console.error(await textStyleSnapshot(page))
    throw error
  } finally {
    await page.close()
  }
}

async function textStyleSnapshot(page) {
  return page
    .locator('.hamster-reader__pdf-highlight-rect')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        background: getComputedStyle(element).backgroundColor,
        opacity: getComputedStyle(element).opacity
      }))
    )
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
    console.log('Checking EPUB navigation')
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
  await printedPdf(await printedPdfFixture())
  await pdfAnnotationEditing(await printedPdfFixture())
  if (process.env.READER_ORIGINAL_PDF) {
    await printedPdf(resolve(process.env.READER_ORIGINAL_PDF), true)
    await pdfAnnotationEditing(resolve(process.env.READER_ORIGINAL_PDF), true)
  }
  await epubNavigation(await tocFixture())
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify({ base, results }, null, 2)
  )
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
