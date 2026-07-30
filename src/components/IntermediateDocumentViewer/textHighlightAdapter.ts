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

  const start = resolveTextPoint(content, startOffset)
  const end = resolveTextPoint(content, endOffset ?? getTextLength(content))
  if (!start || !end) return undefined

  const textRange = content.ownerDocument.createRange()
  textRange.setStart(start.node, start.offset)
  textRange.setEnd(end.node, end.offset)
  if (typeof textRange.getClientRects !== 'function') return undefined

  const bounds = container.getBoundingClientRect()
  const pixelRects: OverlayRect[] = Array.from(textRange.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: rect.left - bounds.left,
      y: rect.top - bounds.top,
      width: rect.width,
      height: rect.height
    }))
  return overlayRectType === 'percent'
    ? pixelRectsToPercentRects(pixelRects, container)
    : pixelRects
}

function getTextLength(root: HTMLElement): number {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let length = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text) length += node.data.length
  }
  return length
}

function resolveTextPoint(
  root: HTMLElement,
  textIndex: number
): TextPoint | null {
  if (!Number.isInteger(textIndex) || textIndex < 0) return null

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
