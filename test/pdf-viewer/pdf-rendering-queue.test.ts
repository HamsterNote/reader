import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../../src/pdf/pdfViewerLib'
import { CroppedPdfViewer } from '../../src/pdf/CroppedPdfViewer'
import { RenderingStates } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { PDFPageView } from 'pdfjs-dist/types/web/pdf_page_view'

function fixture(initialPages = [1, 5]) {
  let pages = initialPages
  const viewer = new CroppedPdfViewer(
    {
      container: document.createElement('div'),
      viewer: document.createElement('div'),
      eventBus: new EventBus()
    },
    { crop: () => undefined, pages: () => pages }
  )
  const queue = viewer.renderingQueue!
  const views = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    renderingId: `page${index + 1}`,
    renderingState: RenderingStates.INITIAL,
    draw: vi.fn(() => Promise.resolve()),
    resume: vi.fn(),
    detailView: null as unknown
  }))
  const pick = (
    ids: number[],
    forward = true,
    extra = false,
    ignoreDetails = false
  ) => {
    const visible = ids.map((id) => ({ id, view: views[id - 1]! }))
    return queue.getHighestPriority(
      {
        views: visible,
        first: visible.find((entry) => entry.id === Math.min(...ids)),
        last: visible.find((entry) => entry.id === Math.max(...ids)),
        ids: new Set(ids)
      },
      views,
      forward,
      extra,
      ignoreDetails
    )
  }
  return {
    queue,
    viewer,
    views,
    pick,
    setPages: (next: number[]) => {
      pages = next
    }
  }
}

describe('PDF.js scheduling over readable pages', () => {
  it.each([true, false])(
    'prefetches past hidden neighbours, forward=%s',
    (forward) => {
      const { views, pick } = fixture()
      const current = forward ? 1 : 5
      views[current - 1]!.renderingState = RenderingStates.FINISHED
      expect(pick([current], forward)).toBe(views[forward ? 4 : 0])
    }
  )

  it('excludes hidden holes but still fills readable holes', () => {
    const { views, pick, setPages } = fixture()
    views[0]!.renderingState = views[4]!.renderingState =
      RenderingStates.FINISHED
    expect(pick([1, 5])).toBeNull()
    setPages([1, 3, 5])
    expect(pick([1, 5])).toBe(views[2])
  })

  it('keeps visible-area priority and skips stale hidden visibility entries', () => {
    const { views, pick } = fixture()
    expect(pick([3, 5, 1])).toBe(views[4])
    views[4]!.renderingState = RenderingStates.FINISHED
    expect(pick([3, 5, 1])).toBe(views[0])
  })

  it('preserves extra prefetch and detail-view priorities', () => {
    const { views, pick } = fixture([1, 3, 5])
    views[0]!.renderingState = views[2]!.renderingState =
      RenderingStates.FINISHED
    expect(pick([1], true, true)).toBe(views[4])
    const detail = { id: 1, renderingState: RenderingStates.INITIAL }
    views[0]!.detailView = detail
    expect(pick([1], true, true)).toBe(detail)
    expect(pick([1], true, true, true)).toBe(views[4])
  })

  it('handles an entirely hidden document and resumes priority when restored', () => {
    const { views, pick, setPages } = fixture([])
    expect(pick([1])).toBeNull()
    setPages([1, 2, 3, 4, 5])
    expect(pick([1])).toBe(views[0])
  })

  it.each([RenderingStates.INITIAL, RenderingStates.PAUSED])(
    'rejects a candidate hidden while loading, without starving the viewer (state=%s)',
    (state) => {
      const { queue, viewer, views, pick, setPages } = fixture()
      const selected = pick([1])
      views[0]!.renderingState = state
      setPages([5])
      const schedule = vi
        .spyOn(viewer, 'forceRendering')
        .mockImplementation(() => {
          expect(pick([5])).toBe(views[4])
          return true
        })
      expect(queue.renderView(selected as PDFPageView)).toBe(false)
      expect(views[0]!.draw).not.toHaveBeenCalled()
      expect(views[0]!.resume).not.toHaveBeenCalled()
      expect(schedule).toHaveBeenCalledOnce()
    }
  )
})
