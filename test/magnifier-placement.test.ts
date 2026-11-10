import { expect, it } from 'vitest'
import {
  resolveMagnifierPosition,
  resolveSnapshotMagnifierPosition
} from '../src/components/IntermediateDocumentViewer/rangeMagnifierGeometry'

it.each([
  [375, 667, 20, 34],
  [390, 844, 47, 34]
])(
  'flips at exactly T+114 in %sx%s, including recovery',
  (width, height, top, bottom) => {
    const root = new DOMRect(0, top, width, height - top - bottom)
    for (const [dy, placement] of [
      [115, 'above'],
      [114, 'above'],
      [113, 'below'],
      [114, 'above'],
      [115, 'above']
    ] as const) {
      const y = top + dy
      const p = resolveMagnifierPosition(
        { clientX: width / 2, clientY: y },
        root
      )
      expect(p.placement).toBe(placement)
      expect(p.top).toBeGreaterThanOrEqual(0)
      expect(p.top + 76).toBeLessThanOrEqual(root.height)
      expect(Math.abs(p.top + top + 38 - y)).toBe(76)
    }
    for (const y of [height / 2, height - bottom]) {
      const p = resolveMagnifierPosition(
        { clientX: width / 2, clientY: y },
        root
      )
      expect(p.placement).toBe('above')
      expect(y - (p.top + top + 76)).toBe(38)
    }
  }
)

it('clamps only the display and centres each undersized axis', () => {
  const point = { clientX: -100, clientY: 50 }
  expect(
    resolveMagnifierPosition(point, new DOMRect(10, 20, 400, 600)).left
  ).toBe(0)
  expect(
    resolveMagnifierPosition(
      { clientX: 1000, clientY: 50 },
      new DOMRect(10, 20, 400, 600)
    ).left
  ).toBe(324)
  expect(resolveMagnifierPosition(point, new DOMRect(10, 20, 50, 60))).toEqual({
    left: -13,
    top: -8,
    placement: 'below'
  })
  expect(point).toEqual({ clientX: -100, clientY: 50 })
  // Above starts inside, but its bottom overflows: it is not a full candidate.
  expect(
    resolveMagnifierPosition(
      { clientX: 100, clientY: 300 },
      new DOMRect(0, 0, 200, 200)
    ).placement
  ).toBe('below')
})

it('retains snapshot size, distance and the 8px threshold', () => {
  const root = new DOMRect(10, 20, 300, 400)
  expect(
    resolveSnapshotMagnifierPosition({ clientX: 160, clientY: 165 }, root)
  ).toEqual({ left: 90, top: 163, placement: 'below' })
  expect(
    resolveSnapshotMagnifierPosition({ clientX: 160, clientY: 166 }, root)
  ).toEqual({ left: 90, top: 8, placement: 'above' })
})
