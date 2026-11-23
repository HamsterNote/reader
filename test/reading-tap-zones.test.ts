import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  readingTapZone,
  swipeAction,
  trackReadingPress
} from '../src/components/reading/tapZones'

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

  function dragFivePixels(mask: boolean) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const swipe = vi.fn()
    const tracker = trackReadingPress(target, {
      bounds: () => ({ left: 0, top: 0, width: 360, height: 360 }),
      mask,
      swipe
    })
    const point = (type: string, x: number, y: number) => {
      const init = {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        detail: 1
      }
      const event =
        type === 'click'
          ? new MouseEvent(type, init)
          : new PointerEvent(type, { ...init, isPrimary: true, pointerId: 1 })
      fireEvent(target, event)
      return event
    }
    try {
      point('pointerdown', 300, 180)
      point('pointermove', 295, 180)
      point('pointerup', 295, 180)
      const click = point('click', 295, 180)
      expect(click.defaultPrevented).toBe(true)
      expect(tracker.consume(click)).toBeNull()
      expect(swipe).not.toHaveBeenCalled()
      point('pointerdown', 300, 180)
      point('pointerup', 300, 180)
      const tap = point('click', 300, 180)
      expect(tap.defaultPrevented).toBe(false)
      expect(tracker.consume(tap)).toBe('next')
    } finally {
      tracker.dispose()
      target.remove()
    }
  }

  it('consumes a 5px drag instead of treating it as a next-page click in hidden chrome', () => {
    dragFivePixels(false)
  })

  it('consumes a 5px drag on the expanded reading mask without hiding chrome', () => {
    dragFivePixels(true)
  })

  it('keeps one-pixel pointer release rounding as a tap', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const tracker = trackReadingPress(target, {
      bounds: () => ({ left: 0, top: 0, width: 360, height: 360 }),
      swipe: vi.fn()
    })
    try {
      for (const [type, clientX] of [
        ['pointerdown', 300],
        ['pointerup', 299]
      ] as const)
        fireEvent(
          target,
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            isPrimary: true,
            pointerId: 1,
            button: 0,
            clientX,
            clientY: 180
          })
        )
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        clientX: 299,
        clientY: 180
      })
      fireEvent(target, click)
      expect(click.defaultPrevented).toBe(false)
      expect(tracker.consume(click)).toBe('next')
    } finally {
      tracker.dispose()
      target.remove()
    }
  })
})
