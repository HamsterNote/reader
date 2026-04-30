import '@testing-library/jest-dom/vitest'
import { act, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

let observerInstances: MockIntersectionObserver[] = []

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

afterEach(() => {
  cleanup()
  intersectionObserverMock.reset()
})
