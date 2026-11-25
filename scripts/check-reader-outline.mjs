import assert from 'node:assert/strict'
import { resolve } from 'node:path'

function initialData(hiddenPages = []) {
  return {
    annotations: { version: 5, ranges: [], rects: [], paintings: {} },
    comments: { version: 2, comments: [] },
    readerData: {
      layoutReadingProgress: { pageNumber: 1, verticalPercentage: 0 },
      bookmarks: [{ pageNumber: 1, verticalPercentage: 25 }],
      hiddenPages
    }
  }
}

async function openReader({
  browserType,
  base,
  output,
  label,
  fileName,
  format,
  hiddenPages,
  report,
  run
}) {
  const browser = await browserType.launch({
    headless: true,
    ...(report.offline ? { args: ['--allow-file-access-from-files'] } : {})
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(15000)
  const errors = []
  const networkRequests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) networkRequests.push(request.url())
  })
  if (report.offline) await page.context().setOffline(true)
  try {
    await page.addInitScript(
      ({ fileName, format, publicationUrl, initial }) => {
        const sessionId = `outline-${format}-session`
        const sourceToken = 'outline-secret'
        let saved = { data: initial, progress: null, revision: 0 }
        localStorage.setItem('host-snapshot', JSON.stringify(saved))
        window.__READER_HOST__ = { sessionId, sourceToken }
        const deliver = (type, payload) =>
          window.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                version: 1,
                sessionId,
                requestId: `host-${type}`,
                type,
                payload
              })
            })
          )
        window.ReactNativeWebView = {
          postMessage(raw) {
            const message = JSON.parse(raw)
            if (message.type === 'ready')
              setTimeout(() => {
                deliver('open', {
                  document: {
                    fileId: `outline-${fileName}`,
                    format,
                    fileUrl: publicationUrl
                  }
                })
                deliver('restore', saved)
              }, 0)
            if (message.type === 'change' || message.type === 'progress') {
              saved = { ...saved, ...message.payload }
              localStorage.setItem('host-snapshot', JSON.stringify(saved))
              setTimeout(
                () =>
                  deliver('ack', {
                    requestId: message.requestId,
                    revision: saved.revision
                  }),
                0
              )
            }
          }
        }
      },
      {
        fileName,
        format,
        publicationUrl: new URL(fileName, base).href,
        initial: initialData(hiddenPages)
      }
    )
    await page.goto(base)
    await page.locator(`[data-engine=${format}]`).waitFor()
    if (format === 'pdf') {
      await page
        .locator('.textLayer [data-selection-start-offset]')
        .first()
        .waitFor()
    } else {
      await page.waitForFunction(
        () =>
          document.querySelector('foliate-view')?.renderer?.getContents()
            .length > 0
      )
    }
    await run(page)
    assert.deepEqual(errors, [])
    if (report.offline) assert.deepEqual(networkRequests, [])
  } catch (error) {
    await page
      .screenshot({ path: resolve(output, `${label}-failed.png`) })
      .catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
}

async function openPageBrowser(page) {
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page.getByTestId('page-browser').waitFor({ state: 'visible' })
}

async function closePageBrowser(page) {
  await page.getByRole('button', { name: '关闭页面浏览', exact: true }).click()
}

async function assertDefaultTab(page, name) {
  const tab = page.getByRole('tab', { name, exact: true })
  await tab.waitFor({ state: 'visible' })
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('[role=tab]')].some(
        (tab) =>
          tab.textContent === name &&
          tab.getAttribute('aria-selected') === 'true'
      ),
    name
  )
  assert.equal(await tab.getAttribute('aria-selected'), 'true')
}

async function assertHighlightAndBookmarkTabs(page) {
  await page.getByRole('tab', { name: '高亮', exact: true }).click()
  await page
    .getByText('暂无高亮', { exact: true })
    .waitFor({ state: 'visible' })
  await page.getByRole('tab', { name: '书签', exact: true }).click()
  await page
    .getByRole('button', { name: '跳转到书签：第 1 页 · 25%', exact: true })
    .waitFor({ state: 'visible' })
}

async function checkEpubOutline(context) {
  await openReader({
    ...context,
    label: 'chromium-desktop-epub-outline',
    fileName: 'nested-outline.epub',
    format: 'epub',
    async run(page) {
      await openPageBrowser(page)
      // EPUB has no page previews: 目录 is the only first tab.
      await assertDefaultTab(page, '目录')
      const panel = page.getByTestId('page-browser-outline-panel')
      assert.equal(await panel.getAttribute('hidden'), null)
      assert.equal(
        await page.getByRole('tab', { name: '页面', exact: true }).count(),
        0
      )
      assert.deepEqual(
        await page.getByRole('tab').allTextContents(),
        ['目录', '高亮', '书签']
      )
      assert.equal(
        await page
          .locator(
            '[data-testid=page-browser] > .hamster-reader__page-browser-outline'
          )
          .count(),
        0,
        'outline must not be an independent block above the tabs'
      )
      const outline = page.getByRole('tab', { name: '目录', exact: true })
      const highlights = page.getByRole('tab', { name: '高亮', exact: true })
      assert(
        await outline.evaluate(
          (tab) => tab.parentElement?.getAttribute('role') === 'tablist'
        )
      )
      await outline.focus()
      await outline.press('ArrowRight')
      assert.equal(await highlights.getAttribute('aria-selected'), 'true')
      assert(
        await highlights.evaluate((tab) => tab === document.activeElement)
      )
      await highlights.press('ArrowLeft')
      assert.equal(await outline.getAttribute('aria-selected'), 'true')
      assert(await outline.evaluate((tab) => tab === document.activeElement))
      await panel.waitFor({ state: 'visible' })
      const nested = panel.getByRole('button', {
        name: 'Nested Chapter Three',
        exact: true
      })
      await nested.waitFor({ state: 'visible' })
      assert(
        await nested.evaluate(
          (button) => button.closest('ul')?.parentElement?.tagName === 'LI'
        ),
        'nested chapter must remain in a child list'
      )
      await nested.click()
      await page.waitForFunction(() =>
        document
          .querySelector('foliate-view')
          ?.renderer?.getContents()
          .some(({ doc }) => doc.body.textContent.includes('第三章独有结尾。'))
      )
      await closePageBrowser(page)
      await openPageBrowser(page)
      await assertDefaultTab(page, '目录')
      await assertHighlightAndBookmarkTabs(page)
      await closePageBrowser(page)
    }
  })
}

async function originalPage(page) {
  return page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('host-snapshot')).data.readerData
        .layoutReadingProgress.pageNumber
  )
}

async function waitForPdfPage(page, pageNumber, marker) {
  await page.waitForFunction(
    (pageNumber) =>
      JSON.parse(localStorage.getItem('host-snapshot')).data.readerData
        .layoutReadingProgress?.pageNumber === pageNumber,
    pageNumber
  )
  await page.waitForFunction(
    ({ pageNumber, marker }) =>
      [...document.querySelectorAll('.pdfViewer .page')].some(
        (element) =>
          element.getAttribute('data-page-number') === String(pageNumber) &&
          element.textContent.includes(marker)
      ),
    { pageNumber, marker }
  )
}

async function assertPdfNavigationRejected(page, buttonName, currentPage) {
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  await page.waitForTimeout(150)
  assert.equal(await originalPage(page), currentPage, buttonName)
}

async function checkPdfEmbeddedOutline(context) {
  await openReader({
    ...context,
    label: 'chromium-desktop-pdf-embedded-outline',
    fileName: 'embedded-outline.pdf',
    format: 'pdf',
    hiddenPages: [2],
    async run(page) {
      await openPageBrowser(page)
      await assertDefaultTab(page, '页面')
      await page.getByRole('tab', { name: '目录', exact: true }).click()
      const named = page.getByRole('button', {
        name: 'Named Chapter Three',
        exact: true
      })
      await named.waitFor({ state: 'visible' })
      assert(
        await named.evaluate(
          (button) => button.closest('ul')?.parentElement?.tagName === 'LI'
        )
      )
      assert(
        await page
          .getByRole('button', { name: 'External Chapter', exact: true })
          .isDisabled()
      )

      await named.click()
      await waitForPdfPage(page, 3, 'Named destination page marker')
      await page
        .getByRole('button', { name: 'Explicit Chapter Four', exact: true })
        .click()
      await waitForPdfPage(page, 4, 'Explicit destination page marker')
      await assertPdfNavigationRejected(page, 'Hidden Chapter Two', 4)
      await assertPdfNavigationRejected(page, 'Out Of Range', 4)
      await page
        .getByRole('button', { name: 'Chapter One', exact: true })
        .click()
      await waitForPdfPage(page, 1, 'Outline fixture landing page')

      await closePageBrowser(page)
      await openPageBrowser(page)
      await assertDefaultTab(page, '页面')
      await assertHighlightAndBookmarkTabs(page)
      await closePageBrowser(page)
    }
  })
}

async function checkPdfBodyOnlyOutline(context) {
  await openReader({
    ...context,
    label: 'chromium-desktop-pdf-body-only-outline',
    fileName: 'body-only-outline.pdf',
    format: 'pdf',
    async run(page) {
      await openPageBrowser(page)
      await assertDefaultTab(page, '页面')
      await page.getByRole('tab', { name: '目录', exact: true }).click()
      await page
        .getByText('此 PDF 没有内嵌章节目录，可使用页面导航。', { exact: true })
        .waitFor({ state: 'visible' })
      assert(
        (await page.locator('.pdfViewer').innerText()).includes(
          'Printed contents only'
        )
      )
      await assertHighlightAndBookmarkTabs(page)
      await page.getByRole('tab', { name: '页面', exact: true }).click()
      await page
        .getByTestId('page-browser-page-1')
        .waitFor({ state: 'visible' })
      await closePageBrowser(page)
    }
  })
}

export async function runReaderOutlineCases(context) {
  for (const [label, check] of [
    ['chromium-desktop-epub-outline', checkEpubOutline],
    ['chromium-desktop-pdf-embedded-outline', checkPdfEmbeddedOutline],
    ['chromium-desktop-pdf-body-only-outline', checkPdfBodyOnlyOutline]
  ]) {
    if (
      process.env.READER_BROWSER_CASE &&
      !label.includes(process.env.READER_BROWSER_CASE)
    )
      continue
    const result = { label, passed: false }
    context.report.cases.push(result)
    try {
      await check(context)
      result.passed = true
      console.log(`${label}: outline passed`)
    } catch (error) {
      result.failure = error.stack
      console.error(`${label}: ${error.message}`)
    }
  }
}
