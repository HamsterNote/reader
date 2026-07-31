import { useMemo } from 'react'

import type { ReaderSelectionRange } from '../../types/selection'
import { parsePublicPageId } from './rangeJumpHelpers'

type ReadingProgressHighlightsProps = {
  readonly highlightColor?: string
  readonly pageNumbers: readonly number[]
  readonly ranges: readonly ReaderSelectionRange[]
}

const DEFAULT_HIGHLIGHT_COLOR = '#facc15'

export function ReadingProgressHighlights({
  highlightColor,
  pageNumbers,
  ranges
}: ReadingProgressHighlightsProps) {
  const markers = useMemo(() => {
    const colorByPageNumber = new Map<number, string>()
    ranges.forEach((range) => {
      const color =
        range.markerStyle?.backgroundColor ??
        highlightColor ??
        DEFAULT_HIGHLIGHT_COLOR
      const pageIds = new Set([
        range.start.selectionId,
        range.end.selectionId,
        ...Object.keys(range.rectsBySelectionId)
      ])
      pageIds.forEach((pageId) => {
        const pageNumber = parsePublicPageId(pageId)
        if (pageNumber !== null && pageNumbers.includes(pageNumber)) {
          colorByPageNumber.set(pageNumber, color)
        }
      })
    })
    return [...colorByPageNumber]
  }, [highlightColor, pageNumbers, ranges])

  return markers.map(([pageNumber, color]) => {
    const pageIndex = pageNumbers.indexOf(pageNumber)
    const top =
      pageNumbers.length <= 1 ? 0 : (pageIndex / (pageNumbers.length - 1)) * 100
    return (
      <span
        aria-hidden='true'
        className='hamster-reader__reading-progress-highlight'
        data-testid={`reading-progress-highlight-${pageNumber}`}
        key={pageNumber}
        style={{ backgroundColor: color, top: `${top}%` }}
      />
    )
  })
}
