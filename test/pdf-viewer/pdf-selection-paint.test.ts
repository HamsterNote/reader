import { expect, it, vi } from 'vitest'
import {
  mergePdfLineRects,
  pdfHighlightFill,
  pdfRangeClientRects
} from '../../src/pdf/pdfSelectionPaint'

it.each([
  '#ffc107',
  '#fc0',
  '#ffc107ff',
  '#fc0f',
  'rgb(255, 193, 7)',
  'rgba(255, 193, 7, 1)',
  'rgb(255 193 7 / 100%)'
])(
  'makes opaque PDF fill %s translucent without relying on blending',
  (color) => {
    expect(pdfHighlightFill(color)).toMatch(/, 0\.35\)$/)
    expect(pdfHighlightFill(pdfHighlightFill(color))).toBe(
      pdfHighlightFill(color)
    )
  }
)

it('preserves lighter explicit alpha and caps dark fills', () => {
  expect(pdfHighlightFill('rgba(20, 30, 40, 0.2)')).toBe(
    'rgba(20, 30, 40, 0.2)'
  )
  expect(pdfHighlightFill('hsl(45 100% 50% / 90%)')).toBe(
    'hsla(45, 100%, 50%, 0.35)'
  )
  expect(pdfHighlightFill('#ffc10700')).toBe('rgba(255, 193, 7, 0)')
  expect(pdfHighlightFill('gold')).toBe('rgba(255, 215, 0, 0.35)')
  expect(pdfHighlightFill('#ffc107', false)).toBe('#ffc107')
})

it('joins subpixel same-line gaps without expanding the line or crossing columns/rows', () => {
  expect(
    mergePdfLineRects([
      { left: 10.1, top: 20, width: 15.2, height: 10 },
      { left: 25.45, top: 20.1, width: 10, height: 9.8 },
      { left: 80, top: 20, width: 15, height: 10 },
      { left: 10.1, top: 31, width: 15, height: 10 }
    ])
  ).toEqual([
    { left: 10.1, top: 20.1, width: 25.35, height: 9.8 },
    { left: 80, top: 20, width: 15, height: 10 },
    { left: 10.1, top: 31, width: 15, height: 10 }
  ])
})

it('ignores element boxes and clips oversized font boxes to PDF.js span bounds', () => {
  const layer = document.createElement('div')
  layer.innerHTML =
    '<span data-selection-start-offset="0">Alpha</span><span data-selection-start-offset="5">beta</span>'
  document.body.append(layer)
  const spans = [...layer.children]
  spans.forEach((span, index) => {
    span.getBoundingClientRect = () =>
      new DOMRect(10 + index * 20.2, 20, 20, 10)
  })
  const range = document.createRange()
  range.selectNodeContents(layer)
  range.getClientRects = () => [] as unknown as DOMRectList
  const mock = vi.spyOn(document, 'createRange').mockImplementation(() => {
    const fragment = range.cloneRange()
    fragment.getClientRects = () =>
      [
        new DOMRect(
          fragment.startContainer === spans[0].firstChild ? 10 : 30.2,
          18,
          20,
          15
        )
      ] as unknown as DOMRectList
    return fragment
  })
  try {
    expect(
      pdfRangeClientRects(range).map((r) => [r.left, r.top, r.width, r.height])
    ).toEqual([[10, 20, 40.2, 10]])
  } finally {
    mock.mockRestore()
    layer.remove()
  }
})
