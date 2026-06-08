import type { IntermediateText } from '@hamster-note/types'

export type TextElementEntry = {
  text: IntermediateText
  pageNumber: number
}

export type CaretPositionFromPoint = (
  x: number,
  y: number
) => { offsetNode: Node; offset: number } | null

export type CaretRangeFromPoint = (x: number, y: number) => Range | null

export type ResolveCaretOptions = {
  viewerRoot: HTMLElement
  pageRefs: Map<number, HTMLDivElement>
  textElements: Map<string, TextElementEntry>
  caretPositionFromPoint?: CaretPositionFromPoint
  caretRangeFromPoint?: CaretRangeFromPoint
  document?: Document
}

type CaretPointDocument = Document & {
  caretPositionFromPoint?: CaretPositionFromPoint
  caretRangeFromPoint?: CaretRangeFromPoint
}

// The html-parser renders backgrounds as CSS `background-image` on
// `.hamster-note-page` divs, not as separate DOM elements, so those are
// inherently unselectable. This selector covers the direct-render `<img>`
// path and any future html-parser elements that may use these classes.
const BACKGROUND_TARGET_SELECTOR = [
  '.hamster-reader__intermediate-page-base-image',
  '.hamster-reader__intermediate-page-background',
  '.hamster-reader__intermediate-page-background-wrapper'
].join(', ')

const getElementFromNode = (node: Node | null): Element | null =>
  node instanceof Element ? node : (node?.parentElement ?? null)

export const isSelectionBackgroundTarget = (node: Node | null): boolean => {
  const element = getElementFromNode(node)
  return Boolean(element?.closest(BACKGROUND_TARGET_SELECTOR))
}

const clampToRange = (value: number, min: number, max: number): number => {
  if (value < min) return min - value
  if (value > max) return value - max
  return 0
}

const MAX_NEAREST_TEXT_SNAP_DISTANCE_PX = 100
const MAX_NEAREST_TEXT_SNAP_DISTANCE_SQUARED =
  MAX_NEAREST_TEXT_SNAP_DISTANCE_PX * MAX_NEAREST_TEXT_SNAP_DISTANCE_PX

const getPointToRectDistanceSquared = (
  point: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number }
): number => {
  const dx = clampToRange(point.x, rect.left, rect.right)
  const dy = clampToRange(point.y, rect.top, rect.bottom)
  return dx * dx + dy * dy
}

const getNumberFromDataPageNumber = (element: HTMLElement): number | null => {
  const pageNumber = Number(element.dataset.pageNumber)
  return Number.isFinite(pageNumber) ? pageNumber : null
}

const getHtmlParserPageElementByPageNumber = (
  pageNumber: number,
  viewerRoot: HTMLElement
): HTMLElement | null => {
  const pageElements = Array.from(
    viewerRoot.querySelectorAll('.hamster-note-page')
  ) as HTMLElement[]

  return (
    pageElements.find((element) => {
      const elementPageNumber = getNumberFromDataPageNumber(element)
      return elementPageNumber === pageNumber
    }) ??
    pageElements[pageNumber - 1] ??
    null
  )
}

export const getPageElementByPageNumber = (
  pageNumber: number,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): HTMLElement | null => {
  return (
    pageRefs.get(pageNumber) ??
    getHtmlParserPageElementByPageNumber(pageNumber, viewerRoot)
  )
}

const getHtmlParserPageForPoint = (
  pointElement: Element | null,
  viewerRoot: HTMLElement
): { pageElement: HTMLElement; pageNumber: number } | null => {
  const htmlParserPageElement = pointElement?.closest('.hamster-note-page')
  if (!htmlParserPageElement || !viewerRoot.contains(htmlParserPageElement)) {
    return null
  }

  const pageElement = htmlParserPageElement as HTMLElement
  const explicitPageNumber = getNumberFromDataPageNumber(pageElement)
  if (explicitPageNumber !== null) {
    return { pageElement, pageNumber: explicitPageNumber }
  }

  const pageElements = Array.from(
    viewerRoot.querySelectorAll('.hamster-note-page')
  )
  const pageIndex = pageElements.indexOf(htmlParserPageElement)
  return pageIndex === -1 ? null : { pageElement, pageNumber: pageIndex + 1 }
}

const getMarkedPageForPoint = (
  pointElement: Element | null,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): { pageElement: HTMLElement; pageNumber: number } | null => {
  const hitElement = pointElement?.closest('[data-page-number]')
  if (!hitElement || !viewerRoot.contains(hitElement)) return null

  const pageNumber = getNumberFromDataPageNumber(hitElement as HTMLElement)
  if (pageNumber === null) return null

  const pageElement = getPageElementByPageNumber(
    pageNumber,
    viewerRoot,
    pageRefs
  )
  return pageElement && viewerRoot.contains(pageElement)
    ? { pageElement, pageNumber }
    : null
}

const getNearestPageForPoint = (
  clientX: number,
  clientY: number,
  pageRefs: Map<number, HTMLDivElement>
): { pageElement: HTMLElement; pageNumber: number } | null => {
  let nearestElement: HTMLDivElement | null = null
  let minDistance = Infinity

  for (const element of pageRefs.values()) {
    const distance = getPointToRectDistanceSquared(
      { x: clientX, y: clientY },
      element.getBoundingClientRect()
    )
    if (distance < minDistance) {
      minDistance = distance
      nearestElement = element
    }
  }

  return nearestElement
    ? {
        pageElement: nearestElement,
        pageNumber: Number(nearestElement.dataset.pageNumber)
      }
    : null
}

export const getPageElementForPoint = (
  clientX: number,
  clientY: number,
  viewerRoot: HTMLElement | null,
  pageRefs: Map<number, HTMLDivElement>,
  ownerDocument: Document = globalThis.document
): { pageElement: HTMLElement; pageNumber: number } | null => {
  if (!viewerRoot) return null

  const pointElement = ownerDocument.elementFromPoint(clientX, clientY)
  return (
    getHtmlParserPageForPoint(pointElement, viewerRoot) ??
    getMarkedPageForPoint(pointElement, viewerRoot, pageRefs) ??
    getNearestPageForPoint(clientX, clientY, pageRefs)
  )
}

const isBeforeInDocumentOrder = (
  element: HTMLElement,
  otherElement: HTMLElement
): boolean => {
  return (
    element.compareDocumentPosition(otherElement) ===
    Node.DOCUMENT_POSITION_FOLLOWING
  )
}

export const getNearestTextElementForPoint = (
  clientX: number,
  clientY: number,
  pageNumber: number,
  viewerRoot: HTMLElement | null,
  textElements: Map<string, TextElementEntry>
): HTMLElement | null => {
  if (!viewerRoot) return null

  let nearestElement: HTMLElement | null = null
  let minDistance = Infinity

  for (const [id, entry] of textElements.entries()) {
    if (entry.pageNumber !== pageNumber) continue

    const element = viewerRoot.querySelector(`[data-text-id="${id}"]`)
    if (!(element instanceof HTMLElement)) continue
    if (isSelectionBackgroundTarget(element)) continue

    const rect = element.getBoundingClientRect()
    const distance = getPointToRectDistanceSquared(
      { x: clientX, y: clientY },
      rect
    )

    if (distance < minDistance) {
      minDistance = distance
      nearestElement = element
    } else if (
      distance === minDistance &&
      nearestElement &&
      isBeforeInDocumentOrder(element, nearestElement)
    ) {
      nearestElement = element
    }
  }

  return minDistance <= MAX_NEAREST_TEXT_SNAP_DISTANCE_SQUARED
    ? nearestElement
    : null
}

const getClosestTextElement = (
  node: Node | null,
  viewerRoot: HTMLElement
): HTMLElement | null => {
  const element = getElementFromNode(node)
  const textElement = element?.closest('[data-text-id]')
  if (!(textElement instanceof HTMLElement)) return null
  if (!viewerRoot.contains(textElement)) return null
  if (isSelectionBackgroundTarget(textElement)) return null
  return textElement
}

const isValidCaretRange = (range: Range, viewerRoot: HTMLElement): boolean =>
  Boolean(getClosestTextElement(range.startContainer, viewerRoot))

const buildSnapRange = (
  nearestElement: HTMLElement,
  clientX: number
): Range => {
  const range = globalThis.document.createRange()
  const textNode = nearestElement.firstChild
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const rect = nearestElement.getBoundingClientRect()
    const textContent = (textNode as Text).data ?? ''
    const offset =
      clientX >= rect.left + rect.width / 2 ? textContent.length : 0
    range.setStart(textNode, offset)
    range.collapse(true)
  } else {
    range.selectNodeContents(nearestElement)
    range.collapse(true)
  }
  return range
}

const getCaretPageInfo = (
  clientX: number,
  clientY: number,
  options: ResolveCaretOptions,
  ownerDocument: Document
) =>
  getPageElementForPoint(
    clientX,
    clientY,
    options.viewerRoot,
    options.pageRefs,
    ownerDocument
  )

const resolveValidCaretRange = (
  range: Range | null,
  clientX: number,
  clientY: number,
  options: ResolveCaretOptions,
  ownerDocument: Document
): { range: Range; pageNumber: number } | null => {
  if (!range || isSelectionBackgroundTarget(range.startContainer)) return null

  const pageInfo = getCaretPageInfo(clientX, clientY, options, ownerDocument)
  if (pageInfo && isValidCaretRange(range, options.viewerRoot)) {
    return { range, pageNumber: pageInfo.pageNumber }
  }

  range.detach()
  return null
}

const resolveCaretPositionRange = (
  caretPositionFromPoint: CaretPositionFromPoint | undefined,
  clientX: number,
  clientY: number,
  ownerDocument: Document
): Range | null => {
  if (typeof caretPositionFromPoint !== 'function') return null

  const pos = caretPositionFromPoint(clientX, clientY)
  if (!pos || isSelectionBackgroundTarget(pos.offsetNode)) return null

  const range = ownerDocument.createRange()
  range.setStart(pos.offsetNode, pos.offset)
  range.collapse(true)
  return range
}

const resolveCaretRange = (
  caretRangeFromPoint: CaretRangeFromPoint | undefined,
  clientX: number,
  clientY: number
): Range | null => {
  if (typeof caretRangeFromPoint !== 'function') return null
  return caretRangeFromPoint(clientX, clientY)
}

export const resolveCaret = (
  clientX: number,
  clientY: number,
  options: ResolveCaretOptions
): { range: Range; pageNumber: number } | null => {
  const ownerDocument = options.document ?? globalThis.document
  const caretDocument = ownerDocument as CaretPointDocument
  const caretPositionFromPoint =
    options.caretPositionFromPoint ??
    caretDocument.caretPositionFromPoint?.bind(caretDocument)
  const caretRangeFromPoint =
    options.caretRangeFromPoint ??
    caretDocument.caretRangeFromPoint?.bind(caretDocument)

  const positionResult = resolveValidCaretRange(
    resolveCaretPositionRange(
      caretPositionFromPoint,
      clientX,
      clientY,
      ownerDocument
    ),
    clientX,
    clientY,
    options,
    ownerDocument
  )
  if (positionResult) return positionResult

  const rangeResult = resolveValidCaretRange(
    resolveCaretRange(caretRangeFromPoint, clientX, clientY),
    clientX,
    clientY,
    options,
    ownerDocument
  )
  if (rangeResult) return rangeResult

  const pageInfo = getCaretPageInfo(clientX, clientY, options, ownerDocument)
  if (!pageInfo) return null

  const nearestElement = getNearestTextElementForPoint(
    clientX,
    clientY,
    pageInfo.pageNumber,
    options.viewerRoot,
    options.textElements
  )
  if (!nearestElement) return null

  return {
    range: buildSnapRange(nearestElement, clientX),
    pageNumber: pageInfo.pageNumber
  }
}
