import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import {
  assertMagnifierSecurity,
  monitorMagnifierSecurity,
  securityFixture
} from './magnifier-security-fixture.mjs'

const security = process.env.READER_MAGNIFIER_SECURITY === '1'

const repo = resolve(import.meta.dirname, '..')
const output = resolve(
  process.env.READER_BROWSER_OUTPUT ??
    resolve(repo, '../ham103-browser/interactions')
)
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
const report = {
  command: 'node scripts/check-engine-interactions.mjs',
  cases: []
}

async function saved(page, file) {
  return page.evaluate(
    (file) =>
      JSON.parse(
        localStorage.getItem(`hamster-reader-demo:highlights:${file}`)
      ),
    file
  )
}
async function chapter(page, number) {
  await page.waitForFunction(
    () =>
      document.querySelector('foliate-view')?.renderer?.getContents().length > 0
  )
  await page.evaluate(async (number) => {
    const view = document.querySelector('foliate-view')
    await view.renderer.goTo({ index: number - 1 })
  }, number)
  await page.waitForFunction(
    (number) =>
      document.querySelector('foliate-view')?.renderer?.getContents()[0]
        ?.index ===
      number - 1,
    number
  )
}
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}
async function screenshot(page, label, name) {
  await page.screenshot({ path: resolve(output, `${label}-${name}.png`) })
}
async function chooseTool(page, tool) {
  const button = page.getByTestId(`tool-bottom-bar-${tool}`)
  if (!(await button.count()))
    await page.getByTestId('tool-bottom-bar-tool-menu').click()
  await button.click()
}
async function uploadFixture(page, format, fixtureName) {
  const fixturePath = resolve(
    repo,
    `test/compat/fixtures/${format}/${fixtureName}`
  )
  if (format === 'epub') {
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles(
        security
          ? {
              name: fixtureName,
              mimeType: 'application/epub+zip',
              buffer: await securityFixture(fixturePath)
            }
          : fixturePath
      )
    return
  }
  const original = await PDFDocument.load(await readFile(fixturePath))
  const longDocument = await PDFDocument.create()
  for (let index = 0; index < 40; index++) {
    const [copy] = await longDocument.copyPages(original, [index % 2])
    longDocument.addPage(copy)
  }
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: fixtureName,
      mimeType: 'application/pdf',
      buffer: Buffer.from(await longDocument.save())
    })
  await page.getByRole('button', { name: '加载文件', exact: true }).click()
}
async function recyclePdf(page, fixtureName, edited, label, result) {
  const beforeRecycle = await saved(page, fixtureName)
  await page.evaluate(() => {
    window.__oldCanvas = document.querySelector('.pdfViewer .page canvas')
  })
  for (const pageNumber of [6, 12, 18, 24, 30, 36, 40]) {
    const target = page.locator('.pdfViewer .page').nth(pageNumber - 1)
    await target.scrollIntoViewIfNeeded()
    await target.locator('.textLayer span').first().waitFor()
  }
  await page.waitForFunction(
    () =>
      document.querySelector('.pdfViewer .page:last-child canvas')?.width > 0
  )
  await page.waitForFunction(() => !window.__oldCanvas.isConnected)
  await page.locator('.pdfViewer .page').first().scrollIntoViewIfNeeded()
  await page
    .locator('.pdfViewer .page')
    .first()
    .locator('.textLayer span')
    .first()
    .waitFor()
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdfViewer .page canvas')
    if (!canvas?.width) return false
    const data = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3] && data[i] < 180) ink++
    return ink > 50
  })
  await page.locator(`[data-rect-id="${edited.id}"]`).first().waitFor()
  assert.deepEqual(await saved(page, fixtureName), beforeRecycle)
  await screenshot(page, label, 'page-recycled-restored')
  result.checks.push(
    '40-page PDF: first canvas destroyed after scroll to page 40, text/overlays restored on return; stored data unchanged'
  )
}
async function touchSkipHidden(page, mobile, result) {
  if (!mobile) return
  await page.waitForTimeout(200)
  const point = await page.evaluate(() => {
    const doc = document
      .querySelector('foliate-view')
      .renderer.getContents()[0].doc
    const box = doc.defaultView.frameElement.getBoundingClientRect()
    return {
      x: box.x + box.width / 2,
      y: box.y + Math.min(box.height / 2, 300)
    }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point]
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: point.x, y: point.y - 80 }]
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: []
  })
  await page.waitForFunction(
    () =>
      document.querySelector('foliate-view')?.renderer?.getContents()[0]
        ?.index === 2
  )
  await cdp.detach()
  result.checks.push('Chromium touch emulation: swipe skips hidden chapter')
}
async function checkPrependedCover(page, label, result) {
  const name = 'spine-omits-cover.epub'
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(resolve(repo, `test/compat/fixtures/epub/${name}`))
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="文本阅读进度"]')
        ?.getAttribute('aria-valuemax') === '3'
  )
  await page
    .getByTestId('render-mode-select')
    .selectOption('layout', { force: true })
  await page.getByLabel('文本阅读进度').press('Home')
  const cover = page.getByRole('button', { name: '进入正文' })
  await cover.waitFor()
  await page.locator('[data-engine-page="page-1"]').waitFor()
  const box = await cover.boundingBox()
  await chooseTool(page, 'rect-selection')
  await drag(
    page,
    { x: box.x + 30, y: box.y + 100 },
    { x: box.x + 100, y: box.y + 150 }
  )
  await page.getByRole('button', { name: '高亮', exact: true }).click()
  await page.waitForFunction(
    (name) =>
      JSON.parse(localStorage.getItem(`hamster-reader-demo:highlights:${name}`))
        ?.rects.length > 0,
    name
  )
  assert.equal((await saved(page, name)).rects.at(-1).selectionId, 'page-1')
  await screenshot(page, label, 'prepended-cover-rectangle')
  await chooseTool(page, 'text-selection')
  await page.mouse.click(box.x + 50, box.y + 130)
  await page.getByRole('button', { name: '调整矩形下右角' }).waitFor()
  assert(await cover.isVisible())
  await page
    .getByTestId('edge-crop-edit-toggle')
    .evaluate((button) => button.click())
  await page
    .getByRole('button', { name: '隐藏当前页', exact: true })
    .first()
    .click()
  await page.getByText(/当前 第 1 页 已隐藏/).waitFor()
  await page
    .getByTestId('edge-crop-edit-toggle')
    .evaluate((button) => button.click())
  await cover.waitFor({ state: 'detached' })
  result.checks.push(
    'prepended cover: rectangle saves as page-1 and activates; hiding the cover exits it during reading'
  )
}
async function editEndpoint(page, label, end, result) {
  const handle = page.getByRole('button', {
    name: end ? '调整高亮终点' : '调整高亮起点'
  })
  await handle.waitFor()
  const target = await page.evaluate((end) => {
    const doc = document
      .querySelector('foliate-view')
      .renderer.getContents()[0].doc
    const selection = doc.getSelection().getRangeAt(0)
    const range = doc.createRange()
    const node = end ? selection.endContainer : selection.startContainer
    const offset = end ? selection.endOffset - 1 : selection.startOffset + 1
    range.setStart(node, offset)
    range.collapse(true)
    const box = range.getBoundingClientRect()
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    return { x: box.x + frame.x, y: box.y + frame.y + box.height / 2 }
  }, end)
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + 7, box.y + 7)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 6 })
  await page.waitForFunction(() => {
    const lens = document.querySelector('[data-testid=range-magnifier]')
    const canvas = lens?.querySelector('canvas')
    if (!canvas || lens.hidden) return false
    const pixels = canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] && pixels[i] < 180) ink++
    return ink > 10
  })
  await screenshot(page, label, `cross-${end ? 'end' : 'start'}-magnifier`)
  if (security)
    await assertMagnifierSecurity(
      page,
      result,
      `during ${end ? 'end' : 'start'} drag`
    )
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelector('[data-testid=range-magnifier]')?.hidden
  )
}
// eslint-disable-next-line sonarjs/cognitive-complexity -- Keep the acceptance workflow and assertions in execution order.
async function run(mobile, format) {
  if (security && format !== 'epub') return
  const label = `chromium-${mobile ? 'mobile' : 'desktop'}-${format}`
  if (
    process.env.READER_BROWSER_CASE &&
    !label.includes(process.env.READER_BROWSER_CASE)
  )
    return
  const result = { label, passed: false, checks: [], errors: [] }
  report.cases.push(result)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 },
    hasTouch: mobile
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => result.errors.push(error.message))
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()))
      console.log(label, message.type(), message.text())
  })
  const fixtureName =
    format === 'epub' ? 'duplicate-text.epub' : 'two-column.pdf'
  const initial = JSON.parse(
    await readFile(
      resolve(
        repo,
        `test/compat/fixtures/highlights/${format === 'epub' ? 'epub-duplicate-text' : 'pdf-two-column'}.v4.json`
      ),
      'utf8'
    )
  )
  try {
    await page.addInitScript(
      ({ fixtureName, initial }) => {
        if (window.top !== window) return
        localStorage.setItem(
          `hamster-reader-demo:highlights:${fixtureName}`,
          JSON.stringify(initial)
        )
      },
      { fixtureName, initial }
    )
    await page.goto(`${base}/?engines=next`)
    if (security) await monitorMagnifierSecurity(page, result)
    await uploadFixture(page, format, fixtureName)
    await page.locator(`[data-engine=${format}]`).waitFor()
    await page.getByTestId('render-mode-select').selectOption('layout')
    // Exercise the embedded reader at the requested viewport, without the demo's settings sidebar.
    await page.addStyleTag({
      content: '.hamster-demo-sidebar { display: none !important; }'
    })
    if (format === 'epub') await chapter(page, 2)
    else await page.locator('.textLayer span').first().waitFor()
    // The demo sidebar is only setup; all tool gestures below use native browser input.
    await page.getByTestId('virtual-paper-toggle').evaluate((input) => {
      if (input.checked) input.click()
    })
    await screenshot(page, label, 'opened')
    console.log(`${label}: opened`)
    const viewport = await page.locator('[data-engine]').boundingBox()
    result.viewport = viewport
    const pageBox =
      format === 'epub'
        ? await page.locator('.hamster-reader__epub-tools-page').boundingBox()
        : await page.locator('.pdfViewer .page').first().boundingBox()
    const start = {
      x: Math.max(viewport.x + 30, pageBox.x + 70),
      y: Math.max(viewport.y + 100, pageBox.y + 100)
    }
    const end = {
      x: Math.min(viewport.x + viewport.width - 30, start.x + 80),
      y: start.y + 60
    }
    await chooseTool(page, 'rect-selection')
    await drag(page, start, end)
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    await page.waitForFunction(
      ({ fixtureName, count }) =>
        JSON.parse(
          localStorage.getItem(`hamster-reader-demo:highlights:${fixtureName}`)
        ).rects.length === count,
      { fixtureName, count: initial.rects.length + 1 }
    )
    const rectangle = (await saved(page, fixtureName)).rects.at(-1)
    const corner = page.getByRole('button', { name: '调整矩形下右角' })
    const cornerBox = await corner.boundingBox()
    await drag(
      page,
      { x: cornerBox.x + 7, y: cornerBox.y + 7 },
      { x: cornerBox.x + 22, y: cornerBox.y + 22 }
    )
    await page.waitForFunction(
      ({ fixtureName, original }) =>
        JSON.parse(
          localStorage.getItem(`hamster-reader-demo:highlights:${fixtureName}`)
        ).rects.at(-1).rect.width !== original.rect.width,
      { fixtureName, original: rectangle }
    )
    const edited = (await saved(page, fixtureName)).rects.at(-1)
    assert.equal(edited.id, rectangle.id)
    assert.equal(edited.createdAt, rectangle.createdAt)
    await screenshot(page, label, 'rectangle-edit')
    await page.getByTestId('tool-bottom-bar-undo').click()
    assert.deepEqual((await saved(page, fixtureName)).rects.at(-1), rectangle)
    await page.getByTestId('tool-bottom-bar-redo').click()
    assert.deepEqual((await saved(page, fixtureName)).rects.at(-1), edited)
    result.checks.push(
      'rectangle create/confirm/corner edit/undo/redo; stable id and createdAt'
    )
    await chooseTool(page, 'drawing')
    await drag(page, { x: start.x, y: end.y + 40 }, { x: end.x, y: end.y + 70 })
    await page.waitForFunction(
      ({ fixtureName, pageId }) =>
        JSON.parse(
          localStorage.getItem(`hamster-reader-demo:highlights:${fixtureName}`)
        ).paintings?.[pageId]?.strokes.length > 0,
      { fixtureName, pageId: format === 'epub' ? 'page-2' : 'page-1' }
    )
    await screenshot(page, label, 'drawing')
    result.checks.push('painting pointer stroke saved')
    await chooseTool(page, 'text-selection')
    const editedRect = page.locator(`[data-rect-id="${edited.id}"]`).first()
    const editedBox = await editedRect.boundingBox()
    await page.mouse.click(
      editedBox.x + editedBox.width - 10,
      editedBox.y + editedBox.height - 10
    )
    await page.getByRole('button', { name: '调整矩形下右角' }).waitFor()
    result.checks.push('saved rectangle activates from text tool')
    if (format === 'epub') {
      if (security)
        await assertMagnifierSecurity(page, result, 'before magnifier')
      await page
        .locator('[aria-label="Select highlight"]')
        .first()
        .evaluate((button) => button.click())
      await editEndpoint(page, label, false, result)
      let cross = (await saved(page, fixtureName)).ranges[0]
      assert.equal(cross.start.offset, initial.ranges[0].start.offset + 1)
      assert.deepEqual(cross.end, initial.ranges[0].end)
      await chapter(page, 3)
      await editEndpoint(page, label, true, result)
      if (security)
        await assertMagnifierSecurity(page, result, 'after magnifier')
      cross = (await saved(page, fixtureName)).ranges[0]
      assert.equal(cross.end.offset, initial.ranges[0].end.offset - 1)
      assert.equal(cross.start.offset, initial.ranges[0].start.offset + 1)
      assert.equal(cross.id, initial.ranges[0].id)
      assert.equal(cross.createdAt, initial.ranges[0].createdAt)
      result.checks.push(
        'both cross-chapter endpoints edited independently; magnifier contains rendered pixels'
      )
      if (security) {
        assert.equal(result.errors.length, 0, result.errors.join('\n'))
        result.passed = true
        return
      }
      const beforeRecycle = await saved(page, fixtureName)
      await page.evaluate(() => {
        window.__oldChapter = document
          .querySelector('foliate-view')
          .renderer.getContents()[0].doc
      })
      await chapter(page, 4)
      await chapter(page, 2)
      assert(
        await page.evaluate(
          () => !window.__oldChapter.defaultView?.frameElement?.isConnected
        )
      )
      await page
        .locator(
          `.hamster-reader__pdf-rect-annotation[data-rect-id="${edited.id}"]`
        )
        .waitFor()
      assert.deepEqual(await saved(page, fixtureName), beforeRecycle)
      await screenshot(page, label, 'chapter-recycled-restored')
      result.checks.push(
        'chapter iframe released and revisited; rectangles/painting restored; stored annotations unchanged'
      )
    } else {
      await recyclePdf(page, fixtureName, edited, label, result)
    }
    const dragPoint = await page.evaluate((format) => {
      if (format === 'epub') {
        const doc = document
          .querySelector('foliate-view')
          .renderer.getContents()[0].doc
        const paragraph = [...doc.querySelectorAll('p')].find(
          (node) => node.textContent === '重复的段落文本。'
        )
        const rect = paragraph.getBoundingClientRect()
        const frame = doc.defaultView.frameElement.getBoundingClientRect()
        return {
          x: rect.x + frame.x + 10,
          y: rect.y + frame.y + rect.height / 2
        }
      }
      const rect = document
        .querySelector('[data-range-id]')
        .getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }, format)
    await page.mouse.move(dragPoint.x, dragPoint.y)
    await page.mouse.down()
    await page.mouse.move(dragPoint.x + 18, dragPoint.y + 10, { steps: 5 })
    await page.getByTestId('highlight-drag-preview').waitFor()
    await page.mouse.move(3, 400, { steps: 10 })
    await screenshot(page, label, 'highlight-drag-out')
    await page.mouse.up()
    await page
      .getByTestId('highlight-drag-preview')
      .waitFor({ state: 'detached' })
    result.checks.push(
      'highlight drag activates once, preview follows pointer out of reader, clears on release'
    )
    await page
      .getByTestId('edge-crop-edit-toggle')
      .evaluate((button) => button.click())
    const cropLine = page.getByTestId('edge-crop-line-left').first()
    const lineBox = await cropLine.boundingBox()
    await drag(
      page,
      { x: lineBox.x + lineBox.width / 2, y: start.y },
      { x: lineBox.x + 30, y: start.y }
    )
    await page
      .getByRole('button', { name: '应用到当前页', exact: true })
      .first()
      .click()
    await screenshot(page, label, 'crop-edit')
    await page
      .getByTestId('edge-crop-edit-toggle')
      .evaluate((button) => button.click())
    await page
      .getByRole('button', { name: '隐藏当前页', exact: true })
      .first()
      .click()
    await page
      .getByText(/当前 第 .* 页 已隐藏/)
      .first()
      .waitFor()
    await screenshot(page, label, 'hidden-placeholder')
    await page
      .getByTestId('edge-crop-edit-toggle')
      .evaluate((button) => button.click())
    if (format === 'epub') {
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view')?.renderer?.getContents()[0]
            ?.index !== 1
      )
      await chapter(page, 4)
      const frame = page
        .frames()
        .find(
          (frame) =>
            frame !== page.mainFrame() && frame.url().startsWith('blob:')
        )
      await frame.locator('body').hover()
      await page.waitForTimeout(200)
      await page.mouse.wheel(0, -1200)
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view')?.renderer?.getContents()[0]
            ?.index === 2
      )
      await page.waitForTimeout(200)
      const currentFrame = page
        .frames()
        .find(
          (frame) =>
            frame !== page.mainFrame() && frame.url().startsWith('blob:')
        )
      await currentFrame.locator('body').hover()
      await page.mouse.wheel(0, -1200)
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view')?.renderer?.getContents()[0]
            ?.index === 0
      )
      result.checks.push('wheel chapter navigation skips hidden chapter')
      await touchSkipHidden(page, mobile, result)
    } else {
      await page.waitForFunction(
        () =>
          document.querySelector('.pdfViewer .page').style.display === 'none'
      )
    }
    result.checks.push(
      'crop drag/apply; hidden page placeholder during editing; omitted during reading'
    )
    await screenshot(page, label, 'hidden-reading')
    if (format === 'epub') await checkPrependedCover(page, label, result)
    assert.equal(result.errors.length, 0, result.errors.join('\n'))
    result.passed = true
  } catch (error) {
    result.failure = error.stack
    result.debug = await page.evaluate(() => ({
      pdf: document
        .querySelector('[data-testid=pdf-document-viewer]')
        ?.outerHTML.slice(0, 2000),
      lens: [...document.querySelectorAll('[data-testid=range-magnifier]')].map(
        (lens) => ({
          hidden: lens.hidden,
          canvasWidth: lens.querySelector('canvas')?.width
        })
      ),
      frames: [...document.querySelectorAll('iframe')].map((frame) => ({
        class: frame.className,
        width: frame.contentDocument?.body?.getBoundingClientRect().width,
        text: frame.contentDocument?.body?.innerText.slice(0, 300)
      })),
      snapshots: [...document.querySelectorAll('[aria-hidden=true]')]
        .filter((node) => node.style.left === '-100000px')
        .map((node) => ({
          text: node.innerText,
          html: node.innerHTML.slice(0, 500)
        }))
    }))
    await screenshot(page, label, 'failed').catch(() => {})
    console.error(`${label}: ${error.message}`)
  } finally {
    await browser.close()
  }
}

try {
  for (const mobile of [false, true])
    for (const format of ['epub', 'pdf']) await run(mobile, format)
} finally {
  await server.close()
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, null, 2)
  )
}
console.log(
  `Engine interactions: ${report.cases.filter((item) => item.passed).length}/${report.cases.length} passed`
)
if (report.cases.some((item) => !item.passed)) process.exitCode = 1
