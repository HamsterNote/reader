import type { ReaderSelectionRange } from '../../types/selection'

export function hasHighlightRects(
  rects: ReaderSelectionRange['rectsBySelectionId'] | undefined
): boolean {
  return Boolean(
    rects && Object.values(rects).some((pageRects) => pageRects.length > 0)
  )
}
