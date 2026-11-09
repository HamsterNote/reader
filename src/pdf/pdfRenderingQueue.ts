import type { PDFRenderingQueue } from 'pdfjs-dist/types/web/pdf_rendering_queue'
import type { PDFPageView } from 'pdfjs-dist/types/web/pdf_page_view'

// PDF.js declares the base class's initial id as null, but constructed page
// views (including detail views) carry their one-based PDF page number.
type PageView = Omit<PDFPageView, 'id'> & { id: number }
type VisiblePages = {
  views: { id: number; view: PageView }[]
}

/** Keep PDF.js priority rules, but make holes and neighbours refer to readable
 * pages. Only the priority metadata is renumbered; page views keep PDF page IDs. */
export function restrictPdfRenderingQueue(
  queue: PDFRenderingQueue,
  readablePages: () => readonly number[]
) {
  const getHighestPriority = queue.getHighestPriority.bind(queue)
  queue.getHighestPriority = (visible, views: PageView[], ...options) => {
    const pages = readablePages()
    if (pages.length === views.length)
      return getHighestPriority(visible, views, ...options)

    const candidates = pages.flatMap((page) =>
      views[page - 1] ? [views[page - 1]!] : []
    )
    const positions = new Map(
      candidates.map((view, index) => [view.id, index + 1])
    )
    const visibleViews = (visible as VisiblePages).views.flatMap((entry) => {
      const id = positions.get(entry.id)
      return id === undefined ? [] : [{ ...entry, id }]
    })
    // Visible views are sorted by visible area, not document order.
    let first = visibleViews[0]
    let last = first
    for (const entry of visibleViews) {
      if (entry.id < first!.id) first = entry
      if (entry.id > last!.id) last = entry
    }
    return getHighestPriority(
      {
        first,
        last,
        views: visibleViews,
        ids: new Set(visibleViews.map(({ id }) => id))
      },
      candidates,
      ...options
    )
  }

  const renderView = queue.renderView.bind(queue)
  queue.renderView = (view) => {
    // forceRendering awaits getPage before submitting the selected view. The
    // page may have been hidden in that interval; skip it and drain other work.
    // PDFPageDetailView has the same id as its owning PDFPageView.
    if (!readablePages().includes((view as PageView).id)) {
      queue.pdfViewer?.forceRendering(null)
      return false
    }
    return renderView(view)
  }
}
