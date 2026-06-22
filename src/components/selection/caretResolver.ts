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
  // 选区手柄拖拽时启用：当 (clientX, clientY) 落在文本行外（行间空隙、行上方/下方），
  // 把 Y 钳制到最近文本行 rect 内再调用浏览器 caret API，
  // 从而保留 X 携带的字符级精度，避免被浏览器吸附到行首/行末。
  snapToNearestLine?: boolean
  allowHtmlParserRange?: boolean
}

type CaretPointDocument = Document & {
  caretPositionFromPoint?: CaretPositionFromPoint
  caretRangeFromPoint?: CaretRangeFromPoint
}

type ClientPoint = {
  readonly x: number
  readonly y: number
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

const HTML_PARSER_TEXT_ROOT_SELECTOR =
  '.hamster-reader__html-parser-output .hamster-note-page'

const SELECTION_CHROME_TARGET_SELECTOR = [
  '.hamster-reader__selection-overlay',
  '.hamster-reader__selection-overlay-path',
  '.hamster-reader__saved-selection-handles',
  '.hamster-reader__saved-selection-overlay',
  '.hamster-reader__selection-handle'
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
  point: ClientPoint,
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

const getHtmlParserPageElementFromSlot = (
  slotElement: HTMLDivElement
): HTMLElement | null =>
  slotElement.querySelector<HTMLElement>(':scope .hamster-note-page')

export const getPageElementByPageNumber = (
  pageNumber: number,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): HTMLElement | null => {
  const slotElement = pageRefs.get(pageNumber)
  const htmlParserPageElement = slotElement
    ? getHtmlParserPageElementFromSlot(slotElement)
    : null

  return (
    htmlParserPageElement ??
    slotElement ??
    getHtmlParserPageElementByPageNumber(pageNumber, viewerRoot)
  )
}

const resolveHtmlParserPageElement = (
  htmlParserPageElement: Element,
  viewerRoot: HTMLElement
): { pageElement: HTMLElement; pageNumber: number } | null => {
  if (!viewerRoot.contains(htmlParserPageElement)) return null

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

const getNearestHtmlParserPageForPoint = (
  point: ClientPoint,
  viewerRoot: HTMLElement
): { pageElement: HTMLElement; pageNumber: number } | null => {
  const pageElements = Array.from(
    viewerRoot.querySelectorAll(HTML_PARSER_TEXT_ROOT_SELECTOR)
  )

  let nearestPageElement: Element | null = null
  let minDistance = Infinity

  for (const pageElement of pageElements) {
    const distance = getPointToRectDistanceSquared(
      point,
      pageElement.getBoundingClientRect()
    )
    if (distance < minDistance) {
      minDistance = distance
      nearestPageElement = pageElement
    }
  }

  return nearestPageElement
    ? resolveHtmlParserPageElement(nearestPageElement, viewerRoot)
    : null
}

const getHtmlParserPageForPoint = (
  pointElement: Element | null,
  viewerRoot: HTMLElement,
  point: ClientPoint
): { pageElement: HTMLElement; pageNumber: number } | null => {
  if (!pointElement || isSelectionChromeTarget(pointElement)) {
    return getNearestHtmlParserPageForPoint(point, viewerRoot)
  }

  const htmlParserPageElement = pointElement?.closest('.hamster-note-page')
  if (!htmlParserPageElement) {
    return null
  }

  return resolveHtmlParserPageElement(htmlParserPageElement, viewerRoot)
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
  const point = { x: clientX, y: clientY }
  return (
    getHtmlParserPageForPoint(pointElement, viewerRoot, point) ??
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

const isSelectionChromeTarget = (node: Node | null): boolean => {
  const element = getElementFromNode(node)
  return Boolean(element?.closest(SELECTION_CHROME_TARGET_SELECTOR))
}

const getHtmlParserTextRoot = (
  node: Node,
  viewerRoot: HTMLElement
): HTMLElement | null => {
  if (node.nodeType !== Node.TEXT_NODE) return null

  const element = getElementFromNode(node)
  const htmlParserTextRoot = element?.closest(HTML_PARSER_TEXT_ROOT_SELECTOR)
  if (!(htmlParserTextRoot instanceof HTMLElement)) return null
  if (!viewerRoot.contains(htmlParserTextRoot)) return null
  if (isSelectionChromeTarget(node)) return null
  return htmlParserTextRoot
}

export const isHtmlParserSelectionTarget = (
  node: Node | null,
  viewerRoot: HTMLElement
): boolean => {
  const element = getElementFromNode(node)
  if (!element || !viewerRoot.contains(element)) return false
  if (element.matches('.hamster-note-page')) return false
  if (isSelectionBackgroundTarget(element)) return false
  if (isSelectionChromeTarget(element)) return false
  return Boolean(element.closest(HTML_PARSER_TEXT_ROOT_SELECTOR))
}

const isValidHtmlParserCaretRange = (
  range: Range,
  viewerRoot: HTMLElement
): boolean => {
  const startRoot = getHtmlParserTextRoot(range.startContainer, viewerRoot)
  const endRoot = getHtmlParserTextRoot(range.endContainer, viewerRoot)
  return Boolean(startRoot && endRoot)
}

const buildSnapRange = (
  nearestElement: HTMLElement,
  clientX: number
): Range => {
  const range = nearestElement.ownerDocument.createRange()
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

// snapToNearestLine 模式（手柄拖拽）专用：浏览器 caret API 在 Y-clamp 后仍失败时，
// 用 X 在 rect 水平区间内的比例插值出字符偏移，比「左半边→0、右半边→length」精细。
const buildProportionalSnapRange = (
  nearestElement: HTMLElement,
  clientX: number,
  clientY: number
): Range => {
  const range = nearestElement.ownerDocument.createRange()
  const textNode = nearestElement.firstChild
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const targetRect =
      pickNearestClientRect(nearestElement, clientX, clientY) ??
      nearestElement.getBoundingClientRect()
    const textContent = (textNode as Text).data ?? ''
    const offset = computeProportionalOffset(
      clientX,
      targetRect.left,
      targetRect.width,
      textContent.length
    )
    range.setStart(textNode, offset)
    range.collapse(true)
  } else {
    range.selectNodeContents(nearestElement)
    range.collapse(true)
  }
  return range
}

// 把 X 在 rect 水平区间内的位置按比例映射成字符偏移。这是 Y-clamp 后浏览器 caret API
// 仍失败时的兜底，比原先「左半边 → 0、右半边 → length」的二分阶跃精确得多。
// 假设字符宽度近似均匀，对当前 PDF 直渲染单文字 span（whiteSpace: pre）足够准确。
const computeProportionalOffset = (
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  textLength: number
): number => {
  if (textLength <= 0) return 0
  if (rectWidth <= 0) return clientX >= rectLeft ? textLength : 0
  const ratio = (clientX - rectLeft) / rectWidth
  const clampedRatio = Math.min(1, Math.max(0, ratio))
  const offset = Math.round(clampedRatio * textLength)
  return Math.min(textLength, Math.max(0, offset))
}

// 从最近文本元素的所有 client rects（多行包裹时可能多于一个）中挑出
// 与 (clientX, clientY) 距离最小的那一个。这样 Y-clamp 时使用的是
// 真正可见的行 rect，而不是元素整体（多行 inline 的 bounding box 包含行间空隙）。
const pickNearestClientRect = (
  element: HTMLElement,
  clientX: number,
  clientY: number
): DOMRect | null => {
  const rects = Array.from(element.getClientRects())
  if (rects.length === 0) {
    const bounding = element.getBoundingClientRect()
    return bounding.width > 0 || bounding.height > 0 ? bounding : null
  }
  let nearestRect: DOMRect | null = null
  let minDistance = Infinity
  for (const rect of rects) {
    const distance = getPointToRectDistanceSquared(
      { x: clientX, y: clientY },
      rect
    )
    if (distance < minDistance) {
      minDistance = distance
      nearestRect = rect
    }
  }
  return nearestRect
}

// 把 Y 钳制到 rect 垂直区间内：留出 epsilon 以避开浏览器 native caret API
// 在 rect 边缘的「吸附到行首/行末」启发式行为；rect 极薄时退化为垂直中心。
const clampYIntoRect = (clientY: number, rect: DOMRect): number => {
  const epsilon = Math.min(1, rect.height / 2)
  const top = rect.top + epsilon
  const bottom = rect.bottom - epsilon
  if (top >= bottom) {
    return rect.top + rect.height / 2
  }
  if (clientY < top) return top
  if (clientY > bottom) return bottom
  return clientY
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
  if (!pageInfo) {
    range.detach()
    return null
  }

  if (isValidCaretRange(range, options.viewerRoot)) {
    return { range, pageNumber: pageInfo.pageNumber }
  }

  if (
    options.allowHtmlParserRange === true &&
    isValidHtmlParserCaretRange(range, options.viewerRoot)
  ) {
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

// 判断 (clientX, clientY) 是否真正落在某个 viewer 内的文本元素上：
// - 用 elementFromPoint 拿到命中元素
// - 该元素或其祖先是 [data-text-id]
// - 不在 selection 背景目标内
// 用于决定 snapToNearestLine 模式下是否需要做 Y-clamp。
const isPointDirectlyOnTextElement = (
  clientX: number,
  clientY: number,
  viewerRoot: HTMLElement,
  ownerDocument: Document
): boolean => {
  const pointElement = ownerDocument.elementFromPoint?.(clientX, clientY)
  if (!pointElement) return false
  const textElement = pointElement.closest('[data-text-id]')
  if (!textElement || !viewerRoot.contains(textElement)) return false
  if (isSelectionBackgroundTarget(pointElement)) return false
  return true
}

// 校验 caret API 返回的 range 是否落在指定的 nearest text 元素内。
// 浏览器在 Y-clamp 后可能仍把光标解析到相邻文本元素（例如 ascender 重叠区域），
// 此时拒绝该结果，避免选区跨到错误的文本项。
const isCaretRangeWithinElement = (
  range: Range,
  expectedElement: HTMLElement
): boolean => {
  const container = range.startContainer
  const element =
    container.nodeType === Node.ELEMENT_NODE
      ? (container as Element)
      : container.parentElement
  if (!element) return false
  return expectedElement.contains(element)
}

const resolveCaretInsideElement = (
  element: HTMLElement,
  clientX: number,
  clientY: number,
  caretPositionFromPoint: CaretPositionFromPoint | undefined,
  caretRangeFromPoint: CaretRangeFromPoint | undefined,
  ownerDocument: Document
): Range | null => {
  const targetRect = pickNearestClientRect(element, clientX, clientY)
  if (!targetRect) return null
  const clampedY = clampYIntoRect(clientY, targetRect)

  const positionRange = resolveCaretPositionRange(
    caretPositionFromPoint,
    clientX,
    clampedY,
    ownerDocument
  )
  if (positionRange) {
    if (isCaretRangeWithinElement(positionRange, element)) return positionRange
    positionRange.detach()
  }

  const rangeFromPoint = resolveCaretRange(
    caretRangeFromPoint,
    clientX,
    clampedY
  )
  if (rangeFromPoint) {
    if (isCaretRangeWithinElement(rangeFromPoint, element))
      return rangeFromPoint
    rangeFromPoint.detach()
  }

  return null
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

  // snapToNearestLine 模式：当 pointer 不在文本上时，跳过初次「原始 (x,y)」浏览器调用，
  // 改用「最近文本元素 + Y-clamp 后再调用 caret API」，避免浏览器把 Y 偏离行的点
  // 解析为该行的行首/行末。pointer 在文本上时仍走原路径，保留正常字符精度。
  const onText =
    !options.snapToNearestLine ||
    isPointDirectlyOnTextElement(
      clientX,
      clientY,
      options.viewerRoot,
      ownerDocument
    )

  if (onText) {
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
  }

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

  if (options.snapToNearestLine) {
    const clampedRange = resolveCaretInsideElement(
      nearestElement,
      clientX,
      clientY,
      caretPositionFromPoint,
      caretRangeFromPoint,
      ownerDocument
    )
    if (clampedRange) {
      return { range: clampedRange, pageNumber: pageInfo.pageNumber }
    }
    return {
      range: buildProportionalSnapRange(nearestElement, clientX, clientY),
      pageNumber: pageInfo.pageNumber
    }
  }

  return {
    range: buildSnapRange(nearestElement, clientX),
    pageNumber: pageInfo.pageNumber
  }
}
