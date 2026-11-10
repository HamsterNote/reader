import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const settlePage = (page) =>
  page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })

function geometryCases(surfaces) {
  const entries = []
  for (const surface of surfaces)
    for (const scale of surface === 'pdf-layout' ? [0.5, 1, 2] : [1])
      for (const end of [false, true])
        for (const saved of [false, true])
          entries.push({ surface, scale, end, saved })
  return entries
}

async function saveGlyphScreenshot(
  page,
  { dpr, scale, end, saved, output, surface, viewport }
) {
  if (dpr === 1 && scale === 1 && !end && !saved)
    await page.screenshot({
      path: resolve(output, `glyph-${surface}-${viewport.width}.png`)
    })
}

async function checkGeometryCase(
  page,
  { surface, viewport, dpr, scale, end, saved, pdfBytes, epubBytes, output }
) {
  const settle = () => settlePage(page)
  const label = `${surface}/${viewport.width}x${viewport.height}/DPR${dpr}/zoom${scale}/${end ? 'end' : 'start'}/${saved ? 'saved' : 'draft'}`
  console.log(`Checking geometry ${label}`)
  await page.evaluate(
    ({ surface, bytes }) =>
      window.readerRegression.open(surface === 'epub' ? 'epub' : 'pdf', bytes, {
        renderMode: surface === 'pdf-text' ? 'text' : 'layout',
        isPdf: surface !== 'epub',
        isEpub: surface === 'epub',
        highlightColor: '#ff1234',
        selectedTool: 'text-selection'
      }),
    { surface, bytes: surface === 'epub' ? epubBytes : pdfBytes }
  )
  await page.waitForFunction((surface) => {
    const doc =
      surface === 'epub'
        ? document.querySelector('foliate-view')?.renderer?.getContents()[0]
            ?.doc
        : document
    return doc
      ?.querySelector(
        {
          epub: 'p',
          'pdf-layout': '.textLayer [data-selection-start-offset]',
          'pdf-text': '.hsn-selection-content [data-text-id]'
        }[surface]
      )
      ?.textContent.includes('Line 1')
  }, surface)
  if (surface === 'pdf-layout') {
    await page.evaluate(
      (scale) =>
        window.readerRegression.selection.current.scrollToPosition({
          x: 0,
          y: 0,
          scale
        }),
      scale
    )
    await page.waitForFunction(
      (scale) =>
        document.querySelector('[data-testid="tool-bottom-bar-layout-zoom"]')
          ?.textContent === `${scale * 100}%`,
      scale
    )
  }
  await settle()
  const points = await page.evaluate((surface) => {
    const doc =
      surface === 'epub'
        ? document.querySelector('foliate-view').renderer.getContents()[0].doc
        : document
    const el = doc.querySelector(
      {
        epub: 'p',
        'pdf-layout': '.textLayer [data-selection-start-offset]',
        'pdf-text': '.hsn-selection-content [data-text-id]'
      }[surface]
    )
    const node = el.firstChild
    const frame = doc.defaultView.frameElement?.getBoundingClientRect()
    window.geometrySource = node
    const point = (offset) => {
      const r = doc.createRange()
      r.setStart(node, offset)
      r.setEnd(node, offset + 1)
      const b = r.getBoundingClientRect()
      return {
        x: b.left + 0.2 + (frame?.left ?? 0),
        y: b.top + b.height / 2 + (frame?.top ?? 0)
      }
    }
    return { start: point(8), end: point(18), sample: point(10) }
  }, surface)
  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y, { steps: 6 })
  await page.mouse.up()
  const handles = page.locator('.hamster-reader__engine-handle')
  await handles.nth(end ? 1 : 0).waitFor()
  if (saved) {
    await page.getByRole('button', { name: '高亮', exact: true }).click()
    await page.waitForFunction(
      () => window.readerRegression.state.ranges.length === 1
    )
  }
  const box = await handles.nth(end ? 1 : 0).boundingBox()
  const origin = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  }
  const dispatch = async (phase, point) => {
    await page.evaluate(
      ({ phase, point, end }) => {
        let target = document
        if (phase === 'pointerdown')
          target = document.querySelectorAll('.hamster-reader__engine-handle')[
            Number(end)
          ]
        target.dispatchEvent(
          new PointerEvent(phase, {
            bubbles: true,
            pointerId: 7001,
            pointerType: 'touch',
            button: 0,
            buttons: 1,
            clientX: point.x,
            clientY: point.y
          })
        )
      },
      { phase, point, end }
    )
    await settle()
  }
  await dispatch('pointerdown', origin)
  await dispatch('pointermove', points.sample)
  const glyph = await page.evaluate(() => {
    const source = window.geometrySource
    const r = source.ownerDocument.createRange()
    const offset = source.data.indexOf('alpha')
    r.setStart(source, offset)
    r.setEnd(source, offset + 5)
    const original = r.getBoundingClientRect()
    const walker = document.createTreeWalker(
      document.querySelector('.hamster-reader__range-magnifier-text'),
      NodeFilter.SHOW_TEXT
    )
    let node
    while ((node = walker.nextNode())) {
      const i = node.data.indexOf('alpha')
      if (i < 0) continue
      const copy = document.createRange()
      copy.setStart(node, i)
      copy.setEnd(node, i + 5)
      return {
        source: original.toJSON(),
        lens: copy.getBoundingClientRect().toJSON()
      }
    }
    return null
  })
  assert(glyph, `${label}: copied source glyphs`)
  await saveGlyphScreenshot(page, {
    dpr,
    scale,
    end,
    saved,
    output,
    surface,
    viewport
  })
  for (const axis of ['width', 'height'])
    assert(
      Math.abs(glyph.lens[axis] - 2 * glyph.source[axis]) <= 1,
      `${label}: actual glyph ${axis} ${JSON.stringify(glyph)}`
    )
  const samples = []
  for (const [name, point] of [
    ['lower-half', { x: viewport.width / 2, y: viewport.height * 0.65 }],
    ...[115, 114, 113, 114, 115].map((dy) => [
      `T+${dy}`,
      { x: viewport.width / 2, y: viewport.top + dy }
    ]),
    ['left-edge', { x: 1, y: viewport.height / 2 }],
    ['right-edge', { x: viewport.width - 1, y: viewport.height / 2 }]
  ]) {
    await dispatch('pointermove', point)
    const measured = await page
      .getByTestId('range-magnifier')
      .evaluate((lens) => ({
        rect: lens.getBoundingClientRect().toJSON(),
        placement: lens.dataset.placement,
        hidden: lens.hidden,
        transform: getComputedStyle(lens).transform,
        inset: getComputedStyle(
          document.querySelector('[data-magnifier-safe-area]')
        ).padding
      }))
    assert.equal(measured.hidden, false, label)
    assert.equal(measured.rect.width, 76, label)
    assert.equal(measured.rect.height, 76, label)
    assert.equal(measured.transform, 'none', label)
    const expected = point.y >= viewport.top + 114 ? 'above' : 'below'
    assert.equal(measured.placement, expected, `${label}/${name}`)
    assert(measured.rect.top >= viewport.top - 1, label)
    assert(measured.rect.bottom <= viewport.height - viewport.bottom + 1, label)
    assert(
      Math.abs(
        measured.rect.left -
          Math.min(Math.max(point.x - 38, 0), viewport.width - 76)
      ) <= 1,
      label
    )
    const distance = Math.hypot(
      measured.rect.x + 38 - point.x,
      measured.rect.y + 38 - point.y
    )
    const gap = Math.abs(measured.rect.y + 38 - point.y) - 38
    if (!name.endsWith('edge')) {
      assert(Math.abs(distance - 76) <= 2, label)
      assert(Math.abs(gap - 38) <= 1, label)
    }
    samples.push({ name, point, ...measured, distance, gap })
  }
  await page.screenshot({
    path: resolve(
      output,
      `geometry-${surface}-${viewport.width}-dpr${dpr}-zoom${scale}-${end ? 'end' : 'start'}-${saved ? 'saved' : 'draft'}.png`
    )
  })
  await dispatch('pointercancel', origin)
  assert.equal(
    await page.getByTestId('range-magnifier').isVisible(),
    false,
    label
  )
  assert.equal(
    await page.locator('[data-magnifier-safe-area]').count(),
    0,
    label
  )
  return {
    label,
    viewport,
    dpr,
    scale,
    surface,
    end,
    saved,
    glyphPoint: points.sample,
    root: await page
      .locator('.hamster-reader')
      .evaluate((el) => el.getBoundingClientRect().toJSON()),
    glyph,
    samples
  }
}

// Independent DOM oracle. The controlled inset CSS changes the production env
// probe's computed padding, not the placement function or a test-only API.
export async function checkMagnifierGeometry({
  browser,
  base,
  html,
  output,
  pdfBytes,
  epubBytes,
  surfaces = ['pdf-layout', 'epub', 'pdf-text']
}) {
  const rows = [],
    errors = []
  const viewports = [
    { width: 375, height: 667, top: 20, bottom: 34 },
    { width: 390, height: 844, top: 47, bottom: 34 }
  ]
  let page
  try {
    for (const viewport of viewports)
      for (const dpr of [1, 2, 3]) {
        page = await browser.newPage({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: dpr,
          hasTouch: true
        })
        page.setDefaultTimeout(20000)
        page.on('pageerror', (error) => errors.push(error.message))
        await page.route('**/geometry.html', (route) =>
          route.fulfill({ contentType: 'text/html', body: html })
        )
        await page.goto(`${base}/geometry.html`)
        await page.addStyleTag({
          content: `body { margin:0; } .hamster-reader { height:100%; } [data-magnifier-safe-area] { padding:${viewport.top}px 0 ${viewport.bottom}px !important; }`
        })
        await page.waitForFunction(() => window.readerRegression)
        // Geometry uses explicit synthetic events; it does not claim OS capture.
        await page.evaluate(() => {
          HTMLElement.prototype.setPointerCapture = () => {}
          HTMLElement.prototype.hasPointerCapture = () => false
        })
        for (const entry of geometryCases(surfaces)) {
          rows.push(
            await checkGeometryCase(page, {
              ...entry,
              viewport,
              dpr,
              pdfBytes,
              epubBytes,
              output
            })
          )
        }

        await page.close()
        page = null
      }
    assert.deepEqual(errors, [])
    await writeFile(
      resolve(output, 'magnifier-geometry.json'),
      JSON.stringify(
        {
          browser: browser.version(),
          platform: `${process.platform}/${process.arch}`,
          coverage:
            'Real DOM glyph and outer-box measurements; mouse initial selection, synthetic pointer drags and controlled CSS probe insets; native WebKit first drag NOT verified.',
          rows
        },
        null,
        2
      )
    )
    return rows.length
  } finally {
    await page?.close()
  }
}
