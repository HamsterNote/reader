import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstVisiblePdfCharacter } from '../../src/pdf/pdfReadingPosition'
import {
  buildCanonicalPageText,
  enhanceTextLayer
} from '../../src/pdf/pdfTextMapping'

const original = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
)
const geometry = new WeakMap<HTMLElement, DOMRect[]>()
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) {
      return [
        geometry.get(this.startContainer.parentElement!)?.[this.startOffset]
      ].filter(Boolean)
    }
  })
})
afterEach(() => {
  if (original)
    Object.defineProperty(Range.prototype, 'getClientRects', original)
  else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  vi.restoreAllMocks()
})
function context(
  pageNumber: number,
  text: string,
  rects: DOMRect[],
  domText = text
) {
  const canonical = buildCanonicalPageText(pageNumber, [{ str: text }])
  const pageDiv = document.createElement('div')
  const span = document.createElement('span')
  span.textContent = domText
  pageDiv.append(span)
  geometry.set(span, rects)
  vi.spyOn(pageDiv, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(-100, -100, 500, 500)
  )
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  vi.spyOn(span, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(
      left,
      top,
      Math.max(...rects.map((rect) => rect.right)) - left,
      Math.max(...rects.map((rect) => rect.bottom)) - top
    )
  )
  enhanceTextLayer(pageDiv, canonical)
  return {
    pageNumber,
    canonical,
    pageDiv,
    textLayerDiv: pageDiv
  }
}
const safe = new DOMRect(0, 0, 200, 200)
describe('safe PDF source characters', () => {
  it('chooses the first visible fragment across pages, including horizontal and partial-line clipping', () => {
    const previous = context(1, 'AB', [
      new DOMRect(-10, -5, 10, 20),
      new DOMRect(0, -5, 10, 20)
    ])
    const next = context(2, 'C', [new DOMRect(0, 30, 10, 20)])
    expect(firstVisiblePdfCharacter([next, previous], safe)).toMatchObject({
      pageNumber: 1,
      offset: 1
    })
  })
  it('uses actual rotated glyph geometry and ignores cropped characters', () => {
    const rotated = context(1, 'ABC', [
      new DOMRect(0, 30, 10, 10),
      new DOMRect(0, 20, 10, 10),
      new DOMRect(0, 10, 10, 10)
    ])
    expect(firstVisiblePdfCharacter([rotated], safe)?.offset).toBe(2)
    expect(
      firstVisiblePdfCharacter(
        [rotated],
        safe,
        () => new DOMRect(0, 20, 200, 180)
      )?.offset
    ).toBe(1)
  })
  it('keeps canonical offsets when the only visible character follows an unexpanded ligature', () => {
    const ligature = context(
      1,
      'fi x',
      [
        new DOMRect(0, 0, 10, 20),
        new DOMRect(10, 0, 5, 20),
        new DOMRect(15, 0, 10, 20)
      ],
      'ﬁ x'
    )
    expect(
      firstVisiblePdfCharacter([ligature], new DOMRect(15, 0, 100, 100))?.offset
    ).toBe(3)
  })
})

it('excludes an occluded row X and both horizontal edges, retaining the partially exposed row A', () => {
  const page = context(1, 'XALR', [
    new DOMRect(20, 50, 10, 20),
    new DOMRect(20, 75, 10, 20),
    new DOMRect(-20, 80, 10, 20),
    new DOMRect(210, 80, 10, 20)
  ])
  expect(
    firstVisiblePdfCharacter([page], new DOMRect(0, 80, 200, 200))
  ).toMatchObject({ pageNumber: 1, offset: 1, text: 'ALR' })
})
