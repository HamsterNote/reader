import { expect, it, vi } from 'vitest'
import {
  resolveVisibleMagnifierRect,
  createSafeAreaProbe,
  observeMagnifierViewport
} from '../src/components/IntermediateDocumentViewer/magnifierViewport'

const viewport = { width: 390, height: 844 }
const insets = { top: 47, right: 12, bottom: 34, left: 10 }

it('intersects safe layout, visual viewport and reader without double subtraction', () => {
  const full = new DOMRect(0, 0, 390, 844)
  expect(resolveVisibleMagnifierRect(full, viewport)).toEqual(full)
  const safe = new DOMRect(10, 47, 368, 763)
  expect(resolveVisibleMagnifierRect(full, viewport, insets)).toEqual(safe)
  expect(resolveVisibleMagnifierRect(safe, viewport, insets)).toEqual(safe)
  expect(
    resolveVisibleMagnifierRect(new DOMRect(30, 60, 300, 700), viewport, insets)
  ).toEqual(new DOMRect(30, 60, 300, 700))
  expect(
    resolveVisibleMagnifierRect(
      full,
      viewport,
      insets,
      new DOMRect(20, 100, 200, 400)
    )
  ).toEqual(new DOMRect(20, 100, 200, 400))
})

it('tracks visual viewport pan/resize in client coordinates and removes listeners', () => {
  vi.useFakeTimers()
  const visual = Object.assign(new EventTarget(), {
    offsetLeft: 20,
    offsetTop: 100,
    width: 200,
    height: 400
  })
  vi.stubGlobal('visualViewport', visual)
  const root = document.createElement('div')
  root.getBoundingClientRect = () => new DOMRect(0, 0, 390, 844)
  document.body.append(root)
  const change = vi.fn()
  const remove = vi.spyOn(visual, 'removeEventListener')
  const observer = observeMagnifierViewport(root, change)
  try {
    expect(observer.read()).toEqual(new DOMRect(20, 100, 200, 400))
    visual.offsetTop = 150
    visual.dispatchEvent(new Event('scroll'))
    visual.dispatchEvent(new Event('resize'))
    expect(observer.read()).toEqual(new DOMRect(20, 150, 200, 400))
    vi.advanceTimersByTime(40)
    expect(change).toHaveBeenCalledOnce()
    observer.dispose()
    expect(remove.mock.calls.map((call) => call[0])).toEqual([
      'resize',
      'scroll'
    ])
    visual.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(40)
    expect(change).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    observer.dispose()
    root.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

it('returns empty intersections and recomputes after visibility recovers', () => {
  const hidden = resolveVisibleMagnifierRect(
    new DOMRect(500, 900, 100, 100),
    viewport,
    insets
  )
  expect(hidden.width).toBe(0)
  expect(hidden.height).toBe(0)
  expect(
    resolveVisibleMagnifierRect(new DOMRect(0, 0, 390, 844), viewport, insets)
      .height
  ).toBe(763)
})

it('reads computed CSS safe insets and removes its probe', () => {
  const style = document.createElement('style')
  style.textContent =
    '[data-magnifier-safe-area] { padding: 47px 12px 34px 10px !important; }'
  document.head.append(style)
  const probe = createSafeAreaProbe(document)
  expect(probe.read()).toEqual(insets)
  probe.dispose()
  expect(document.querySelector('[data-magnifier-safe-area]')).toBeNull()
  style.remove()
})
