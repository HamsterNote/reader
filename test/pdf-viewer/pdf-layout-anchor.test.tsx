import { act, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFViewer } from '../../src/pdf/pdfViewerLib'
import type { PDFDocumentProxy } from '../../src/pdf/pdfjsRuntime'
import type { PdfDocumentSource } from '../../src/pdf/pdfDocumentSession'
import type { ReaderPageEdgeCrop } from '../../src/types/readerData'
import { usePdfLayoutAnchor } from '../../src/pdf/usePdfLayoutAnchor'
import { resizeObserverMock } from '../setup'

const source: PdfDocumentSource = { url: 'first.pdf' }
const crop: ReaderPageEdgeCrop = {
  all: { top: 0.1, bottom: 0.2, left: 0.1, right: 0.1 }
}
type Layout = {
  crop?: ReaderPageEdgeCrop
  zoom: number
  insets: { top: number; bottom: number; horizontal: number }
  source: PdfDocumentSource
}
let frames: Map<number, FrameRequestCallback>
beforeEach(() => {
  frames = new Map()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => vi.unstubAllGlobals())
const settle = () =>
  act(() => {
    for (let frame = 0; frame < 2; frame++) {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(frame * 16))
    }
  })

function harness(rotated = false) {
  let lateOffset = 0
  let layout: Layout = {
    zoom: 1,
    insets: { top: 0, bottom: 0, horizontal: 0 },
    source
  }
  const container = document.createElement('div')
  container.getBoundingClientRect = () => new DOMRect(0, 0, 400, 250)
  container.scrollTop = 460
  const navigation = { current: null as unknown }
  const containerRef = { current: container }
  const pagesRef = { current: [1, 2, 3] }
  const documentRef = { current: {} as PDFDocumentProxy }
  const pageViews = [1, 2, 3].map((number) => {
    const div = document.createElement('div')
    container.append(div)
    const size = () => ({
      width: (rotated ? 300 : 400) * layout.zoom,
      height: (rotated ? 400 : 300) * layout.zoom
    })
    div.getBoundingClientRect = () => {
      const { width, height } = size()
      const edge = layout.crop?.all
      const visibleWidth = width * (1 - (edge?.left ?? 0) - (edge?.right ?? 0))
      const advance = height * (1 - (edge?.top ?? 0) - (edge?.bottom ?? 0)) + 10
      return new DOMRect(
        (Math.max(400, visibleWidth) - visibleWidth) / 2 -
          width * (edge?.left ?? 0) -
          container.scrollLeft,
        (number - 1) * advance +
          (number > 1 ? lateOffset : 0) -
          height * (edge?.top ?? 0) -
          container.scrollTop,
        width,
        height
      )
    }
    return {
      div,
      get viewport() {
        const scale = layout.zoom
        return {
          ...size(),
          // Nonzero native CropBox origin, PDF y goes up; 90° swaps axes.
          convertToPdfPoint: (x: number, y: number) =>
            rotated
              ? [40 + y / scale, 60 + x / scale]
              : [40 + x / scale, 360 - y / scale],
          convertToViewportPoint: (x: number, y: number) =>
            rotated
              ? [(y - 60) * scale, (x - 40) * scale]
              : [(x - 40) * scale, (360 - y) * scale]
        }
      }
    }
  })
  const viewer = {
    current: {
      getPageView: (index: number) => pageViews[index]
    } as unknown as PDFViewer
  }
  const onRestored = vi.fn()
  const view = renderHook(
    (next: Layout) => {
      const api = usePdfLayoutAnchor({
        ...next,
        crop: next.crop,
        viewer,
        container: containerRef,
        element: containerRef,
        document: documentRef,
        navigation,
        pages: pagesRef,
        onRestored
      })
      useLayoutEffect(() => {
        layout = next
        api.restoreAfterLayout()
      }, [next, api.restoreAfterLayout])
      return api
    },
    { initialProps: layout }
  )
  const point = () => {
    const page = pageViews[1]!
    const rect = page.div.getBoundingClientRect()
    return page.viewport.convertToPdfPoint(
      200 - rect.left,
      layout.insets.top - rect.top
    )
  }
  return {
    ...view,
    container,
    navigation,
    onRestored,
    point,
    initial: layout,
    shiftPriorPage: (offset: number) => {
      lateOffset = offset
    }
  }
}

describe('PDF coordinates survive layout changes', () => {
  it.each([false, true])(
    'preserves a non-page-start point through crop and fit scale (rotated=%s), without a text layer',
    (rotated) => {
      const view = harness(rotated)
      const before = view.point()
      view.rerender({ ...view.initial, crop, zoom: 2 })
      expect(view.result.current.isRestoring()).toBe(true)
      settle()
      view
        .point()
        .forEach((value, index) => expect(value).toBeCloseTo(before[index]!, 6))
      expect(view.onRestored).toHaveBeenCalledWith(2)
      expect(view.result.current.isRestoring()).toBe(false)
    }
  )

  it('uses one anchor for repeated toggles, top/bottom insets and rapid successive crop updates', () => {
    const view = harness()
    const before = view.point()
    for (let cycle = 0; cycle < 5; cycle++) {
      view.rerender({ ...view.initial, crop, zoom: 2 })
      view.rerender({
        ...view.initial,
        crop: { all: { top: 0.2, bottom: 0.1 } },
        zoom: 2
      })
      settle()
      view.rerender({
        ...view.initial,
        insets: { top: 40, bottom: 60, horizontal: 0 }
      })
      settle()
      view
        .point()
        .forEach((value, index) => expect(value).toBeCloseTo(before[index]!, 6))
    }
  })

  it('clamps a source point removed by a new crop to the nearest visible edge', () => {
    const view = harness()
    view.rerender({ ...view.initial, crop: { all: { top: 0.8 } } })
    settle()
    expect(view.point()[1]).toBeCloseTo(120)
  })

  it('corrects late canvas rounding on a preceding page, and lets a later programmatic scroll win', () => {
    const view = harness()
    const before = view.point()
    view.rerender({ ...view.initial, crop, zoom: 2 })
    settle()
    view.shiftPriorPage(-5)
    act(() => resizeObserverMock.trigger(view.container))
    settle()
    view
      .point()
      .forEach((value, index) => expect(value).toBeCloseTo(before[index]!, 6))
    view.container.scrollTop = 800
    act(() => view.container.dispatchEvent(new Event('scroll')))
    view.shiftPriorPage(-10)
    act(() => resizeObserverMock.trigger(view.container))
    settle()
    expect(view.container.scrollTop).toBe(800)
  })

  it('cancels restoration for a new document and for explicit user scrolling', () => {
    const view = harness()
    view.rerender({ ...view.initial, crop })
    view.rerender({ ...view.initial, crop, source: { url: 'second.pdf' } })
    expect(view.result.current.isRestoring()).toBe(false)
    view.container.scrollTop = 777
    settle()
    expect(view.container.scrollTop).toBe(777)
    view.rerender({ ...view.initial, crop })
    act(() => view.container.dispatchEvent(new WheelEvent('wheel')))
    view.container.scrollTop = 650
    settle()
    expect(view.container.scrollTop).toBe(650)
  })

  it('leaves an in-flight bookmark navigation in control and cancels frames on unmount', () => {
    const view = harness()
    view.navigation.current = { bookmark: true }
    view.rerender({ ...view.initial, crop })
    expect(view.result.current.isRestoring()).toBe(false)
    view.navigation.current = null
    view.rerender(view.initial)
    expect(frames.size).toBe(1)
    view.unmount()
    expect(frames.size).toBe(0)
  })
})
