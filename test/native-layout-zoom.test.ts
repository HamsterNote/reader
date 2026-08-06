import { describe, expect, it } from 'vitest'

import { computeCenteredScrollPosition } from '../src/components/IntermediateDocumentViewer/nativeLayoutZoom'

describe('computeCenteredScrollPosition', () => {
  it('keeps the viewport center on the same content point after zooming', () => {
    // Given: the viewport center points at content coordinate (500, 700).
    const viewport = {
      scrollLeft: 300,
      scrollTop: 500,
      clientWidth: 400,
      clientHeight: 400
    }

    // When: the page scale doubles.
    const result = computeCenteredScrollPosition(viewport, 1, 2)

    // Then: native scroll offsets preserve that content coordinate at center.
    expect(result).toEqual({ left: 800, top: 1200 })
  })

  it('clamps negative native scroll offsets at the leading edges', () => {
    // Given: a viewport near the document origin.
    const viewport = {
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 400,
      clientHeight: 300
    }

    // When: the page scale becomes smaller.
    const result = computeCenteredScrollPosition(viewport, 1, 0.25)

    // Then: the browser-compatible target does not request negative scrolling.
    expect(result).toEqual({ left: 0, top: 0 })
  })
})
