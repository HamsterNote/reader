import type { IntermediateText } from '@hamster-note/types'
import { TextDir } from '@hamster-note/types'

import type {
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRect
} from '../../types/selection'
import { getTextBbox } from './pageContentGeometry'
import { parsePublicPageId } from './rangeJumpHelpers'
import { deriveDomSelectionPageRects } from './textHighlightAdapter'
import {
  getTextLogicalLines,
  measureLongestTextLineWidth,
  measureTextWidth
} from './textSpanStyle'

type PageSize = {
  readonly width: number
  readonly height: number
}

export type DeriveLayoutSelectionRangeInput = {
  readonly range: ReaderSelectionRange
  readonly root?: HTMLElement | null
  readonly flowLayoutPages?: ReadonlySet<number>
  readonly textsByPageNumber: ReadonlyMap<number, readonly IntermediateText[]>
  readonly pageSizesByPageNumber: ReadonlyMap<number, PageSize>
  readonly overlayRectType: ReaderSelectionOverlayRectType
}

function parsePageRange(
  range: ReaderSelectionRange
): readonly [startPageNumber: number, endPageNumber: number] | null {
  const startPageNumber = parsePublicPageId(range.start.selectionId)
  const endPageNumber = parsePublicPageId(range.end.selectionId)
  if (
    startPageNumber === null ||
    endPageNumber === null ||
    endPageNumber < startPageNumber
  ) {
    return null
  }
  return [startPageNumber, endPageNumber]
}

function deriveLayoutPageRects({
  pageNumber,
  startPageNumber,
  endPageNumber,
  range,
  root,
  flowLayoutPages,
  textsByPageNumber,
  pageSizesByPageNumber,
  overlayRectType
}: DeriveLayoutSelectionRangeInput & {
  readonly pageNumber: number
  readonly startPageNumber: number
  readonly endPageNumber: number
}): ReaderSelectionRect[] | null {
  const startOffset = pageNumber === startPageNumber ? range.start.offset : 0
  const endOffset = pageNumber === endPageNumber ? range.end.offset : undefined
  if (root && flowLayoutPages?.has(pageNumber)) {
    return (
      deriveDomSelectionPageRects({
        root,
        pageSelector: `[data-testid="intermediate-page-${pageNumber}"]`,
        startOffset,
        endOffset,
        overlayRectType
      }) ?? null
    )
  }

  const texts = textsByPageNumber.get(pageNumber)
  const pageSize = pageSizesByPageNumber.get(pageNumber)
  if (!texts || !pageSize) return null

  const fixedLayoutEndOffset =
    endOffset ?? texts.reduce((length, text) => length + text.content.length, 0)
  const pixelRects = derivePageRects(texts, startOffset, fixedLayoutEndOffset)
  return overlayRectType === 'percent'
    ? pixelRects.map((rect) => toPercentRect(rect, pageSize))
    : pixelRects
}

export function deriveLayoutSelectionRange({
  range,
  root,
  flowLayoutPages,
  textsByPageNumber,
  pageSizesByPageNumber,
  overlayRectType
}: DeriveLayoutSelectionRangeInput): ReaderSelectionRange {
  const pageRange = parsePageRange(range)
  if (!pageRange) return range
  const [startPageNumber, endPageNumber] = pageRange

  const rectsBySelectionId: ReaderSelectionRange['rectsBySelectionId'] = {}
  for (
    let pageNumber = startPageNumber;
    pageNumber <= endPageNumber;
    pageNumber += 1
  ) {
    const pageId = `page-${pageNumber}`
    const pageRects = deriveLayoutPageRects({
      pageNumber,
      startPageNumber,
      endPageNumber,
      range,
      root,
      flowLayoutPages,
      textsByPageNumber,
      pageSizesByPageNumber,
      overlayRectType
    })
    if (pageRects) rectsBySelectionId[pageId] = pageRects
  }

  return {
    ...range,
    overlayRectType,
    rectsBySelectionId
  }
}

function derivePageRects(
  texts: readonly IntermediateText[],
  startOffset: number,
  endOffset: number
): ReaderSelectionRect[] {
  if (startOffset < 0 || endOffset <= startOffset) return []

  const rects: ReaderSelectionRect[] = []
  let textStart = 0
  for (const text of texts) {
    const textEnd = textStart + text.content.length
    const selectedStart = Math.max(startOffset, textStart)
    const selectedEnd = Math.min(endOffset, textEnd)
    if (selectedEnd > selectedStart && text.content.length > 0) {
      rects.push(
        ...sliceTextRects(
          text,
          selectedStart - textStart,
          selectedEnd - textStart
        )
      )
    }
    textStart = textEnd
    if (textStart >= endOffset) break
  }
  return rects
}

function sliceTextRects(
  text: IntermediateText,
  startOffset: number,
  endOffset: number
): ReaderSelectionRect[] {
  const bbox = getTextBbox(text)
  if (text.vertical || text.dir === TextDir.TTB) {
    const startRatio = startOffset / text.content.length
    const endRatio = endOffset / text.content.length
    return [
      {
        x: bbox.x,
        y: bbox.y + bbox.height * startRatio,
        width: bbox.width,
        height: bbox.height * (endRatio - startRatio)
      }
    ]
  }

  const lines = getTextLogicalLines(text.content)
  const lineHeight = bbox.height / lines.length
  const measuredTextWidth = measureLongestTextLineWidth(text)
  const fallbackTextLength = lines.reduce(
    (longestLength, line) => Math.max(longestLength, line.content.length),
    0
  )

  return lines.flatMap((line, lineIndex) => {
    const selectedStart = Math.max(startOffset, line.startOffset)
    const selectedEnd = Math.min(endOffset, line.endOffset)
    if (selectedEnd <= selectedStart) return []

    const relativeStart = selectedStart - line.startOffset
    const relativeEnd = selectedEnd - line.startOffset
    const measuredStart = measureTextWidth(
      text,
      line.content.slice(0, relativeStart)
    )
    const measuredEnd = measureTextWidth(
      text,
      line.content.slice(0, relativeEnd)
    )
    let startRatio = 0
    let endRatio = 0
    if (
      measuredTextWidth !== null &&
      measuredStart !== null &&
      measuredEnd !== null
    ) {
      startRatio = measuredStart / measuredTextWidth
      endRatio = measuredEnd / measuredTextWidth
    } else if (fallbackTextLength > 0) {
      startRatio = relativeStart / fallbackTextLength
      endRatio = relativeEnd / fallbackTextLength
    }
    const y = bbox.y + lineHeight * lineIndex

    if (text.dir === TextDir.RTL) {
      return [
        {
          x: bbox.x + bbox.width * (1 - endRatio),
          y,
          width: bbox.width * (endRatio - startRatio),
          height: lineHeight
        }
      ]
    }

    return [
      {
        x: bbox.x + bbox.width * startRatio,
        y,
        width: bbox.width * (endRatio - startRatio),
        height: lineHeight
      }
    ]
  })
}

function toPercentRect(
  rect: ReaderSelectionRect,
  pageSize: PageSize
): ReaderSelectionRect {
  if (pageSize.width <= 0 || pageSize.height <= 0) return rect
  return {
    x: (rect.x / pageSize.width) * 100,
    y: (rect.y / pageSize.height) * 100,
    width: (rect.width / pageSize.width) * 100,
    height: (rect.height / pageSize.height) * 100
  }
}
