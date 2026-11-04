import { describe, expect, it } from 'vitest'
import { getCroppedVisiblePages } from '../../src/pdf/CroppedPdfViewer'
import type { ReaderPageEdgeCrop } from '../../src/types/readerData'

function fixture(rectangles: DOMRect[], height = 300) {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, height)
  Object.defineProperties(container, {
    clientWidth: { value: 1000 },
    clientHeight: { value: height }
  })
  const views = rectangles.map((rect, index) => {
    const div = document.createElement('div')
    div.getBoundingClientRect = () => rect
    return {
      id: index + 1,
      div,
      viewport: { width: rect.width, height: rect.height }
    }
  })
  const visible = (
    crop: ReaderPageEdgeCrop,
    pages = views.map((view) => view.id)
  ) => getCroppedVisiblePages(container, pages, (id) => views[id - 1], crop)
  return { container, views, visible }
}

describe('cropped PDF visibility uses displayed area with original coordinates', () => {
  it('excludes the preceding clipped tail and keeps canvas/location coordinates', () => {
    const { container, views, visible } = fixture([
      new DOMRect(-60, -1370, 1200, 1600),
      new DOMRect(-60, -160, 1200, 1600)
    ])
    container.scrollTop = 1210
    const result = visible({
      all: { top: 0.1, bottom: 0.15, left: 0.05, right: 0.2 }
    })
    expect([...result.ids]).toEqual([2])
    expect(result.first).toBe(result.last)
    expect(result.views[0]).toEqual({
      id: 2,
      view: views[1],
      x: -60,
      y: 1050,
      percent: 25,
      widthPercent: 100,
      visibleArea: { minX: 60, minY: 160, maxX: 960, maxY: 460 }
    })
  })

  it('sorts by crop-relative area while retaining document-order first and last', () => {
    const { visible } = fixture([
      new DOMRect(0, -150, 200, 400),
      new DOMRect(0, 60, 200, 400)
    ])
    const result = visible({ pages: { 'page-1': { bottom: 0.5 } } })
    expect(result.views.map(({ id, percent }) => ({ id, percent }))).toEqual([
      { id: 2, percent: 60 },
      { id: 1, percent: 25 }
    ])
    expect(result.first?.id).toBe(1)
    expect(result.last?.id).toBe(2)
  })

  it('counts a fully displayed crop as 100% but reports its full-page canvas area', () => {
    const { visible } = fixture([new DOMRect(-50, -100, 500, 500)])
    expect(
      visible({ all: { top: 0.2, bottom: 0.2, left: 0.1, right: 0.1 } })
        .views[0]
    ).toMatchObject({
      percent: 100,
      widthPercent: 100,
      visibleArea: { minX: 50, minY: 100, maxX: 450, maxY: 400 }
    })
  })

  it('omits hidden/disallowed pages and horizontally clipped intersections', () => {
    const { views, visible } = fixture([
      new DOMRect(0, 0, 500, 500),
      new DOMRect(-500, 0, 500, 500),
      new DOMRect(0, 0, 500, 500)
    ])
    views[0]!.div.style.display = 'none'
    expect([...visible({ all: { left: 0.1 } }, [1, 2]).ids]).toEqual([])
  })

  it('uses the actual clip insets when canvas rounding shrinks the DOM page', () => {
    const { views, visible } = fixture([new DOMRect(-50, -100, 499, 499)])
    views[0]!.viewport = { width: 500, height: 500 }
    expect(
      visible({ all: { top: 0.2, bottom: 0.2, left: 0.1, right: 0.1 } })
        .views[0]
    ).toMatchObject({
      percent: 100,
      visibleArea: { minX: 50, minY: 100, maxX: 449, maxY: 399 }
    })
  })

  it('finds a page in a long document without measuring every page', () => {
    const { views, visible } = fixture(
      Array.from(
        { length: 1000 },
        (_, index) => new DOMRect(0, (index - 699) * 1000, 500, 1000)
      )
    )
    let measurements = 0
    for (const view of views) {
      const rect = view.div.getBoundingClientRect()
      view.div.getBoundingClientRect = () => {
        measurements++
        return rect
      }
    }
    expect([...visible({ all: { top: 0.1, bottom: 0.1 } }).ids]).toEqual([700])
    expect(measurements).toBeLessThan(20)
  })
})
