// @ts-nocheck
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// Test the actual installed patch, not a duplicate implementation.
import { isPdfLayoutReady, observePdfLayout } from '../src/pdf/pdfLayoutReady'

let frames, observers
beforeEach(() => {
  frames = new Map()
  observers = []
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (fn) => {
    frames.set(++id, fn)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set()
      constructor(callback) {
        this.callback = callback
        observers.push(this)
      }
      observe(target) {
        this.targets.add(target)
      }
      unobserve(target) {
        this.targets.delete(target)
      }
      disconnect() {
        this.targets.clear()
      }
    }
  )
})
afterEach(() => vi.unstubAllGlobals())
function box() {
  return {
    isConnected: true,
    offsetParent: {},
    clientWidth: 400,
    clientHeight: 600,
    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight }
    }
  }
}
function flush() {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((fn) => fn(0))
}

it.each(['detached', 'offsetParent', 'width', 'height', 'page missing'])(
  'blocks %s until a geometry signal and cleans all resources',
  (condition) => {
    const container = box(),
      page = box()
    if (condition === 'detached') page.isConnected = false
    if (condition === 'offsetParent') page.offsetParent = null
    if (condition === 'width') container.clientWidth = 0
    if (condition === 'height') page.clientHeight = 0
    let target = condition === 'page missing' ? undefined : page
    const ready = vi.fn()
    const stop = observePdfLayout(container, () => target, ready)
    flush()
    expect(ready).not.toHaveBeenCalled()
    Object.assign(page, box())
    Object.assign(container, box())
    target = page
    // Zero elapsed-time advancement. Only the resize notification wakes it.
    observers[0].callback([])
    observers[0].callback([])
    expect(frames.size).toBe(1)
    flush()
    expect(ready).toHaveBeenCalledTimes(1)
    stop()
    expect(observers[0].targets.size).toBe(0)
    expect(frames.size).toBe(0)
  }
)

it('cancels an already scheduled callback and ignores notifications after cancellation', () => {
  const ready = vi.fn()
  const stop = observePdfLayout(box(), () => box(), ready)
  const queued = [...frames.values()][0]
  stop()
  queued(0)
  observers[0].callback([])
  flush()
  expect(ready).not.toHaveBeenCalled()
  expect(frames.size).toBe(0)
})

it('requires both actual layout rectangles and client dimensions', () => {
  const page = box()
  page.getBoundingClientRect = () => ({ width: 0, height: 0 })
  expect(isPdfLayoutReady(box(), page)).toBe(false)
})
