import { describe, expect, it } from 'vitest'
import { intersects, pagePercentage } from '../src/viewportPosition'

describe('display-page progress geometry shared by layout readers', () => {
  it.each([0.5, 1, 2])(
    'projects cropped/rotated display boxes once at scale %s',
    (scale) => {
      // Ratios are relative to the new displayed box, independent of its old orientation.
      for (const [width, height] of [
        [600, 1000],
        [1000, 600],
        [480, 700]
      ]) {
        const box = new DOMRect(
          10,
          -0.4 * height * scale,
          width * scale,
          height * scale
        )
        expect(pagePercentage(0, box)).toBeCloseTo(40)
        expect(
          box.top + (box.height * pagePercentage(0, box)!) / 100
        ).toBeCloseTo(0)
      }
    }
  )
  it('keeps gaps, tails, zero dimensions and horizontal exclusion within their boundaries', () => {
    const viewport = new DOMRect(0, 0, 320, 600)
    expect(pagePercentage(0, new DOMRect(0, 20, 300, 1000))).toBe(0) // next page in gap
    expect(pagePercentage(0, new DOMRect(0, -1500, 300, 1000))).toBe(100)
    expect(pagePercentage(0, new DOMRect(0, 0, 300, 0))).toBeUndefined()
    expect(intersects(viewport, new DOMRect(400, 0, 300, 1000))).toBe(false)
    expect(intersects(viewport, new DOMRect(0, 600, 300, 1000))).toBe(false)
    expect(intersects(viewport, new DOMRect(0, -300, 300, 400))).toBe(true)
  })
})
