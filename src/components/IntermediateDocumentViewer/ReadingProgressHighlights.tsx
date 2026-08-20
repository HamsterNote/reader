import { useMemo } from 'react'

import type { ReaderSelectionRange } from '../../types/selection'
import { parsePublicPageId } from './rangeJumpHelpers'
import { resolveTextHighlightSegmentPosition } from './textPageWindow'

type ReadingProgressHighlightsProps = {
  readonly highlightColor?: string
  readonly mode: 'layout' | 'text'
  readonly pageNumbers: readonly number[]
  readonly ranges: readonly ReaderSelectionRange[]
}

const DEFAULT_HIGHLIGHT_COLOR = '#facc15'

const getHighlightPosition = (
  mode: ReadingProgressHighlightsProps['mode'],
  pageNumbers: readonly number[],
  pageIndexByNumber: ReadonlyMap<number, number>,
  pageNumber: number
): number => {
  if (mode === 'text') {
    return resolveTextHighlightSegmentPosition(pageNumbers, pageNumber)
  }
  if (pageNumbers.length <= 1) return 0
  return (
    ((pageIndexByNumber.get(pageNumber) ?? 0) / (pageNumbers.length - 1)) * 100
  )
}

const getRangePageNumbers = (
  mode: ReadingProgressHighlightsProps['mode'],
  pageNumbers: readonly number[],
  range: ReaderSelectionRange
): readonly number[] => {
  const explicitPageNumbers = Object.keys(range.rectsBySelectionId).flatMap(
    (pageId) => {
      const pageNumber = parsePublicPageId(pageId)
      return pageNumber === null ? [] : [pageNumber]
    }
  )
  const startPageNumber = parsePublicPageId(range.start.selectionId)
  const endPageNumber = parsePublicPageId(range.end.selectionId)
  if (mode !== 'text' || startPageNumber === null || endPageNumber === null) {
    return [startPageNumber, endPageNumber, ...explicitPageNumbers].filter(
      (pageNumber): pageNumber is number => pageNumber !== null
    )
  }

  const startIndex = pageNumbers.indexOf(startPageNumber)
  const endIndex = pageNumbers.indexOf(endPageNumber)
  if (startIndex === -1 || endIndex < startIndex) return explicitPageNumbers
  return [
    ...pageNumbers.slice(startIndex, endIndex + 1),
    ...explicitPageNumbers
  ]
}

export function ReadingProgressHighlights({
  highlightColor,
  mode,
  pageNumbers,
  ranges
}: ReadingProgressHighlightsProps) {
  const markers = useMemo(() => {
    const colorByPageNumber = new Map<number, string>()
    const pageNumberSet = new Set(pageNumbers)
    ranges.forEach((range) => {
      const color =
        range.markerStyle?.backgroundColor ??
        highlightColor ??
        DEFAULT_HIGHLIGHT_COLOR
      const rangePageNumbers = new Set(
        getRangePageNumbers(mode, pageNumbers, range)
      )
      rangePageNumbers.forEach((pageNumber) => {
        if (pageNumberSet.has(pageNumber)) {
          colorByPageNumber.set(pageNumber, color)
        }
      })
    })
    return [...colorByPageNumber]
  }, [highlightColor, mode, pageNumbers, ranges])

  const pageIndexByNumber = useMemo(
    () => new Map(pageNumbers.map((pageNumber, index) => [pageNumber, index])),
    [pageNumbers]
  )

  return markers.map(([pageNumber, color]) => {
    const top = getHighlightPosition(
      mode,
      pageNumbers,
      pageIndexByNumber,
      pageNumber
    )
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
