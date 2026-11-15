import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { PDFDocument } from 'pdf-lib'
import { checkSharedSelectionInteraction } from './check-shared-selection-interaction.mjs'

const output = resolve('test-results/workspace-interactions')
await mkdir(output, { recursive: true })
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser
const rows = []
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  if (!['pdf', 'sidebar', 'race'].includes(process.env.READER_CHECK)) {
    const count = await checkSharedSelectionInteraction({
      browser,
      base,
      output
    })
    console.log('PASS shared selection and magnifier matrix', count)
  }
  if (process.env.READER_CHECK === 'lens') process.exitCode = 0
  else {
    const doc = await PDFDocument.create()
    for (let n = 1; n <= 12; n++) {
      const sheet = doc.addPage([600, 800])
      for (let i = 0; i < 15; i++)
        sheet.drawText(`Page ${n} line ${i} alpha beta gamma delta.`, {
          x: 40,
          y: 740 - i * 40,
          size: 16
        })
    }
    const bytes = Array.from(await doc.save())
    const html = (await (await fetch(base)).text()).replace(
      '/demo/main.tsx',
      '/test/browser/review-regressions.tsx'
    )
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/interaction.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: html })
    )
    await page.goto(`${base}/interaction.html`)
    await page.waitForFunction(() => window.readerRegression)
    await page.addStyleTag({
      content: 'body { margin:0; } .hamster-reader { height:100%; }'
    })
    const seek = async (n) => {
      const track = page.getByRole('slider')
      const b = await track.boundingBox()
      const x = b.x + b.width / 2,
        y =
          b.y +
          Math.max(0.5, Math.min(b.height - 0.5, (b.height * (n - 1)) / 11))
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.up()
    }
    const measurement = (n) =>
      page.evaluate((n) => {
        const root = document.querySelector('.hamster-reader')
        const container = root.querySelector(
          '.hamster-reader__pdf-viewer-container'
        )
        const sheet = root.querySelector(
          `.pdfViewer .page[data-page-number="${n}"]`
        )
        const toolbar = root.querySelector('[data-testid="tool-bottom-bar"]')
        const r = root.getBoundingClientRect(),
          c = container.getBoundingClientRect(),
          p = sheet.getBoundingClientRect(),
          t = toolbar.getBoundingClientRect()
        const croppedTop = p.top + p.height * window.interactionCrop
        const safeTop = r.top + window.interactionTop
        const ideal = container.scrollTop + croppedTop - safeTop
        const clamped = Math.min(
          Math.max(ideal, 0),
          container.scrollHeight - container.clientHeight
        )
        return {
          page: n,
          pageTop: croppedTop,
          safeTop,
          ideal,
          clamped,
          actual: container.scrollTop,
          max: container.scrollHeight - container.clientHeight,
          root: r.toJSON(),
          toolbar: t.toJSON(),
          container: c.toJSON()
        }
      }, n)
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1200, height: 800 },
      { width: 800, height: 1200 }
    ]) {
      await page.setViewportSize(viewport)
      for (const layout of ['single', 'horizontal', 'vertical']) {
        for (const residual of [44, 0]) {
          await page.evaluate(
            async ({ bytes, layout, residual }) => {
              window.interactionTop = residual
              window.interactionCrop = 0
              await window.readerRegression.open('pdf', bytes, {
                containMarginTop: residual,
                showPageBrowser: true,
                ranges: Array.from({ length: 12 }, (_, i) => ({
                  id: `probe-${i + 1}`,
                  text: `Highlight ${i + 1}`,
                  createdAt: i,
                  start: { selectionId: `page-${i + 1}`, offset: 0 },
                  end: { selectionId: `page-${i + 1}`, offset: 4 },
                  rectsBySelectionId: {},
                  overlayRectType: 'percent'
                })),
                bookmarks: [1, 12].map((pageNumber) => ({
                  pageNumber,
                  verticalPercentage: 0
                })),
                onToggleBookmark: () => {},
                layout: {
                  edge: 'bottom',
                  insets: {
                    top: 24,
                    bottom: layout === 'vertical' ? 0 : 34,
                    left: 0,
                    right: 0
                  },
                  headerContentInset: residual
                }
              })
              const host =
                document.querySelector('.hamster-reader').parentElement
              host.style.width = layout === 'horizontal' ? '50vw' : '100vw'
              host.style.height = layout === 'vertical' ? '50vh' : '100vh'
            },
            { bytes, layout, residual }
          )
          await page
            .locator('.pdfViewer .page[data-page-number="12"]')
            .waitFor()
          const panel = page
            .locator('.hamster-reader__page-browser-panel:visible')
            .first()
          await panel.waitFor()
          const sidebar = await page.evaluate(() => {
            const root = document
              .querySelector('.hamster-reader')
              .getBoundingClientRect()
            const panel = document
              .querySelector('.hamster-reader__page-browser-panel')
              .getBoundingClientRect()
            const toolbar = document
              .querySelector('[data-testid="tool-bottom-bar"]')
              .getBoundingClientRect()
            return {
              top: panel.top,
              bottom: panel.bottom,
              safeTop: root.top + window.interactionTop,
              safeBottom: toolbar.top
            }
          })
          assert(
            sidebar.top >= sidebar.safeTop - 1 &&
              sidebar.bottom <= sidebar.safeBottom + 1,
            JSON.stringify(sidebar)
          )
          const pageItems = []
          for (const n of [1, 12]) {
            const item = page.getByTestId(`page-browser-page-${n}`)
            await item.scrollIntoViewIfNeeded()
            const b = await item.boundingBox()
            pageItems.push({ page: n, rect: b })
            assert(
              b.y >= sidebar.safeTop - 1 &&
                b.y + b.height <= sidebar.safeBottom + 1,
              JSON.stringify({ sidebar, b })
            )
          }
          rows.push({
            kind: 'sidebar',
            viewport,
            layout,
            residual,
            items: pageItems,
            ...sidebar
          })
          if (process.env.READER_CHECK === 'sidebar') {
            for (const tab of ['高亮', '书签']) {
              // 用真实指针点击 tab 中心：窄栏下面板右缘会伸到右侧进度条下方，
              // 进度条层级更高时点击会命中进度条而不是 tab。
              const tabButton = page.getByRole('tab', {
                name: tab,
                exact: true
              })
              const tabBox = await tabButton.boundingBox()
              const center = {
                x: tabBox.x + tabBox.width / 2,
                y: tabBox.y + tabBox.height / 2
              }
              const hit = await page.evaluate(
                ({ x, y, tab }) => {
                  const element = document.elementFromPoint(x, y)
                  const owner = element?.closest('[role="tab"]') ?? null
                  return {
                    tag: element?.tagName ?? null,
                    className:
                      typeof element?.className === 'string'
                        ? element.className
                        : null,
                    isRequestedTab: owner?.textContent === tab
                  }
                },
                { ...center, tab }
              )
              assert(
                hit.isRequestedTab,
                JSON.stringify({ tab, center, hit, viewport, layout, residual })
              )
              await page.mouse.click(center.x, center.y)
              assert.equal(
                await tabButton.getAttribute('aria-selected'),
                'true',
                JSON.stringify({ tab, center, hit, viewport, layout, residual })
              )
              const active = page
                .getByRole('tabpanel')
                .filter({ visible: true })
              const frame = await active.boundingBox()
              assert(
                frame.y >= sidebar.safeTop - 1 &&
                  frame.y + frame.height <= sidebar.safeBottom + 1
              )
              const items = []
              for (const n of [1, 12]) {
                const item =
                  tab === '高亮'
                    ? page.getByTestId(`page-browser-highlight-probe-${n}`)
                    : page.getByRole('button', {
                        name: `跳转到书签：第 ${n} 页 · 0%`,
                        exact: true
                      })
                await item.scrollIntoViewIfNeeded()
                const box = await item.boundingBox()
                items.push({ page: n, rect: box })
                assert(
                  box.y >= sidebar.safeTop - 1 &&
                    box.y + box.height <= sidebar.safeBottom + 1,
                  JSON.stringify({ tab, box, sidebar })
                )
              }
              rows.push({
                kind: 'tab',
                tab,
                viewport,
                layout,
                residual,
                clickedAt: center,
                hit,
                frame,
                items,
                ...sidebar
              })
            }
            continue
          }
          await page.evaluate(() =>
            window.readerRegression.update({ showPageBrowser: false })
          )
          if (process.env.READER_CHECK === 'race') {
            await seek(5)
            await seek(8)
            await page.waitForFunction((top) => {
              const c = document.querySelector(
                '.hamster-reader__pdf-viewer-container'
              )
              const p = c
                .querySelector('.page[data-page-number="8"]')
                .getBoundingClientRect()
              const safe =
                document
                  .querySelector('.hamster-reader')
                  .getBoundingClientRect().top + top
              return Math.abs(p.top - safe) <= 1
            }, residual)
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
            )
            const result = await measurement(8)
            assert(
              Math.abs(result.pageTop - result.safeTop) <= 1,
              JSON.stringify(result)
            )
            rows.push({
              kind: 'race',
              requested: [5, 8],
              viewport,
              layout,
              residual,
              ...result
            })
            continue
          }
          for (const crop of [0, 0.1])
            for (const scale of [0.5, 1, 2]) {
              await page.evaluate(
                ({ crop }) => {
                  window.interactionCrop = crop
                  window.readerRegression.update({
                    data: {
                      edgeCrop: {
                        all: { top: crop, bottom: crop, left: 0, right: 0 }
                      }
                    }
                  })
                },
                { crop, scale }
              )
              await page.getByTestId('tool-bottom-bar-layout-zoom').click()
              await page
                .getByRole('menuitem', { name: `${scale * 100}%`, exact: true })
                .click()
              await page.waitForFunction(
                (scale) =>
                  document.querySelector(
                    '[data-testid="tool-bottom-bar-layout-zoom"]'
                  )?.textContent === `${scale * 100}%`,
                scale
              )
              for (const n of [5, 8, 1, 12]) {
                console.log(
                  'SEEK',
                  viewport.width,
                  layout,
                  residual,
                  crop,
                  scale,
                  n
                )
                await seek(n)
                await page
                  .waitForFunction(
                    ({ n, crop, top }) => {
                      const c = document.querySelector(
                        '.hamster-reader__pdf-viewer-container'
                      )
                      const p = c
                        .querySelector(`.page[data-page-number="${n}"]`)
                        .getBoundingClientRect()
                      const safe =
                        document
                          .querySelector('.hamster-reader')
                          .getBoundingClientRect().top + top
                      const ideal = c.scrollTop + p.top + p.height * crop - safe
                      return (
                        Math.abs(
                          c.scrollTop -
                            Math.min(
                              Math.max(ideal, 0),
                              c.scrollHeight - c.clientHeight
                            )
                        ) <= 1
                      )
                    },
                    { n, crop, top: residual },
                    { timeout: 10000 }
                  )
                  .catch(async (error) => {
                    console.log('FAILED GEOMETRY', await measurement(n))
                    await page.screenshot({
                      path: resolve(output, 'failed-progress.png')
                    })
                    throw error
                  })
                const actual = await measurement(n)
                assert(
                  Math.abs(actual.actual - actual.clamped) <= 1,
                  JSON.stringify(actual)
                )
                rows.push({
                  kind: 'progress',
                  viewport,
                  layout,
                  crop,
                  scale,
                  residual,
                  ...actual
                })
                if (n === 5) {
                  await page.evaluate(
                    (crop) =>
                      window.readerRegression.update({
                        data: {
                          edgeCrop: {
                            all: { top: crop, bottom: crop, left: 0, right: 0 }
                          },
                          layoutReadingProgress: {
                            pageNumber: 5,
                            verticalPercentage: 0
                          }
                        }
                      }),
                    crop
                  )
                  await page.waitForFunction(
                    ({ crop, top }) => {
                      const c = document.querySelector(
                        '.hamster-reader__pdf-viewer-container'
                      )
                      const p = c
                        .querySelector('.page[data-page-number="5"]')
                        .getBoundingClientRect()
                      const ideal =
                        c.scrollTop +
                        p.top +
                        p.height * crop -
                        document
                          .querySelector('.hamster-reader')
                          .getBoundingClientRect().top -
                        top
                      return (
                        Math.abs(
                          c.scrollTop -
                            Math.min(
                              Math.max(ideal, 0),
                              c.scrollHeight - c.clientHeight
                            )
                        ) <= 0.6
                      )
                    },
                    { crop, top: residual }
                  )
                  await page.evaluate(
                    () =>
                      new Promise((resolve) =>
                        requestAnimationFrame(() =>
                          requestAnimationFrame(resolve)
                        )
                      )
                  )
                  const restored = await measurement(n)
                  assert(
                    Math.abs(restored.pageTop - actual.pageTop) <= 1,
                    JSON.stringify({ actual, restored })
                  )
                }
              }
            }
          await page.screenshot({
            path: resolve(
              output,
              `pdf-${viewport.width}-${layout}-${residual}.png`
            )
          })
        }
      }
    }
    assert.deepEqual(errors, [])
    await page.close()
    await writeFile(
      resolve(
        output,
        { sidebar: 'sidebar-tabs.json', race: 'rapid-seek.json' }[
          process.env.READER_CHECK
        ] ?? 'pdf-geometry.json'
      ),
      JSON.stringify(rows, null, 2)
    )
    console.log(
      `PASS PDF sidebar ${rows.filter((r) => r.kind === 'sidebar').length}; tabs ${rows.filter((r) => r.kind === 'tab').length}; progress ${rows.filter((r) => r.kind === 'progress').length}; rapid5to8 ${rows.filter((r) => r.kind === 'race').length}; tolerance <= 1 CSS px`
    )
  }
} finally {
  await browser?.close()
  await server.close()
}
