import {
  type OverlayRect,
  pixelRectsToPercentRects
} from '@hamster-note/selection'

import type {
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange
} from '../../types/selection'

export type DeriveTextSelectionRangesInput = {
  readonly ranges: readonly ReaderSelectionRange[]
  readonly root: HTMLElement | null
  readonly pageNumbers: readonly number[]
  readonly overlayRectType: ReaderSelectionOverlayRectType
}

export type DeriveDomSelectionPageRectsInput = {
  readonly root: HTMLElement
  readonly pageSelector: string
  readonly startOffset: number
  readonly endOffset?: number
  readonly overlayRectType: ReaderSelectionOverlayRectType
}

export function deriveTextSelectionRanges({
  ranges,
  root,
  pageNumbers,
  overlayRectType
}: DeriveTextSelectionRangesInput): ReaderSelectionRange[] {
  return ranges.map((range) => {
    const derivedTextRects = deriveRectsByPage({
      range,
      root,
      pageNumbers,
      overlayRectType
    })
    return {
      ...range,
      overlayRectType,
      rectsBySelectionId: derivedTextRects
    }
  })
}

type TextPoint = {
  readonly node: Text
  readonly offset: number
}

type AnchoredTextSegment = {
  readonly element: HTMLElement
  readonly startOffset: number
  readonly endOffset: number
}

function deriveRectsByPage({
  range,
  root,
  pageNumbers,
  overlayRectType
}: {
  readonly range: ReaderSelectionRange
  readonly root: HTMLElement | null
  readonly pageNumbers: readonly number[]
  readonly overlayRectType: ReaderSelectionOverlayRectType
}): ReaderSelectionRange['rectsBySelectionId'] {
  if (!root) return {}

  const startPageIndex = pageNumbers.findIndex(
    (pageNumber) => `page-${pageNumber}` === range.start.selectionId
  )
  const endPageIndex = pageNumbers.findIndex(
    (pageNumber) => `page-${pageNumber}` === range.end.selectionId
  )
  if (startPageIndex === -1 || endPageIndex < startPageIndex) return {}

  const rectsByPage: ReaderSelectionRange['rectsBySelectionId'] = {}
  pageNumbers
    .slice(startPageIndex, endPageIndex + 1)
    .forEach((pageNumber, offset) => {
      const pageId = `page-${pageNumber}`
      const pageIndex = startPageIndex + offset
      const startIndex = pageIndex === startPageIndex ? range.start.offset : 0
      const endIndex = pageIndex === endPageIndex ? range.end.offset : undefined
      const rects = deriveDomSelectionPageRects({
        root,
        pageSelector: `[data-testid="intermediate-text-page-${pageNumber}"]`,
        startOffset: startIndex,
        endOffset: endIndex,
        overlayRectType
      })
      if (rects) rectsByPage[pageId] = rects
    })

  return rectsByPage
}

export function deriveDomSelectionPageRects({
  root,
  pageSelector,
  startOffset,
  endOffset,
  overlayRectType
}: DeriveDomSelectionPageRectsInput): OverlayRect[] | undefined {
  const pageElement = root.querySelector<HTMLElement>(pageSelector)
  const container = pageElement?.querySelector<HTMLElement>(
    '.hsn-selection-container'
  )
  const content = container?.querySelector<HTMLElement>(
    '.hsn-selection-content'
  )
  if (!container || !content) return undefined

  const anchoredSegments = getAnchoredTextSegments(content)
  const textLength =
    anchoredSegments.length > 0
      ? Math.max(...anchoredSegments.map((segment) => segment.endOffset))
      : getTextNodeLength(content)
  const resolvedEndOffset = endOffset ?? textLength
  if (
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(resolvedEndOffset) ||
    startOffset < 0 ||
    resolvedEndOffset < startOffset ||
    resolvedEndOffset > textLength
  ) {
    return undefined
  }

  const textRanges =
    anchoredSegments.length > 0
      ? anchoredSegments.flatMap((segment) => {
          const intersectionStart = Math.max(startOffset, segment.startOffset)
          const intersectionEnd = Math.min(resolvedEndOffset, segment.endOffset)
          if (intersectionStart >= intersectionEnd) return []

          const textRange = createTextRange(
            segment.element,
            intersectionStart - segment.startOffset,
            intersectionEnd - segment.startOffset
          )
          return textRange ? [textRange] : []
        })
      : [createTextRange(content, startOffset, resolvedEndOffset)].filter(
          (textRange) => textRange !== null
        )
  if (textRanges.some((textRange) => !textRange.getClientRects)) {
    return undefined
  }

  const bounds = container.getBoundingClientRect()
  const pixelRects: OverlayRect[] = textRanges.flatMap((textRange) =>
    Array.from(textRange.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height
      }))
  )
  return overlayRectType === 'percent'
    ? pixelRectsToPercentRects(pixelRects, container)
    : pixelRects
}

function getAnchoredTextSegments(root: HTMLElement): AnchoredTextSegment[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-selection-start-offset]')
  ).flatMap((element) => {
    const rawOffset = element.dataset.selectionStartOffset
    if (!rawOffset || !/^(0|[1-9]\d*)$/.test(rawOffset)) return []

    const startOffset = Number(rawOffset)
    const textLength = getTextNodeLength(element)
    if (!Number.isSafeInteger(startOffset) || textLength === 0) return []
    return [
      {
        element,
        startOffset,
        endOffset: startOffset + textLength
      }
    ]
  })
}

function createTextRange(
  root: HTMLElement,
  startOffset: number,
  endOffset: number
): Range | null {
  const start = resolveTextNodePoint(root, startOffset)
  const end = resolveTextNodePoint(root, endOffset)
  if (!start || !end) return null

  const textRange = root.ownerDocument.createRange()
  textRange.setStart(start.node, start.offset)
  textRange.setEnd(end.node, end.offset)
  return textRange
}

function getTextNodeLength(root: HTMLElement): number {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let length = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text) length += node.data.length
  }
  return length
}

function resolveTextNodePoint(
  root: HTMLElement,
  textIndex: number
): TextPoint | null {
  if (!Number.isSafeInteger(textIndex) || textIndex < 0) return null

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let traversed = 0
  let lastTextNode: Text | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!(node instanceof Text)) continue
    lastTextNode = node
    const nextTraversed = traversed + node.data.length
    if (textIndex <= nextTraversed) {
      return { node, offset: textIndex - traversed }
    }
    traversed = nextTraversed
  }

  return textIndex === traversed && lastTextNode
    ? { node: lastTextNode, offset: lastTextNode.data.length }
    : null
}
