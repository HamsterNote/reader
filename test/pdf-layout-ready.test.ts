import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// Exercise the source helper used by the published PDF viewer.
import { isPdfLayoutReady, observePdfLayout } from '../src/pdf/pdfLayoutReady'

type Box = {
  isConnected: boolean
  offsetParent: object | null
  clientWidth: number
  clientHeight: number
  getBoundingClientRect(): { width: number; height: number }
}
let frames: Map<number, FrameRequestCallback>, observers: Observer[]
class Observer implements ResizeObserver {
  targets = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
}
const element = (value: Box) => value as unknown as HTMLElement
beforeEach(() => {
  frames = new Map()
  observers = []
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++id, fn)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', Observer)
})
afterEach(() => vi.unstubAllGlobals())
function box(): Box {
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
    const stop = observePdfLayout(
      element(container),
      () => (target ? element(target) : undefined),
      ready
    )
    flush()
    expect(ready).not.toHaveBeenCalled()
    Object.assign(page, box())
    Object.assign(container, box())
    target = page
    // Zero elapsed-time advancement. Only the resize notification wakes it.
    observers[0].callback([], observers[0])
    observers[0].callback([], observers[0])
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
  const stop = observePdfLayout(element(box()), () => element(box()), ready)
  const queued = [...frames.values()][0]
  stop()
  queued(0)
  observers[0].callback([], observers[0])
  flush()
  expect(ready).not.toHaveBeenCalled()
  expect(frames.size).toBe(0)
})

it('requires both actual layout rectangles and client dimensions', () => {
  const page = box()
  page.getBoundingClientRect = () => ({ width: 0, height: 0 })
  expect(isPdfLayoutReady(element(box()), element(page))).toBe(false)
})
