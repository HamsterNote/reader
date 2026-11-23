import { describe, expect, it } from 'vitest'
import { readingTapZone, swipeAction } from '../src/components/reading/tapZones'

describe('reading tap zones', () => {
  const viewport = { left: 20, top: 40, width: 300, height: 400 }

  it.each([
    [119, 139, 'toggle'],
    [119, 140, 'previous'],
    [120, 140, 'toggle'],
    [219, 339, 'toggle'],
    [220, 339, 'next'],
    [120, 340, 'toggle'],
    [320, 340, null],
    [120, 440, null]
  ])('maps (%d, %d) to %s', (x, y, zone) => {
    expect(readingTapZone(viewport, x, y)).toBe(zone)
  })
  it.each([
    [-99, 0, null],
    [-100, 0, 'next'],
    [100, 0, 'previous'],
    [0, 99, null],
    [0, 100, 'toggle'],
    [0, -100, 'toggle'],
    [120, 120, null]
  ] as const)('classifies displacement %d, %d', (dx, dy, expected) => {
    expect(swipeAction({ ...viewport, height: 300 }, dx, dy)).toBe(expected)
  })
})
