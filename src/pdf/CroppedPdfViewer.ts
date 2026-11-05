import { PDFViewer } from './pdfViewerLib'
import type { ReaderPageEdgeCrop } from '../types/readerData'
import {
  getPageCropGeometry,
  resolvePageEdgeCrop
} from '../components/IntermediateDocumentViewer/pageDisplay'

type PageView = {
  id: number
  div: HTMLElement
  viewport: { width: number; height: number }
}
type CropLayout = {
  crop: () => ReaderPageEdgeCrop | undefined
  pages: () => readonly number[]
}

/** PDF.js 5.4 visibility contract. Percentages use the displayed crop box;
 * x/y and visibleArea stay in the original page/canvas coordinate system. */
export function getCroppedVisiblePages<T extends PageView>(
  container: HTMLElement,
  pages: readonly number[],
  getPage: (pageNumber: number) => T | undefined,
  crop: ReaderPageEdgeCrop
) {
  const host = container.getBoundingClientRect()
  const top = host.top + container.clientTop
  const left = host.left + container.clientLeft
  const bottom = top + container.clientHeight
  const right = left + container.clientWidth
  const pageBox = (index: number) => {
    const view = getPage(pages[index]!)
    if (!view || view.div.style.display === 'none') return null
    const rect = view.div.getBoundingClientRect()
    const geometry = getPageCropGeometry(
      view.viewport,
      resolvePageEdgeCrop(crop, view.id)
    )
    return {
      view,
      rect,
      top: rect.top + geometry.top,
      bottom: rect.bottom - geometry.bottom,
      left: rect.left + geometry.left,
      right: rect.right - geometry.right
    }
  }
  // Cropped flex footprints, unlike full page boxes, form ordered vertical
  // intervals. Only measure O(log pages + visible pages) DOM rectangles.
  let start = 0
  let end = pages.length
  while (start < end) {
    const middle = (start + end) >>> 1
    const box = pageBox(middle)
    if (box && box.bottom <= top) start = middle + 1
    else end = middle
  }
  const views = []
  const ids = new Set<number>()
  for (let index = start; index < pages.length; index++) {
    const box = pageBox(index)
    if (!box) continue
    if (box.top >= bottom) break
    const x1 = Math.max(left, box.left)
    const y1 = Math.max(top, box.top)
    const x2 = Math.min(right, box.right)
    const y2 = Math.min(bottom, box.bottom)
    if (x2 <= x1 || y2 <= y1) continue
    // clip-path insets are viewport pixels; the DOM page can be smaller after
    // PDF.js canvas rounding. Subtract those same insets from its actual box.
    const widthFraction = (x2 - x1) / (box.right - box.left)
    const heightFraction = (y2 - y1) / (box.bottom - box.top)
    views.push({
      id: box.view.id,
      view: box.view,
      x: box.rect.left - left + container.scrollLeft,
      y: box.rect.top - top + container.scrollTop,
      percent: Math.floor(widthFraction * heightFraction * 100),
      widthPercent: Math.floor(widthFraction * 100),
      visibleArea: {
        minX: x1 - box.rect.left,
        minY: y1 - box.rect.top,
        maxX: x2 - box.rect.left,
        maxY: y2 - box.rect.top
      }
    })
    ids.add(box.view.id)
  }
  const first = views[0]
  const last = views.at(-1)
  views.sort((a, b) => b.percent - a.percent || a.id - b.id)
  return { first, last, views, ids }
}

/** Reader uses vertical layout. Override the shared PDF.js visibility entry so
 * rendering priority, current page, find and page advance see the same crop. */
export class CroppedPdfViewer extends PDFViewer {
  constructor(
    options: ConstructorParameters<typeof PDFViewer>[0],
    private readonly cropLayout?: CropLayout
  ) {
    super(options)
  }

  override _getVisiblePages() {
    const crop = this.cropLayout?.crop()
    if (!crop || this.scrollMode !== 0) return super._getVisiblePages()
    return getCroppedVisiblePages(
      this.container,
      this.cropLayout!.pages(),
      (number) => this.getPageView(number - 1) as PageView | undefined,
      crop
    )
  }

  private alignCroppedPage(pageNumber: number) {
    const crop = this.cropLayout?.crop()
    if (!crop || this.scrollMode !== 0) return
    const page = this.getPageView(pageNumber - 1) as PageView | undefined
    if (!page || page.div.style.display === 'none') return
    const rect = page.div.getBoundingClientRect()
    const host = this.container.getBoundingClientRect()
    const geometry = getPageCropGeometry(
      page.viewport,
      resolvePageEdgeCrop(crop, pageNumber)
    )
    if (!geometry.top && !geometry.right && !geometry.bottom && !geometry.left)
      return
    this.container.scrollTop +=
      rect.top + geometry.top - host.top - this.container.clientTop
    if (
      rect.width - geometry.left - geometry.right >
      this.container.clientWidth
    )
      this.container.scrollLeft +=
        rect.left + geometry.left - host.left - this.container.clientLeft
  }

  // Native nextPage/previousPage use this setter. A full-page origin can lie
  // inside the previous cropped page, causing update() to select it again.
  override get currentPageNumber() {
    return super.currentPageNumber
  }

  override set currentPageNumber(number: number) {
    super.currentPageNumber = number
    this.alignCroppedPage(this.currentPageNumber)
  }

  override scrollPageIntoView(
    options: Parameters<PDFViewer['scrollPageIntoView']>[0]
  ) {
    super.scrollPageIntoView(options)
    // Explicit PDF destinations retain their original content coordinates.
    if (!options.destArray) this.alignCroppedPage(options.pageNumber)
  }
}
