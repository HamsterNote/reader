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

export async function chrome(page, show) {
  const bar = page.getByTestId('tool-bottom-bar')
  if ((await bar.isVisible()) !== show) {
    await tapPaper(page, 0.5, 0.5)
    await bar.waitFor({ state: show ? 'visible' : 'hidden' })
  }
}

export async function overlayGeometry(page) {
  const visible = await page.getByTestId('tool-bottom-bar').isVisible()
  const paper = page.locator(paperSelector)
  const before = await paper.boundingBox()
  await chrome(page, true)
  const toolbar = await page.getByTestId('tool-bottom-bar').boundingBox()
  assert.deepEqual(await paper.boundingBox(), before)
  assert(
    toolbar &&
      toolbar.y < before.y + before.height &&
      toolbar.y + toolbar.height > before.y
  )
  assert.equal(await page.getByRole('group', { name: '翻页' }).count(), 0)
  assert(await page.getByTestId('reading-page-indicator').isVisible())
  await chrome(page, visible)
  return { paper: before, toolbar }
}
