import '@testing-library/jest-dom/vitest'
import { act, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

let observerInstances: MockIntersectionObserver[] = []
let resizeObserverInstances: MockResizeObserver[] = []

type ElementBox = {
  readonly width: number
  readonly height: number
  readonly left?: number
  readonly top?: number
}

type ScrollContainerBox = {
  readonly width: number
  readonly height: number
  readonly scrollWidth?: number
  readonly scrollHeight?: number
  readonly scrollTop?: number
  readonly scrollLeft?: number
}

type RestoreMock = () => void

const elementRects = new Map<Element, DOMRectReadOnly>()
const scrollContainerRestores = new Map<HTMLElement, RestoreMock>()
const originalGetBoundingClientRect =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement.prototype.getBoundingClientRect
    : undefined

const makeDomRect = ({
  width,
  height,
  left = 0,
  top = 0
}: ElementBox): DOMRectReadOnly => new DOMRectReadOnly(left, top, width, height)

const getMockedRect = (target: Element): DOMRectReadOnly =>
  elementRects.get(target) ??
  (target instanceof HTMLElement && originalGetBoundingClientRect
    ? originalGetBoundingClientRect.call(target)
    : target.getBoundingClientRect())

const createResizeObserverEntry = (target: Element): ResizeObserverEntry => {
  const contentRect = getMockedRect(target)
  const boxSize = {
    blockSize: contentRect.height,
    inlineSize: contentRect.width
  }

  return {
    borderBoxSize: [boxSize],
    contentBoxSize: [boxSize],
    contentRect,
    devicePixelContentBoxSize: [boxSize],
    target
  } satisfies ResizeObserverEntry
}

class MockResizeObserver implements ResizeObserver {
  readonly observedElements = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObserverInstances.push(this)
  }

  disconnect = () => {
    this.observedElements.clear()
  }

  observe = (target: Element) => {
    this.observedElements.add(target)
    this.trigger(target)
  }

  unobserve = (target: Element) => {
    this.observedElements.delete(target)
  }

  trigger(target: Element) {
    act(() => {
      this.callback([createResizeObserverEntry(target)], this)
    })
  }
}

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = '0px'
  readonly thresholds: ReadonlyArray<number> = [0]
  readonly observedElements = new Set<Element>()

  constructor(private readonly callback: IntersectionObserverCallback) {
    observerInstances.push(this)
  }

  disconnect = () => {
    this.observedElements.clear()
  }

  observe = (target: Element) => {
    this.observedElements.add(target)
  }

  takeRecords = () => []

  unobserve = (target: Element) => {
    this.observedElements.delete(target)
  }

  trigger(target: Element, isIntersecting = true) {
    const entry = {
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: isIntersecting
        ? target.getBoundingClientRect()
        : new DOMRectReadOnly(),
      isIntersecting,
      rootBounds: null,
      target,
      time: performance.now()
    } as IntersectionObserverEntry

    act(() => {
      this.callback([entry], this)
    })
  }
}

globalThis.IntersectionObserver =
  MockIntersectionObserver as typeof IntersectionObserver
globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver

if (typeof HTMLElement !== 'undefined' && originalGetBoundingClientRect) {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return elementRects.get(this) ?? originalGetBoundingClientRect.call(this)
  }
}

export const intersectionObserverMock = {
  get instances() {
    return observerInstances
  },
  reset() {
    observerInstances = []
  },
  trigger(target: Element, isIntersecting = true) {
    const observer = observerInstances.find((instance) =>
      instance.observedElements.has(target)
    )

    if (!observer) {
      throw new Error('No IntersectionObserver is observing the target')
    }

    observer.trigger(target, isIntersecting)
  }
}

export const resizeObserverMock = {
  get instances() {
    return resizeObserverInstances
  },
  reset() {
    resizeObserverInstances.forEach((instance) => {
      instance.disconnect()
    })
    resizeObserverInstances = []
  },
  trigger(target: Element) {
    const observers = resizeObserverInstances.filter((instance) =>
      instance.observedElements.has(target)
    )

    if (observers.length === 0) {
      throw new Error('No ResizeObserver is observing the target')
    }

    observers.forEach((observer) => {
      observer.trigger(target)
    })
  }
}

export function mockElementSize(
  element: HTMLElement,
  box: ElementBox
): RestoreMock {
  elementRects.set(element, makeDomRect(box))

  resizeObserverInstances.forEach((observer) => {
    if (observer.observedElements.has(element)) {
      observer.trigger(element)
    }
  })

  return () => {
    elementRects.delete(element)
  }
}

export function setScrollContainerSize(
  element: HTMLElement,
  box: ScrollContainerBox
): RestoreMock {
  scrollContainerRestores.get(element)?.()

  const descriptors = {
    clientHeight: Object.getOwnPropertyDescriptor(element, 'clientHeight'),
    clientWidth: Object.getOwnPropertyDescriptor(element, 'clientWidth'),
    scrollHeight: Object.getOwnPropertyDescriptor(element, 'scrollHeight'),
    scrollLeft: Object.getOwnPropertyDescriptor(element, 'scrollLeft'),
    scrollTop: Object.getOwnPropertyDescriptor(element, 'scrollTop'),
    scrollWidth: Object.getOwnPropertyDescriptor(element, 'scrollWidth')
  }
  const values = {
    clientHeight: box.height,
    clientWidth: box.width,
    scrollHeight: box.scrollHeight ?? box.height,
    scrollLeft: box.scrollLeft ?? 0,
    scrollTop: box.scrollTop ?? 0,
    scrollWidth: box.scrollWidth ?? box.width
  }

  Object.entries(values).forEach(([key, value]) => {
    Object.defineProperty(element, key, {
      configurable: true,
      value,
      writable: true
    })
  })

  const restoreSize = mockElementSize(element, {
    width: box.width,
    height: box.height
  })

  const restore = () => {
    Object.entries(descriptors).forEach(([key, descriptor]) => {
      if (descriptor) {
        Object.defineProperty(element, key, descriptor)
      } else {
        Reflect.deleteProperty(element, key)
      }
    })
    restoreSize()
    scrollContainerRestores.delete(element)
  }

  scrollContainerRestores.set(element, restore)

  return restore
}

function resetElementGeometryMocks() {
  Array.from(scrollContainerRestores.values()).forEach((restore) => {
    restore()
  })
  scrollContainerRestores.clear()
  elementRects.clear()
}

afterEach(() => {
  cleanup()
  intersectionObserverMock.reset()
  resizeObserverMock.reset()
  resetElementGeometryMocks()
})

// Mock pointer capture API for JSDOM
if (typeof HTMLElement !== 'undefined') {
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
}
