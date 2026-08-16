import { describe, expect, it } from 'vitest'

import {
  computeCenteredScrollPosition,
  resolveNativeLayoutTouchAction
} from '../src/components/IntermediateDocumentViewer/nativeLayoutZoom'

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

describe('resolveNativeLayoutTouchAction', () => {
  it('keeps two-finger gesture routing when stylus-only drawing is disabled', () => {
    // Given: two-finger panning is active in regular drawing mode.
    const touchPanMode = 'two-finger'

    // When: the native viewport touch action is resolved.
    const result = resolveNativeLayoutTouchAction(touchPanMode, false)

    // Then: browser one-finger panning remains reserved for the custom gesture.
    expect(result).toBe('none')
  })

  it('allows one-finger page scrolling while stylus-only drawing is active', () => {
    // Given: Layout Mode normally reserves touch gestures for two-finger panning.
    const touchPanMode = 'two-finger'

    // When: the drawing controller enters stylus-only mode.
    const result = resolveNativeLayoutTouchAction(touchPanMode, true)

    // Then: native one-finger scrolling takes precedence over the pan mode.
    expect(result).toBe('pan-x pan-y')
  })
})
