import { describe, expect, it } from 'vitest'
import { nativePageLayout } from '../../src/nativePdf/geometry'

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
})
