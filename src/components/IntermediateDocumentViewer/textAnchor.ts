import type { IntermediateText } from '@hamster-note/types'

import type { ReaderBookmark, ReaderTextAnchor } from '../../types/readerData'

type AnchorText = Pick<IntermediateText, 'id' | 'content'>

export type TextAnchorElementRecord<Text extends AnchorText = AnchorText> = {
  readonly text: Text
  readonly pageNumber: number
  readonly element: HTMLSpanElement
}

export function getTextAnchorKey(anchor: ReaderTextAnchor): string {
  return `${anchor.pageNumber}:${anchor.textId}:${anchor.offset}`
}

export function isTextBookmark(
  bookmark: ReaderBookmark
): bookmark is ReaderTextAnchor {
  return 'textId' in bookmark
}

export function getBookmarkKey(bookmark: ReaderBookmark): string {
  return isTextBookmark(bookmark)
    ? getTextAnchorKey(bookmark)
    : `page:${bookmark.pageNumber}:${bookmark.verticalPercentage}`
}

export function getActiveBookmarkKey(
  bookmark: ReaderBookmark | undefined,
  fallbackKey: string | undefined,
  bookmarks: readonly ReaderBookmark[] | undefined
): string | undefined {
  const currentKey = bookmark ? getBookmarkKey(bookmark) : fallbackKey
  if (!currentKey) return undefined
  return bookmarks?.some((item) => getBookmarkKey(item) === currentKey)
    ? currentKey
    : undefined
}

export function hasAnchorableText(
  texts: readonly AnchorText[] | undefined
): boolean {
  return texts?.some((text) => text.content.length > 0) ?? false
}

export function resolveBookmarkNavigationHandler(
  bookmarks: readonly ReaderBookmark[] | undefined,
  onToggleBookmark: ((bookmark: ReaderBookmark) => void) | undefined,
  navigateToBookmark: (bookmark: ReaderBookmark) => void
): ((bookmark: ReaderBookmark) => void) | undefined {
  if (bookmarks === undefined && onToggleBookmark === undefined) {
    return undefined
  }
  return navigateToBookmark
}

function getPageTextOffset(
  texts: readonly AnchorText[],
  targetTextId: string
): number | null {
  let offset = 0
  for (const text of texts) {
    if (text.id === targetTextId) return offset
    offset += text.content.length
  }
  return null
}

function resolveTextIdAtOffset(
  texts: readonly AnchorText[],
  offset: number
): string | null {
  if (texts.length === 0) return null

  const normalizedOffset = Math.max(0, offset)
  let currentOffset = 0
  for (const text of texts) {
    const nextOffset = currentOffset + text.content.length
    if (normalizedOffset < nextOffset) return text.id
    currentOffset = nextOffset
  }

  return texts[texts.length - 1]?.id ?? null
}

export function resolveTextAnchorElement(
  anchor: ReaderTextAnchor,
  records: ReadonlyMap<string, TextAnchorElementRecord>,
  textsByPageNumber: ReadonlyMap<number, readonly AnchorText[]>
): HTMLSpanElement | null {
  const idRecord = records.get(anchor.textId)
  if (idRecord?.pageNumber === anchor.pageNumber) return idRecord.element

  const pageTexts = textsByPageNumber.get(anchor.pageNumber)
  if (!pageTexts) return null
  const fallbackTextId = resolveTextIdAtOffset(pageTexts, anchor.offset)
  if (!fallbackTextId) return null

  const fallbackRecord = records.get(fallbackTextId)
  return fallbackRecord?.pageNumber === anchor.pageNumber
    ? fallbackRecord.element
    : null
}

export function findTopTextAnchor(
  viewport: HTMLElement,
  records: ReadonlyMap<string, TextAnchorElementRecord>,
  textsByPageNumber: ReadonlyMap<number, readonly AnchorText[]>,
  pageNumber?: number
): ReaderTextAnchor | null {
  const viewportRect = viewport.getBoundingClientRect()
  let closestRecord: TextAnchorElementRecord | null = null
  let closestTop = Number.POSITIVE_INFINITY

  records.forEach((record) => {
    if (pageNumber !== undefined && record.pageNumber !== pageNumber) return

    const rect = record.element.getBoundingClientRect()
    if (rect.bottom <= viewportRect.top || rect.top >= viewportRect.bottom) {
      return
    }

    const distanceFromTop = Math.max(0, rect.top - viewportRect.top)
    if (distanceFromTop < closestTop) {
      closestRecord = record
      closestTop = distanceFromTop
    }
  })

  if (!closestRecord) return null
  const selectedRecord: TextAnchorElementRecord = closestRecord
  const pageTexts = textsByPageNumber.get(selectedRecord.pageNumber)
  if (!pageTexts) return null
  const offset = getPageTextOffset(pageTexts, selectedRecord.text.id)
  if (offset === null) return null

  return {
    pageNumber: selectedRecord.pageNumber,
    textId: selectedRecord.text.id,
    text: selectedRecord.text.content,
    offset
  }
}

export function findTextAnchorAtOrBelow(
  viewport: HTMLElement,
  records: ReadonlyMap<string, TextAnchorElementRecord>,
  textsByPageNumber: ReadonlyMap<number, readonly AnchorText[]>,
  pageNumber?: number
): ReaderTextAnchor | null {
  const visibleAnchor = findTopTextAnchor(
    viewport,
    records,
    textsByPageNumber,
    pageNumber
  )
  if (visibleAnchor) return visibleAnchor

  const viewportTop = viewport.getBoundingClientRect().top
  let closestRecord: TextAnchorElementRecord | null = null
  let closestTop = Number.POSITIVE_INFINITY
  records.forEach((record) => {
    if (pageNumber !== undefined && record.pageNumber < pageNumber) return

    const rect = record.element.getBoundingClientRect()
    if (rect.bottom <= viewportTop) return

    const distanceFromTop = Math.max(0, rect.top - viewportTop)
    if (distanceFromTop < closestTop) {
      closestRecord = record
      closestTop = distanceFromTop
    }
  })

  if (!closestRecord) return null
  const selectedRecord: TextAnchorElementRecord = closestRecord
  const pageTexts = textsByPageNumber.get(selectedRecord.pageNumber)
  if (!pageTexts) return null
  const offset = getPageTextOffset(pageTexts, selectedRecord.text.id)
  if (offset === null) return null

  return {
    pageNumber: selectedRecord.pageNumber,
    textId: selectedRecord.text.id,
    text: selectedRecord.text.content,
    offset
  }
}
