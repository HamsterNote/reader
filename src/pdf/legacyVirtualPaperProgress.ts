import type {
  ReaderPagePositionBookmark,
  ReaderVirtualPaperState,
  ReaderPageEdgeCrop
} from '../types/readerData'
import {
  getPageCropGeometry,
  resolvePageEdgeCrop
} from '../components/IntermediateDocumentViewer/pageDisplay'

type LegacyPage = { pageNumber: number; width: number; height: number }

/** Read-only migration of the fixed-layout VirtualPaper readerMode geometry.
 * Pages share the widest cropped width; their 12 * scale vertical margins
 * collapse. The container's explicit top padding was inset / scale.
 * Horizontal pan/zoom are deliberately not carried into PDF.js's own layout.
 */
export function legacyVirtualPaperProgress(
  state: ReaderVirtualPaperState | undefined,
  pages: readonly LegacyPage[],
  topInset = 0,
  edgeCrop?: ReaderPageEdgeCrop
): ReaderPagePositionBookmark | undefined {
  if (
    !state ||
    !Number.isFinite(state.y) ||
    !Number.isFinite(state.x) ||
    !Number.isFinite(state.scale) ||
    state.scale <= 0 ||
    !pages.length
  )
    return undefined
  if (
    pages.some(
      (page) =>
        !Number.isFinite(page.width) ||
        page.width <= 0 ||
        !Number.isFinite(page.height) ||
        page.height <= 0
    )
  )
    return undefined
  const crops = pages.map((page) =>
    getPageCropGeometry(page, resolvePageEdgeCrop(edgeCrop, page.pageNumber))
  )
  const width = Math.max(...crops.map((crop) => crop.width))
  const scale = state.scale
  const safeTop = -state.y + topInset - topInset / scale
  let top = 12 * scale
  for (const [index, page] of pages.entries()) {
    const crop = crops[index]!
    const height = ((crop.height * width) / crop.width) * scale
    if (safeTop <= top + height || index === pages.length - 1)
      return {
        pageNumber: page.pageNumber,
        verticalPercentage: Math.min(
          100,
          Math.max(0, ((safeTop - top) / height) * 100)
        )
      }
    top += height + 12 * scale
  }
}
