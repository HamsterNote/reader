import type { IntermediateText } from '@hamster-note/types'

import type {
  ReaderSavedSelection,
  ReaderSavedSelectionAnchor,
  ReaderSavedSelectionRestoreResult,
  ReaderSavedSelectionSegment,
  ReaderSelectionOverlayRect
} from '../IntermediateDocumentViewer'
import type { ReaderSelectedTextSegment } from './selectionPayloadSerializer'

export type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

export type TextElementInfo = {
  element: HTMLElement
  text: IntermediateText
  pageNumber: number
}

const CONTEXT_LENGTH = 24

const hasValidPageSize = (pageSize: { width: number; height: number }) =>
  Number.isFinite(pageSize.width) &&
  Number.isFinite(pageSize.height) &&
  pageSize.width > 0 &&
  pageSize.height > 0

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

const roundNormalized = (value: number): number =>
  Number(clamp01(value).toFixed(6))

const getTextContent = (text: Pick<IntermediateText, 'content'>): string =>
  text.content ?? ''

const getTextId = (text: Pick<IntermediateText, 'id'>): string | undefined =>
  typeof text.id === 'string' && text.id.length > 0 ? text.id : undefined

const getTextBbox = (
  polygon: IntermediateText['polygon'] | undefined
): NormalizedRect | undefined => {
  if (!polygon) return undefined

  const points = polygon.filter(
    (point): point is [number, number] =>
      Array.isArray(point) &&
      point.length === 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
  )
  if (points.length === 0) return undefined

  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const getContextBefore = (content: string, charIndex: number): string =>
  content.slice(Math.max(0, charIndex - CONTEXT_LENGTH), charIndex)

const getContextAfter = (content: string, charIndex: number): string =>
  content.slice(charIndex, charIndex + CONTEXT_LENGTH)

const getSegmentContextAfter = (
  content: string,
  endCharIndex: number
): string => getContextAfter(content, endCharIndex)

const getSegmentPageNumber = (segment: ReaderSelectedTextSegment): number =>
  segment.pageNumber ?? 1

const buildAnchor = (
  segment: ReaderSelectedTextSegment,
  charIndex: number,
  pageSize: { width: number; height: number } | undefined
): ReaderSavedSelectionAnchor => {
  const content = getTextContent(segment)
  const bbox = getTextBbox(segment.polygon)
  const pageNumber = getSegmentPageNumber(segment)
  const normalizedBbox =
    bbox && pageSize
      ? normalizePageRects([{ ...bbox, pageNumber }], pageSize)[0]
      : undefined

  return {
    pageNumber,
    textId: getTextId(segment),
    textHash: textHash(content),
    charIndex,
    contextBefore: getContextBefore(content, charIndex),
    contextAfter: getContextAfter(content, charIndex),
    bbox: normalizedBbox
  }
}

const buildSavedSegment = (
  segment: ReaderSelectedTextSegment,
  pageSize: { width: number; height: number } | undefined
): ReaderSavedSelectionSegment => {
  const content = getTextContent(segment)
  const bbox = getTextBbox(segment.polygon)
  const pageNumber = getSegmentPageNumber(segment)
  const normalizedBbox =
    bbox && pageSize
      ? normalizePageRects([{ ...bbox, pageNumber }], pageSize)[0]
      : undefined

  return {
    pageNumber,
    textId: getTextId(segment),
    textHash: textHash(content),
    startCharIndex: segment.startCharIndex,
    endCharIndex: segment.endCharIndex,
    selectedText: segment.selectedText,
    contextBefore: getContextBefore(content, segment.startCharIndex),
    contextAfter: getSegmentContextAfter(content, segment.endCharIndex),
    bbox: normalizedBbox
  }
}

const groupRectsByPage = (
  rects: ReaderSelectionOverlayRect[],
  pageSizes: Map<number, { width: number; height: number }>
): ReaderSavedSelection['visual'] => {
  const grouped = new Map<number, ReaderSelectionOverlayRect[]>()
  for (const rect of rects) {
    grouped.set(rect.pageNumber, [
      ...(grouped.get(rect.pageNumber) ?? []),
      rect
    ])
  }

  return Array.from(grouped.entries()).flatMap(([pageNumber, pageRects]) => {
    const pageSize = pageSizes.get(pageNumber)
    if (!pageSize || !hasValidPageSize(pageSize)) return []

    return [
      {
        pageNumber,
        pageSize,
        rects: normalizePageRects(pageRects, pageSize)
      }
    ]
  })
}

const getTextNode = (element: HTMLElement): Text => {
  const firstTextNode = Array.from(element.childNodes).find(
    (node): node is Text => node.nodeType === Node.TEXT_NODE
  )
  if (firstTextNode) return firstTextNode
  return element.ownerDocument.createTextNode('')
}

const createElementRange = (
  element: HTMLElement,
  startCharIndex: number,
  endCharIndex: number
): Range => {
  const textNode = getTextNode(element)
  const range = element.ownerDocument.createRange()
  range.setStart(textNode, startCharIndex)
  range.setEnd(textNode, endCharIndex)
  return range
}

const resolveRangeRects = (
  range: Range,
  pageNumber: number,
  fallbackBbox?: NormalizedRect
): ReaderSelectionOverlayRect[] => {
  const clientRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  )
  if (clientRects.length > 0) {
    return clientRects.map((rect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      pageNumber
    }))
  }

  const rect = range.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return [
      {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pageNumber
      }
    ]
  }

  return fallbackBbox ? [{ ...fallbackBbox, pageNumber }] : []
}

const getAnchorDistance = (
  anchor: Pick<ReaderSavedSelectionAnchor, 'bbox'>,
  candidate: TextElementInfo
): number => {
  if (!anchor.bbox) return 0
  const bbox = getTextBbox(candidate.text.polygon)
  if (!bbox) return Number.POSITIVE_INFINITY
  return Math.abs(bbox.y - anchor.bbox.y)
}

const chooseNearestCandidate = (
  candidates: TextElementInfo[],
  anchor: Pick<ReaderSavedSelectionAnchor, 'bbox'>
): TextElementInfo | null => {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  let nearest: TextElementInfo | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  let tied = false

  for (const candidate of candidates) {
    const distance = getAnchorDistance(anchor, candidate)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
      tied = false
    } else if (distance === nearestDistance) {
      tied = true
    }
  }

  return tied ? null : nearest
}

const resolveAnchorExact = (
  anchor: ReaderSavedSelectionAnchor,
  textElements: TextElementInfo[]
): { element: TextElementInfo; charIndex: number } | null => {
  if (!anchor.textId || anchor.charIndex === undefined) return null
  const candidate = textElements.find(
    (info) =>
      info.pageNumber === anchor.pageNumber &&
      getTextId(info.text) === anchor.textId
  )
  if (!candidate) return null

  const content = getTextContent(candidate.text)
  if (textHash(content) !== anchor.textHash) return null
  if (anchor.charIndex < 0 || anchor.charIndex > content.length) return null
  return { element: candidate, charIndex: anchor.charIndex }
}

const resolveAnchorContext = (
  anchor: ReaderSavedSelectionAnchor,
  textElements: TextElementInfo[]
): { element: TextElementInfo; charIndex: number } | null => {
  if (!anchor.textHash) return null
  const candidates = textElements.filter((info) => {
    if (info.pageNumber !== anchor.pageNumber) return false
    const content = getTextContent(info.text)
    if (textHash(content) !== anchor.textHash) return false
    if (anchor.charIndex === undefined) return false
    return (
      getContextBefore(content, anchor.charIndex) === anchor.contextBefore &&
      getContextAfter(content, anchor.charIndex) === anchor.contextAfter
    )
  })
  const candidate = chooseNearestCandidate(candidates, anchor)
  return candidate && anchor.charIndex !== undefined
    ? { element: candidate, charIndex: anchor.charIndex }
    : null
}

const resolveSegmentBySelectedText = (
  segment: ReaderSavedSelectionSegment,
  textElements: TextElementInfo[]
): {
  element: TextElementInfo
  startCharIndex: number
  endCharIndex: number
} | null => {
  if (!segment.selectedText) return null
  const selectedText = segment.selectedText
  const matches = textElements.flatMap((info) => {
    if (info.pageNumber !== segment.pageNumber) return []
    const content = getTextContent(info.text)
    const indexes: number[] = []
    let index = content.indexOf(selectedText)
    while (index !== -1) {
      indexes.push(index)
      index = content.indexOf(selectedText, index + 1)
    }
    return indexes.map((startCharIndex) => ({
      element: info,
      startCharIndex,
      endCharIndex: startCharIndex + selectedText.length
    }))
  })

  if (matches.length === 1) return matches[0]
  if (!segment.bbox || matches.length === 0) return null

  const chosen = chooseNearestCandidate(
    matches.map((match) => match.element),
    { bbox: segment.bbox }
  )
  const chosenMatches = matches.filter((match) => match.element === chosen)
  return chosenMatches.length === 1 ? chosenMatches[0] : null
}

/**
 * 将单个已保存 segment 解析到当前 DOM 中对应的元素及字符区间。
 * 依次尝试 exact id + hash、context、selectedText 三种匹配方式，
 * 与 anchor 解析保持一致的回退链。
 */
const resolveSegmentForRects = (
  segment: ReaderSavedSelectionSegment,
  textElements: TextElementInfo[]
): {
  element: TextElementInfo
  startCharIndex: number
  endCharIndex: number
} | null => {
  // 1. Exact id + hash match
  if (
    segment.textId &&
    segment.startCharIndex !== undefined &&
    segment.endCharIndex !== undefined
  ) {
    const exact = textElements.find(
      (info) =>
        info.pageNumber === segment.pageNumber &&
        getTextId(info.text) === segment.textId
    )
    if (exact && textHash(getTextContent(exact.text)) === segment.textHash) {
      return {
        element: exact,
        startCharIndex: segment.startCharIndex,
        endCharIndex: segment.endCharIndex
      }
    }
  }

  // 2. Context match — same page, same textHash, same surrounding characters
  if (
    segment.textHash &&
    segment.startCharIndex !== undefined &&
    segment.endCharIndex !== undefined
  ) {
    const segStart = segment.startCharIndex
    const segEnd = segment.endCharIndex
    const candidates = textElements.filter((info) => {
      if (info.pageNumber !== segment.pageNumber) return false
      const content = getTextContent(info.text)
      if (textHash(content) !== segment.textHash) return false
      return (
        getContextBefore(content, segStart) === segment.contextBefore &&
        getContextAfter(content, segEnd) === segment.contextAfter
      )
    })
    let chosen: TextElementInfo | null = null
    if (candidates.length === 1) {
      chosen = candidates[0]
    } else if (candidates.length > 1 && segment.bbox) {
      chosen = chooseNearestCandidate(candidates, { bbox: segment.bbox })
    }
    if (chosen) {
      return { element: chosen, startCharIndex: segStart, endCharIndex: segEnd }
    }
  }

  // 3. Selected-text match (disambiguated by bbox distance when multiple)
  return resolveSegmentBySelectedText(segment, textElements)
}

const buildVisualFallback = (
  selection: ReaderSavedSelection,
  reason: string
): ReaderSavedSelectionRestoreResult => ({
  id: selection.id,
  selection,
  status: selection.visual.length > 0 ? 'visual-fallback' : 'unresolved',
  rects: selection.visual.flatMap((page) =>
    denormalizePageRects(page.rects, page.pageSize).map((rect) => ({
      ...rect,
      pageNumber: page.pageNumber
    }))
  ),
  segments: [],
  extractedText: '',
  reason
})

const buildResolvedResult = (
  selection: ReaderSavedSelection,
  range: Range,
  rects: ReaderSelectionOverlayRect[],
  segments: ReaderSavedSelectionSegment[],
  extractedText: string
): ReaderSavedSelectionRestoreResult => ({
  id: selection.id,
  selection,
  status: 'resolved',
  range,
  rects,
  segments,
  extractedText
})

/**
 * 生成轻量、稳定的文本哈希。使用本地 FNV-1a 32 位实现，避免引入依赖。
 */
export const textHash = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 将页面坐标系矩形归一化到 0-1，保存时用于跨缩放比例恢复视觉覆盖层。
 */
export const normalizePageRects = (
  rects: ReaderSelectionOverlayRect[],
  pageSize: { width: number; height: number }
): NormalizedRect[] => {
  if (!hasValidPageSize(pageSize)) return []

  return rects.map((rect) => {
    const x = roundNormalized(rect.x / pageSize.width)
    const y = roundNormalized(rect.y / pageSize.height)
    const right = roundNormalized((rect.x + rect.width) / pageSize.width)
    const bottom = roundNormalized((rect.y + rect.height) / pageSize.height)
    return {
      x,
      y,
      width: roundNormalized(right - x),
      height: roundNormalized(bottom - y)
    }
  })
}

/**
 * 将 0-1 归一化矩形还原为页面坐标系矩形，供视觉回退渲染复用。
 */
export const denormalizePageRects = (
  rects: NormalizedRect[],
  pageSize: { width: number; height: number }
): ReaderSelectionOverlayRect[] => {
  if (!hasValidPageSize(pageSize)) return []

  return rects.map((rect) => ({
    x: clamp01(rect.x) * pageSize.width,
    y: clamp01(rect.y) * pageSize.height,
    width: clamp01(rect.width) * pageSize.width,
    height: clamp01(rect.height) * pageSize.height,
    pageNumber: 0
  }))
}

/**
 * 从当前 Selection payload 构造可持久化的选择模型，仅使用调用方传入的数据。
 */
export const buildSavedSelection = (options: {
  id: string
  document?: string
  selection: Selection
  segments: ReaderSelectedTextSegment[]
  rects: ReaderSelectionOverlayRect[]
  pageSizes: Map<number, { width: number; height: number }>
}): ReaderSavedSelection => {
  const [firstSegment] = options.segments
  const lastSegment = options.segments[options.segments.length - 1]
  const text = options.segments.map((segment) => segment.selectedText).join('')

  return {
    version: 1,
    id: options.id,
    document: options.document,
    text: text || options.selection.toString(),
    start: firstSegment
      ? buildAnchor(
          firstSegment,
          firstSegment.startCharIndex,
          options.pageSizes.get(getSegmentPageNumber(firstSegment))
        )
      : { pageNumber: 1 },
    end: lastSegment
      ? buildAnchor(
          lastSegment,
          lastSegment.endCharIndex,
          options.pageSizes.get(getSegmentPageNumber(lastSegment))
        )
      : { pageNumber: 1 },
    segments: options.segments.map((segment) =>
      buildSavedSegment(
        segment,
        options.pageSizes.get(getSegmentPageNumber(segment))
      )
    ),
    visual: groupRectsByPage(options.rects, options.pageSizes)
  }
}

/**
 * 用编辑后的实时 Selection payload 重建已保存选择。
 * 调用方仍持有源数据；这里返回全新对象，避免修改 savedSelections prop。
 */
export const rebuildSavedSelectionFromEdit = (options: {
  previousSelection: ReaderSavedSelection
  selection: Selection
  segments: ReaderSelectedTextSegment[]
  rects: ReaderSelectionOverlayRect[]
  pageSizes: Map<number, { width: number; height: number }>
}): ReaderSavedSelection =>
  buildSavedSelection({
    id: options.previousSelection.id,
    document: options.previousSelection.document,
    selection: options.selection,
    segments: options.segments,
    rects: options.rects,
    pageSizes: options.pageSizes
  })

/**
 * 按 exact → context → selected-text → visual 的顺序恢复已保存选择。
 */
export const resolveSavedSelection = (
  selection: ReaderSavedSelection,
  textElements: TextElementInfo[]
): ReaderSavedSelectionRestoreResult => {
  const start =
    resolveAnchorExact(selection.start, textElements) ??
    resolveAnchorContext(selection.start, textElements)
  const end =
    resolveAnchorExact(selection.end, textElements) ??
    resolveAnchorContext(selection.end, textElements)

  if (start && end) {
    const range = start.element.element.ownerDocument.createRange()
    range.setStart(getTextNode(start.element.element), start.charIndex)
    range.setEnd(getTextNode(end.element.element), end.charIndex)
    const segments = selection.segments
    const rects = selection.segments.flatMap((segment) => {
      const resolved = resolveSegmentForRects(segment, textElements)
      if (!resolved) return []
      const segmentRange = createElementRange(
        resolved.element.element,
        resolved.startCharIndex,
        resolved.endCharIndex
      )
      return resolveRangeRects(segmentRange, segment.pageNumber, segment.bbox)
    })
    return buildResolvedResult(
      selection,
      range,
      rects,
      segments,
      selection.text
    )
  }

  const segmentMatches = selection.segments.map((segment) =>
    resolveSegmentBySelectedText(segment, textElements)
  )
  if (segmentMatches.every(Boolean) && segmentMatches.length > 0) {
    const firstMatch = segmentMatches[0]
    const lastMatch = segmentMatches[segmentMatches.length - 1]
    if (firstMatch && lastMatch) {
      const range = firstMatch.element.element.ownerDocument.createRange()
      range.setStart(
        getTextNode(firstMatch.element.element),
        firstMatch.startCharIndex
      )
      range.setEnd(
        getTextNode(lastMatch.element.element),
        lastMatch.endCharIndex
      )
      const rects = segmentMatches.flatMap((match, index) => {
        if (!match) return []
        const segment = selection.segments[index]
        const segmentRange = createElementRange(
          match.element.element,
          match.startCharIndex,
          match.endCharIndex
        )
        return resolveRangeRects(segmentRange, segment.pageNumber, segment.bbox)
      })
      return buildResolvedResult(
        selection,
        range,
        rects,
        selection.segments,
        selection.text
      )
    }
  }

  return buildVisualFallback(selection, 'text anchors unresolved')
}
