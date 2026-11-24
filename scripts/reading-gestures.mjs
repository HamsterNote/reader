import assert from 'node:assert/strict'

export const paperSelector =
  '.hamster-reader__epub-container, .hamster-reader__intermediate-text-spacer'

export async function tapPaper(page, x, y, count = 1) {
  const box = await page.locator(paperSelector).boundingBox()
  assert(box, 'Expected a rendered reading area')
  if (process.env.READER_INPUT_TRACE) {
    for (const f of page.frames())
      await f.evaluate(() => {
        window.__input = []
        if (window.__observingInput) return
        window.__observingInput = true
        for (const type of ['pointerdown', 'pointerup', 'click'])
          document.addEventListener(
            type,
            (e) => {
              const frame = window.frameElement
              window.__input.push({
                type,
                target: e.target.tagName,
                detail: e.detail,
                x: e.clientX,
                y: e.clientY,
                blocked: e.defaultPrevented,
                selected: document.getSelection()?.isCollapsed,
                frame: frame?.getBoundingClientRect().toJSON(),
                localWidth: frame?.clientWidth
              })
            },
            true
          )
      })
    console.log(
      'tap',
      x,
      y,
      await page.evaluate(
        ({ x, y }) => {
          const target = document.elementFromPoint(x, y)
          return {
            hit: target?.outerHTML.slice(0, 240),
            mask: document
              .querySelector('[data-testid="reading-mask"]')
              ?.getBoundingClientRect()
              .toJSON(),
            sidebar: document
              .querySelector('.hamster-reader__page-browser--open')
              ?.getBoundingClientRect()
              .toJSON()
          }
        },
        { x: box.x + x * box.width, y: box.y + y * box.height }
      )
    )
  }
  await page.mouse.click(box.x + x * box.width, box.y + y * box.height, {
    clickCount: count
  })
  if (process.env.READER_INPUT_TRACE)
    for (const f of page.frames())
      console.log(
        'received',
        await f.evaluate(() => window.__input).catch(() => [])
      )
}

async function tapPaperGap(page) {
  const point = await page.locator(paperSelector).evaluate((element) => {
    const chapter = element
      .querySelector('foliate-view')
      ?.renderer?.getContents?.()[0]?.doc
    const frame =
      chapter?.defaultView?.frameElement ?? element.querySelector('iframe')
    const root = chapter?.body ?? frame?.contentDocument?.body ?? element
    const doc = root.ownerDocument
    const frameRect = frame?.getBoundingClientRect()
    const offsetX = frameRect?.left ?? 0
    const offsetY = frameRect?.top ?? 0
    const bounds = element.getBoundingClientRect()
    const x = bounds.left + bounds.width / 2
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const rects = []
    while (walker.nextNode()) {
      const range = doc.createRange()
      range.selectNodeContents(walker.currentNode)
      for (const rect of range.getClientRects())
        rects.push({
          left: rect.left + offsetX,
          right: rect.right + offsetX,
          top: rect.top + offsetY,
          bottom: rect.bottom + offsetY
        })
    }
    for (let y = Math.ceil(bounds.top); y < bounds.bottom; y++)
      if (
        !rects.some(
          (rect) =>
            rect.left <= x &&
            rect.right >= x &&
            rect.top - 1 <= y &&
            rect.bottom + 1 >= y
        )
      )
        return { x, y }
    return null
  })
  assert(point, 'Expected a text gap in the chrome toggle zone')
  await page.mouse.click(point.x, point.y)
}

export async function chrome(page, show) {
  const bar = page.getByTestId('tool-bottom-bar')
  if ((await bar.isVisible()) !== show) {
    await tapPaper(page, 0.5, 0.5)
    await bar.waitFor({ state: show ? 'visible' : 'hidden' })
  }
}

async function chromeInGap(page, show) {
  const bar = page.getByTestId('tool-bottom-bar')
  if ((await bar.isVisible()) !== show) {
    await tapPaperGap(page)
    await bar.waitFor({ state: show ? 'visible' : 'hidden' })
  }
}

const rectKeys = ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']

function assertRectClose(actual, expected, label) {
  assert(actual, `Expected ${label} after the reading action`)
  assert(expected, `Expected ${label} before the reading action`)
  for (const key of rectKeys) {
    if (typeof expected[key] !== 'number') continue
    assert(
      Math.abs(actual[key] - expected[key]) <= 0.5,
      `${label}.${key}: ${actual[key]} != ${expected[key]}`
    )
  }
}

function assertReadingStable(before, after) {
  assert(after, 'Expected the same visible text Range after the reading action')
  for (const key of [
    'text',
    'transform',
    'frameTransform',
    'frameScale',
    'viewerScrollTop',
    'rendererStart',
    'rendererScrollLeft',
    'rendererScrollTop',
    'rendererScrollProp',
    'page',
    'reading'
  ])
    assert.deepEqual(after[key], before[key], `Reading snapshot ${key}`)
  assertRectClose(after.rect, before.rect, 'text Range')
}

async function resetAnchor(page) {
  await page.evaluate(() => {
    delete window.__readingGestureAnchor
  })
}

async function anchorSnapshot(page, readState) {
  const reading = await readState(page)
  const snapshot = await page.locator(paperSelector).evaluate((element) => {
    const renderer = element.querySelector('foliate-view')?.renderer
    const chapter = renderer?.getContents?.()[0]?.doc
    const frame =
      chapter?.defaultView?.frameElement ?? element.querySelector('iframe')
    const root = chapter?.body ?? frame?.contentDocument?.body ?? element
    const doc = root.ownerDocument
    const frameRect = frame?.getBoundingClientRect()
    const offsetX = frameRect?.left ?? 0
    const offsetY = frameRect?.top ?? 0
    const scaleX =
      frame && frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1
    const scaleY =
      frame && frame.offsetHeight > 0
        ? frameRect.height / frame.offsetHeight
        : 1
    const bounds = element.getBoundingClientRect()
    const visibleBounds = frameRect
      ? {
          left: Math.max(bounds.left, frameRect.left),
          right: Math.min(bounds.right, frameRect.right),
          top: Math.max(bounds.top, frameRect.top),
          bottom: Math.min(bounds.bottom, frameRect.bottom)
        }
      : bounds
    const outerRect = (rect) => {
      const left = offsetX + rect.left * scaleX
      const top = offsetY + rect.top * scaleY
      return {
        x: left,
        y: top,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
        top,
        right: offsetX + rect.right * scaleX,
        bottom: offsetY + rect.bottom * scaleY,
        left
      }
    }
    const stored = window.__readingGestureAnchor
    const findInNode = (node) => {
      for (let offset = 0; offset < node.length; offset++) {
        if (!node.data[offset].trim()) continue
        const range = doc.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        const rect = outerRect(range.getBoundingClientRect())
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= visibleBounds.left - 0.5 &&
          rect.right <= visibleBounds.right + 0.5 &&
          rect.top >= visibleBounds.top - 0.5 &&
          rect.bottom <= visibleBounds.bottom + 0.5
        )
          return { node, offset }
      }
      return null
    }
    const findAnchor = () => {
      if (
        stored &&
        (!stored.node.isConnected || stored.node.ownerDocument !== doc)
      )
        return null
      if (stored) return stored
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const anchor = findInNode(walker.currentNode)
        if (anchor) return anchor
      }
      return null
    }
    const anchor = findAnchor()
    if (!anchor) return null
    window.__readingGestureAnchor = anchor
    const range = doc.createRange()
    range.setStart(anchor.node, anchor.offset)
    range.setEnd(anchor.node, anchor.offset + 1)
    const content = element.querySelector('.hsn-selection-content')
    return {
      text: anchor.node.data[anchor.offset],
      rect: outerRect(range.getBoundingClientRect()),
      transform: content
        ? element.ownerDocument.defaultView.getComputedStyle(content).transform
        : 'none',
      frameTransform: frame
        ? frame.ownerDocument.defaultView.getComputedStyle(frame).transform
        : null,
      frameScale: frame ? { x: scaleX, y: scaleY } : null,
      viewerScrollTop:
        element.ownerDocument.querySelector(
          '[data-testid="intermediate-document-text-viewer"]'
        )?.scrollTop ?? element.scrollTop,
      rendererStart:
        renderer && typeof renderer.start === 'number' ? renderer.start : null,
      rendererScrollLeft: renderer ? renderer.scrollLeft : null,
      rendererScrollTop: renderer ? renderer.scrollTop : null,
      rendererScrollProp: renderer?.scrollProp ?? null,
      page: element.ownerDocument.querySelector(
        '[data-testid="reading-page-indicator"]'
      )?.textContent
    }
  })
  return snapshot && { ...snapshot, reading }
}

async function dragPaperFivePixels(page) {
  const paper = page.locator(paperSelector)
  const point = await paper.evaluate((element) => {
    const chapter = element
      .querySelector('foliate-view')
      ?.renderer?.getContents?.()[0]?.doc
    const frame =
      chapter?.defaultView?.frameElement ?? element.querySelector('iframe')
    const root = chapter?.body ?? frame?.contentDocument?.body ?? element
    const doc = root.ownerDocument
    const frameRect = frame?.getBoundingClientRect()
    const offsetX = frameRect?.left ?? 0
    const offsetY = frameRect?.top ?? 0
    const bounds = element.getBoundingClientRect()
    const x = bounds.left + bounds.width * 0.85
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const rects = []
    while (walker.nextNode()) {
      const range = doc.createRange()
      range.selectNodeContents(walker.currentNode)
      for (const rect of range.getClientRects())
        rects.push({
          left: rect.left + offsetX,
          right: rect.right + offsetX,
          top: rect.top + offsetY,
          bottom: rect.bottom + offsetY
        })
    }
    for (
      let y = Math.ceil(bounds.top + bounds.height / 3);
      y < bounds.top + (bounds.height * 2) / 3;
      y++
    ) {
      const overlaps = rects.some(
        (rect) =>
          rect.left <= x &&
          rect.right >= x - 5 &&
          rect.top - 1 <= y &&
          rect.bottom + 1 >= y
      )
      if (!overlaps) return { x, y }
    }
    return null
  })
  assert(point, 'Expected a five-pixel gap in the next-page zone')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x - 5, point.y, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(80)
}

async function readingCapability(page, direction) {
  return page.locator(paperSelector).evaluate((element, name) => {
    const own = element.getAttribute(`data-can-${name}`)
    if (own !== null) return own
    return element.ownerDocument
      .querySelector('[data-testid="reading-page-indicator"]')
      ?.getAttribute(`data-can-${name}`)
  }, direction)
}

export async function shortDragGeometry(page, readState) {
  await page.locator(paperSelector).waitFor({ state: 'visible' })
  assert.equal(
    await readingCapability(page, 'next'),
    'true',
    'Short-drag regression requires an available next page'
  )
  await resetAnchor(page)
  try {
    const initiallyVisible = await page
      .getByTestId('tool-bottom-bar')
      .isVisible()
    await chromeInGap(page, false)
    const before = await anchorSnapshot(page, readState)
    assert(before, 'Expected a visible text Range before a short drag')
    await dragPaperFivePixels(page)
    const hidden = await anchorSnapshot(page, readState)
    assertReadingStable(before, hidden)
    assert.equal(await page.getByTestId('tool-bottom-bar').isVisible(), false)
    await chromeInGap(page, true)
    assertReadingStable(before, await anchorSnapshot(page, readState))
    await dragPaperFivePixels(page)
    const expanded = await anchorSnapshot(page, readState)
    assertReadingStable(before, expanded)
    assert.equal(await page.getByTestId('tool-bottom-bar').isVisible(), true)
    await chromeInGap(page, initiallyVisible)
    assertReadingStable(before, await anchorSnapshot(page, readState))
    return { anchor: before, hidden, expanded }
  } finally {
    await resetAnchor(page)
  }
}

export async function overlayGeometry(page, readState) {
  await page.locator(paperSelector).waitFor({ state: 'visible' })
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute('aria-busy') !== 'true',
    paperSelector
  )
  assert.equal(
    await readingCapability(page, 'previous'),
    'true',
    'Overlay geometry requires a non-initial reading position'
  )
  await resetAnchor(page)
  try {
    const initiallyVisible = await page
      .getByTestId('tool-bottom-bar')
      .isVisible()
    const before = await anchorSnapshot(page, readState)
    assert(before, 'Expected a visible text Range at a non-initial position')
    const paper = page.locator(paperSelector)
    const paperRect = await paper.boundingBox()
    const assertUnchanged = async () => {
      assertReadingStable(before, await anchorSnapshot(page, readState))
      assertRectClose(await paper.boundingBox(), paperRect, 'reading paper')
      assert(await page.getByTestId('reading-page-indicator').isVisible())
    }
    await chromeInGap(page, false)
    await assertUnchanged()
    await chromeInGap(page, true)
    const toolbar = await page.getByTestId('tool-bottom-bar').boundingBox()
    await assertUnchanged()
    assert(
      toolbar &&
        toolbar.y < paperRect.y + paperRect.height &&
        toolbar.y + toolbar.height > paperRect.y
    )
    assert.equal(await page.getByRole('group', { name: '翻页' }).count(), 0)
    await chromeInGap(page, false)
    await assertUnchanged()
    if (initiallyVisible) {
      await chromeInGap(page, true)
      await assertUnchanged()
    }
    return { paper: paperRect, toolbar, anchor: before }
  } finally {
    await resetAnchor(page)
  }
}
