const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const evidenceDir = path.resolve('.omo/evidence/final-f3-manual-qa')
const samplePdf = path.join(evidenceDir, 'manual-selection-sample.pdf')
const resultsPath = path.join(evidenceDir, 'playwright-results.json')

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      '/home/zhangxiao/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const results = {
    url: 'http://127.0.0.1:5578',
    screenshots: [],
    checks: [],
    consoleErrors: [],
    pageErrors: []
  }

  const record = (name, status, details = {}) => {
    results.checks.push({ name, status, ...details })
  }

  const screenshot = async (name) => {
    const fileName = `${String(results.screenshots.length + 1).padStart(2, '0')}-${name}.png`
    const filePath = path.join(evidenceDir, fileName)
    await page.screenshot({ path: filePath, fullPage: true })
    results.screenshots.push(fileName)
  }

  page.on('console', (message) => {
    if (message.type() === 'error') {
      results.consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => results.pageErrors.push(error.message))

  await page.goto(results.url)
  await page.waitForLoadState('networkidle')
  await screenshot('demo-loaded')

  await page.setInputFiles('input[type="file"]', samplePdf)
  await page.getByRole('heading', { name: 'Parsed Document' }).waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await screenshot('loaded-document')
  record('Dev server loads demo and parses sample document', 'pass')

  const selectionPoints = await page.evaluate(() => {
    const parsedSection = [...document.querySelectorAll('section')].find((section) =>
      section.textContent?.includes('Parsed Document')
    )
    const root = parsedSection?.querySelector('.hamster-reader') || parsedSection
    if (!root) return null

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const rects = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      const text = node.textContent?.replace(/\s+/g, ' ').trim() || ''
      if (text.length < 2) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width > 8 && rect.height > 6) {
          rects.push({
            text,
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          })
        }
      }
      range.detach()
    }
    const first = rects[0]
    const last = rects.find((rect) => first && Math.abs(rect.y - first.y) > first.height * 1.2) || rects[rects.length - 1]
    const blankHost = root.getBoundingClientRect()
    return first && last
      ? {
          count: rects.length,
          first,
          last,
          start: { x: first.x + 3, y: first.y + first.height / 2 },
          end: { x: Math.max(last.x + 8, last.right - 3), y: last.y + last.height / 2 },
          extend: { x: Math.max(last.x + 16, last.right + 20), y: last.y + last.height / 2 },
          blank: { x: blankHost.right - 16, y: blankHost.top + 80 }
        }
      : null
  })

  if (!selectionPoints) {
    record('Find selectable rendered text', 'fail')
    await screenshot('no-selectable-text')
    fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`)
    return
  }
  record('Find selectable rendered text', 'pass', { textRects: selectionPoints.count })

  await page.mouse.move(selectionPoints.start.x, selectionPoints.start.y)
  await page.mouse.down()
  await page.mouse.move(selectionPoints.end.x, selectionPoints.end.y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)

  const selectionAfterMouse = await page.evaluate(() => ({
    selectedText: window.getSelection()?.toString() || '',
    pathCount: document.querySelectorAll('.hamster-reader__selection-overlay-path').length,
    svgCount: document.querySelectorAll('.hamster-reader__selection-overlay-svg').length,
    blockCount: document.querySelectorAll('.hamster-reader__selection-overlay-block').length,
    handleCount: document.querySelectorAll('.hamster-reader__selection-handle--default').length,
    pathD: document.querySelector('.hamster-reader__selection-overlay-path')?.getAttribute('d') || ''
  }))
  await screenshot('selection-polygon-overlay')

  record('Mouse multi-line selection creates selected text', selectionAfterMouse.selectedText.length > 0 ? 'pass' : 'fail', {
    selectedLength: selectionAfterMouse.selectedText.length
  })
  record('SVG polygon overlay rendered instead of div blocks', selectionAfterMouse.pathCount === 1 && selectionAfterMouse.svgCount >= 1 && selectionAfterMouse.blockCount === 0 ? 'pass' : 'fail', selectionAfterMouse)
  record('Overlay visually represented as a single merged polygon path', selectionAfterMouse.pathD.includes('M') && selectionAfterMouse.pathD.includes('L') ? 'pass' : 'fail', {
    pathDLength: selectionAfterMouse.pathD.length
  })
  record('Default Android teardrop handles appear at start and end', selectionAfterMouse.handleCount >= 2 ? 'pass' : 'fail', {
    handleCount: selectionAfterMouse.handleCount
  })

  const dragResult = await page.evaluate(() => {
    const endHandle = document.querySelector('.hamster-reader__selection-handle--end')
    const rect = endHandle?.getBoundingClientRect()
    return rect
      ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }
      : null
  })
  if (dragResult) {
    const beforeDragText = selectionAfterMouse.selectedText
    await page.mouse.move(dragResult.x, dragResult.y)
    await page.mouse.down()
    await page.mouse.move(selectionPoints.extend.x, selectionPoints.extend.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    const afterDrag = await page.evaluate(() => ({
      selectedText: window.getSelection()?.toString() || '',
      pathCount: document.querySelectorAll('.hamster-reader__selection-overlay-path').length,
      handleCount: document.querySelectorAll('.hamster-reader__selection-handle--default').length
    }))
    await screenshot('end-handle-drag')
    record('End handle drag rebuilds range and overlay follows', afterDrag.pathCount === 1 && afterDrag.handleCount >= 2 && afterDrag.selectedText.length > 0 ? 'pass' : 'fail', {
      beforeLength: beforeDragText.length,
      afterLength: afterDrag.selectedText.length,
      pathCount: afterDrag.pathCount,
      handleCount: afterDrag.handleCount
    })
  } else {
    record('End handle drag rebuilds range and overlay follows', 'fail', { reason: 'End handle not found' })
    await screenshot('end-handle-missing')
  }

  const touchResult = await page.evaluate(({ extend }) => {
    const endHandle = document.querySelector('.hamster-reader__selection-handle--end')
    const rect = endHandle?.getBoundingClientRect()
    if (!endHandle || !rect) return { dispatched: false, reason: 'End handle not found' }
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const makeEvent = (type, point) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        buttons: type === 'pointerup' ? 0 : 1
      })
    endHandle.dispatchEvent(makeEvent('pointerdown', start))
    document.dispatchEvent(makeEvent('pointermove', extend))
    document.dispatchEvent(makeEvent('pointerup', extend))
    return {
      dispatched: true,
      selectedText: window.getSelection()?.toString() || '',
      pathCount: document.querySelectorAll('.hamster-reader__selection-overlay-path').length,
      handleCount: document.querySelectorAll('.hamster-reader__selection-handle--default').length
    }
  }, { extend: selectionPoints.extend })
  await page.waitForTimeout(500)
  await screenshot('touch-pointer-handle-drag')
  record('Touch pointer simulation dispatches handle drag without breaking overlay', touchResult.dispatched && touchResult.pathCount === 1 && touchResult.handleCount >= 2 ? 'pass' : 'fail', touchResult)

  await page.mouse.click(24, 24)
  await page.waitForTimeout(400)
  const afterOutsideClick = await page.evaluate(() => ({
    selectedText: window.getSelection()?.toString() || '',
    pathCount: document.querySelectorAll('.hamster-reader__selection-overlay-path').length,
    handleCount: document.querySelectorAll('.hamster-reader__selection-handle--default').length
  }))
  await screenshot('outside-click-clears-selection')
  record('Click outside selection clears overlay and handles', afterOutsideClick.selectedText.length === 0 && afterOutsideClick.pathCount === 0 && afterOutsideClick.handleCount === 0 ? 'pass' : 'fail', afterOutsideClick)

  await page.mouse.move(selectionPoints.blank.x, selectionPoints.blank.y)
  await page.mouse.down()
  await page.mouse.move(selectionPoints.blank.x, selectionPoints.blank.y + 140, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const afterBlankDrag = await page.evaluate(() => ({
    selectedText: window.getSelection()?.toString() || '',
    pathCount: document.querySelectorAll('.hamster-reader__selection-overlay-path').length,
    handleCount: document.querySelectorAll('.hamster-reader__selection-handle--default').length
  }))
  await screenshot('blank-margin-drag')
  record('Blank page-margin drag leaves no residual overlay or handles', afterBlankDrag.selectedText.length === 0 && afterBlankDrag.pathCount === 0 && afterBlankDrag.handleCount === 0 ? 'pass' : 'fail', afterBlankDrag)

  const toggleInfo = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('label, button, input')].map((node) => ({
      tag: node.tagName,
      text: node.textContent?.replace(/\s+/g, ' ').trim() || '',
      testId: node.getAttribute('data-testid') || '',
      type: node.getAttribute('type') || ''
    }))
    return candidates.filter((candidate) => /selection|overlay/i.test(`${candidate.text} ${candidate.testId}`))
  })
  await screenshot('selection-overlay-toggle-check')
  record('Demo exposes selectionOverlay-off toggle and native selection fallback', toggleInfo.length > 0 ? 'pass' : 'fail', {
    candidates: toggleInfo,
    reason: toggleInfo.length > 0 ? undefined : 'No selectionOverlay toggle exists in rendered demo'
  })

  record('No console or page errors during QA', results.consoleErrors.length === 0 && results.pageErrors.length === 0 ? 'pass' : 'fail', {
    consoleErrors: results.consoleErrors,
    pageErrors: results.pageErrors
  })

  fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
