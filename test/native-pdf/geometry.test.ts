import { describe, expect, it } from 'vitest'
import {
  clampNativeScrollOffset,
  nativeContentHeightWithFinalTail,
  nativeFinalPageTailPadding,
  nativePageAtOffset,
  nativePageLayout,
  nativePageOffset,
  preserveNativeZoomCenter
} from '../../src/nativePdf/geometry'

describe('native PDF page layout geometry', () => {
  it('keeps zero dimensions finite and empty', () => {
    expect(
      nativePageLayout({ x: 0, y: 0, width: 0, height: 0, rotation: 0 })
    ).toMatchObject({
      visualWidth: 0,
      visualHeight: 0,
      frame: { x: 0, y: 0, width: 0, height: 0 },
      slot: { x: 0, y: 0, width: 0, height: 0 }
    })
  })

  it.each([90, 270, -90])(
    'swaps visual dimensions for rotation %s',
    (rotation) => {
      const layout = nativePageLayout({
        x: 0,
        y: 0,
        width: 300,
        height: 400,
        rotation
      })
      expect(layout.visualWidth).toBe(400)
      expect(layout.visualHeight).toBe(300)
    }
  )

  it('applies crop percentages to the scale-one frame and slot', () => {
    const layout = nativePageLayout(
      { x: 12, y: 24, width: 300, height: 400, rotation: 0 },
      { top: 0.1, right: 0.2, bottom: 0.3, left: 0.05 },
      500
    )
    expect(layout.frame).toEqual({ x: -15, y: 460, width: 300, height: 400 })
    expect(layout.slot.x).toBe(0)
    expect(layout.slot.y).toBe(500)
    expect(layout.slot.width).toBeCloseTo(225)
    expect(layout.slot.height).toBeCloseTo(240)
  })

  it.each([0.5, 1, 2])(
    'maps page tops to a clamped offset at zoom %s',
    (zoom) => {
      expect(nativePageOffset(812.25, zoom, 1612.25, 600)).toBe(
        clampNativeScrollOffset(812.25 * zoom, zoom, 1612.25, 600)
      )
      expect(nativePageOffset(0, zoom, 1612.25, 600)).toBe(0)
    }
  )

  it('clamps the last page even with a fractional page height', () => {
    expect(nativePageOffset(3000, 2, 3200.75, 800)).toBe(5601.5)
    expect(nativePageOffset(99999, 2, 3200.75, 800)).toBe(5601.5)
  })

  it.each([0.5, 1, 2])(
    'keeps the final page top reachable at zoom %s',
    (zoom) => {
      const finalHeight = 500
      const viewport = 679.3333333333333
      const contentHeight = 1012
      const padded = nativeContentHeightWithFinalTail(
        contentHeight,
        finalHeight,
        zoom,
        viewport
      )
      const target = 512 * zoom
      expect(nativeFinalPageTailPadding(finalHeight, zoom, viewport)).toBe(
        Math.max(0, viewport / zoom - finalHeight)
      )
      expect(
        clampNativeScrollOffset(target, zoom, padded, viewport)
      ).toBeCloseTo(target)
    }
  )

  it('does not add tail for a page taller than the viewport or zero content', () => {
    expect(nativeFinalPageTailPadding(800, 1, 600)).toBe(0)
    expect(nativeContentHeightWithFinalTail(0, 0, 1, 600)).toBe(600)
  })

  it('preserves the viewport center when zoom changes', () => {
    expect(preserveNativeZoomCenter(400, 1, 2, 2000, 800)).toBe(1200)
    expect(preserveNativeZoomCenter(0, 1, 0.5, 2000, 800)).toBe(0)
  })

  it('selects the page containing the viewport center, including the gap boundary', () => {
    const pages = [
      { pageNumber: 1, top: 0, height: 800 },
      { pageNumber: 2, top: 812, height: 800 }
    ]
    expect(nativePageAtOffset(pages, 0, 1, 600)).toBe(1)
    expect(nativePageAtOffset(pages, 812, 1, 600)).toBe(2)
    expect(nativePageAtOffset(pages, 400, 1, 800)).toBe(1)
    expect(nativePageAtOffset(pages, 1212, 1, 800)).toBe(2)
  })

  it.each([0.5, 1, 2])(
    'round trips a cropped second page at zoom %s',
    (zoom) => {
      const pages = [
        { pageNumber: 1, top: 0, height: 640 },
        { pageNumber: 2, top: 652, height: 640 }
      ]
      const offset = nativePageOffset(652, zoom, 1292, 500)
      expect(nativePageAtOffset(pages, offset, zoom, 500)).toBe(2)
    }
  )
})
