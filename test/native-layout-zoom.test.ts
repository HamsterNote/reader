import { describe, expect, it } from 'vitest'

import {
  computeNativeLayoutTransformExtent,
  computeCenteredScrollPosition,
  isIPadOS,
  resolveNativeLayoutScaleStyle,
  resolveNativeLayoutTouchAction
} from '../src/components/IntermediateDocumentViewer/nativeLayoutZoom'

describe('computeNativeLayoutTransformExtent', () => {
  it.each([
    { scale: 0.25, expected: { width: 200, height: 300 } },
    { scale: 3, expected: { width: 2400, height: 3600 } }
  ])('scales the layout extent at $scale', ({ scale, expected }) => {
    // Given: the native document has a stable intrinsic layout size.
    const intrinsicSize = { width: 800, height: 1200 }

    // When: the iPad transform extent is calculated.
    const result = computeNativeLayoutTransformExtent(intrinsicSize, scale)

    // Then: normal-flow space exactly matches the transformed visual box.
    expect(result).toEqual(expected)
  })
})

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

  it('preserves a centered horizontal anchor when zooming out then in', () => {
    // Given: an 800px document is centered at 25% in a 1000px viewport.
    const viewport = {
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 1000,
      clientHeight: 600
    }

    // When: the native document zooms from 25% to 300%.
    const result = computeCenteredScrollPosition(viewport, 0.25, 3, {
      width: 800,
      height: 1200
    })

    // Then: the same intrinsic center remains at the viewport center.
    expect(result).toEqual({ left: 700, top: 3300 })
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

  it('reserves native gestures for pointer-type-aware scrolling in stylus-only mode', () => {
    // Given: Layout Mode normally reserves touch gestures for two-finger panning.
    const touchPanMode = 'two-finger'

    // When: the drawing controller enters stylus-only mode.
    const result = resolveNativeLayoutTouchAction(touchPanMode, true)

    // Then: the browser cannot take over a pen gesture before touch is identified.
    expect(result).toBe('none')
  })
})

describe('resolveNativeLayoutScaleStyle', () => {
  it('uses a transform on iPadOS so Pencil coordinates avoid CSS zoom', () => {
    // Given: iPadOS renders the native document at 150%.
    const scale = 1.5

    // When: the native layout scale style is resolved for iPadOS.
    const result = resolveNativeLayoutScaleStyle(scale, true)

    // Then: visual scaling no longer passes through WebKit's CSS zoom path.
    expect(result).toEqual({
      transform: 'scale(1.5)',
      transformOrigin: 'top left'
    })
  })

  it('keeps CSS zoom on other platforms', () => {
    // Given: a non-iPad browser renders the native document at 150%.
    const scale = 1.5

    // When: the native layout scale style is resolved.
    const result = resolveNativeLayoutScaleStyle(scale, false)

    // Then: the existing desktop and phone scaling path remains unchanged.
    expect(result).toEqual({ zoom: 1.5 })
  })
})

describe('isIPadOS', () => {
  it('recognizes desktop-class iPadOS user agents', () => {
    // Given: modern iPadOS identifies itself as a touch-capable Mac.
    const navigatorData = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5
    }

    // When: the platform is classified.
    const result = isIPadOS(navigatorData)

    // Then: the desktop-class user agent is still treated as iPadOS.
    expect(result).toBe(true)
  })

  it('does not classify a Mac without touch as iPadOS', () => {
    // Given: desktop Safari reports the same platform without touch points.
    const navigatorData = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 0
    }

    // When: the platform is classified.
    const result = isIPadOS(navigatorData)

    // Then: regular macOS keeps the existing CSS zoom path.
    expect(result).toBe(false)
  })
})
