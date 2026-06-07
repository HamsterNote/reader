import type { DecodeOptions } from '@hamster-note/html-parser'
import { HtmlParser } from '@hamster-note/html-parser'
import type {
  IntermediateContent,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { IntermediateDocument } from '@hamster-note/types'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { polygonsToSvgPath, rectsToUnionPolygons } from './selectionGeometry'

export type ReaderTextSelectionDetail = {
  text: IntermediateText
  texts: IntermediateText[]
  selectedText: string
  pageNumber: number
  selection: Selection
}

export type ReaderPageRange = {
  start: number
  end: number
}

export type ReaderRenderMode = 'html-parser' | 'direct'

/** 背景质量级别：low（低）、medium（中）、high（高） */
export type BackgroundQuality = 'low' | 'medium' | 'high'

/** 选择覆盖层矩形区域（页面坐标系） */
export type ReaderSelectionOverlayRect = {
  x: number
  y: number
  width: number
  height: number
  pageNumber: number
}

/** 选择覆盖层配置选项 */
export type ReaderSelectionOverlayOptions = {
  /** 覆盖层颜色，默认 '#3b82f6' */
  color?: string
  /** 覆盖层透明度，默认 0.3 */
  opacity?: number
  /** 是否启用覆盖层，默认 true */
  enabled?: boolean
}

/** 选择手柄位置信息 */
export type ReaderSelectionHandlePosition = {
  x: number
  y: number
  pageNumber: number
  rootX?: number
  rootY?: number
}

/** 选择手柄渲染属性 */
export type ReaderSelectionHandleRenderProps = {
  /** 手柄类型：start 或 end */
  type: 'start' | 'end'
  /** 手柄位置 */
  position: ReaderSelectionHandlePosition
  /** 是否正在拖动 */
  isDragging: boolean
}

/** 将背景质量级别映射为 html-parser 的 backgroundQuality 数值（0-1） */
const BACKGROUND_QUALITY_MAP: Record<BackgroundQuality, number> = {
  low: 0.1,
  medium: 0.3,
  high: 0.8
}

export type IntermediateDocumentViewerProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  serializedDocument?: IntermediateDocumentSerialized | null
  className?: string
  overscan?: number
  pageRange?: ReaderPageRange
  renderMode?: ReaderRenderMode
  backgroundQuality?: BackgroundQuality
  ocr?: boolean | { enabled?: boolean }
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  onTextSelectionChange?: (
    text: IntermediateText,
    detail: ReaderTextSelectionDetail
  ) => void
  onTextSelectionEnd?: (
    text: IntermediateText,
    detail: ReaderTextSelectionDetail
  ) => void
  selectionOverlay?: boolean | ReaderSelectionOverlayOptions
  // 允许传入 null 显式禁用手柄渲染（运行时已支持，类型在此对齐）
  selectionHandleElement?: React.ReactElement<ReaderSelectionHandleRenderProps> | null
}

type PageSize = {
  width: number
  height: number
}

type RenderableIntermediateText = IntermediateText &
  Partial<{
    x: number
    y: number
    width: number
    height: number
    polygon: [number, number][]
    rotate: number
    skew: number
  }>

type PageLoadStatus = 'loaded' | 'error'
type HtmlParserDocumentInput = Parameters<typeof HtmlParser.decodeToHtml>[0]

const DEFAULT_PAGE_SIZE: PageSize = {
  width: 595,
  height: 842
}

const isRuntimeDocument = (
  document: IntermediateDocument | IntermediateDocumentSerialized
): document is IntermediateDocument =>
  typeof (document as IntermediateDocument).getPageByPageNumber === 'function'

const isIntermediateText = (
  content: IntermediateContent
): content is IntermediateText => 'content' in content && 'fontSize' in content

const normalizePageSize = (size: { x?: number; y?: number } | undefined) => {
  const pageSizeUnavailable =
    !(typeof size?.x === 'number' && size.x > 0) ||
    !(typeof size?.y === 'number' && size.y > 0)
  const width =
    typeof size?.x === 'number' && size.x > 0 ? size.x : DEFAULT_PAGE_SIZE.width
  const height =
    typeof size?.y === 'number' && size.y > 0
      ? size.y
      : DEFAULT_PAGE_SIZE.height

  return { width, height, pageSizeUnavailable }
}

const getTextBoundingBox = (polygon: [number, number][]) => {
  if (!polygon || polygon.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const xs = polygon.map((point) => point?.[0]).filter(Number.isFinite)
  const ys = polygon.map((point) => point?.[1]).filter(Number.isFinite)
  if (xs.length === 0 || ys.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const getPolygonTextGeometry = (
  polygon: [number, number][] | undefined
): {
  x: number
  y: number
  width: number
  height: number
  rotation: number
} | null => {
  if (
    !polygon ||
    polygon.length !== 4 ||
    !polygon.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number' &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1])
    )
  ) {
    return null
  }

  const p0 = polygon[0]
  const p1 = polygon[1]
  const p2 = polygon[2]

  const width = Math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2)
  const height = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)

  if (width === 0 || height === 0) {
    return null
  }

  const rotation = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI

  return {
    x: p0[0],
    y: p0[1],
    width,
    height,
    rotation
  }
}

/**
 * Merge overlapping or adjacent rectangles on the same line.
 * Uses a tolerance of 2px to handle minor gaps between text spans.
 */
export const mergeSelectionRects = (
  rects: Array<{ x: number; y: number; width: number; height: number }>
): Array<{ x: number; y: number; width: number; height: number }> => {
  if (rects.length === 0) return []

  // Sort by Y then X
  const sorted = [...rects].sort((a, b) => {
    const yDiff = a.y - b.y
    return Math.abs(yDiff) < 2 ? a.x - b.x : yDiff
  })

  const merged: Array<{ x: number; y: number; width: number; height: number }> =
    []
  let current = { ...sorted[0] }

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    const sameLine =
      Math.abs(current.y - next.y) < 2 &&
      Math.abs(current.height - next.height) < 2
    const overlapsOrAdjacent =
      sameLine && next.x <= current.x + current.width + 2

    if (overlapsOrAdjacent) {
      // Merge: extend current rect to cover next
      const right = Math.max(current.x + current.width, next.x + next.width)
      current.x = Math.min(current.x, next.x)
      current.width = right - current.x
    } else {
      merged.push(current)
      current = { ...next }
    }
  }
  merged.push(current)

  return merged
}

/**
 * Extract selection overlay rectangles from a Selection object.
 * Converts viewport-relative rects to page-relative coordinates.
 */
export const getSelectionOverlayRects = (
  selection: Selection,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): ReaderSelectionOverlayRect[] => {
  if (selection.isCollapsed) return []

  const range = selection.getRangeAt(0)
  const clientRects = Array.from(range.getClientRects())

  if (clientRects.length === 0) return []

  // Filter out zero-size rects
  const validRects = clientRects.filter(
    (rect) => rect.width > 0 && rect.height > 0
  )

  if (validRects.length === 0) return []

  // Group rects by page
  const rectsByPage = new Map<
    number,
    Array<{ x: number; y: number; width: number; height: number }>
  >()

  for (const rect of validRects) {
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // Find which page this rect belongs to
    const pageInfo = getPageElementForPoint(
      centerX,
      centerY,
      viewerRoot,
      pageRefs
    )
    if (!pageInfo) continue

    const pageRect = pageInfo.pageElement.getBoundingClientRect()
    const pageNumber = pageInfo.pageNumber

    // Convert viewport coords to page-relative coords
    if (!rectsByPage.has(pageNumber)) {
      rectsByPage.set(pageNumber, [])
    }
    const pageRects = rectsByPage.get(pageNumber)
    if (!pageRects) continue

    pageRects.push({
      x: rect.left - pageRect.left,
      y: rect.top - pageRect.top,
      width: rect.width,
      height: rect.height
    })
  }

  // Build final result from raw rects (no pre-merge; only clipper union merges)
  const result: ReaderSelectionOverlayRect[] = []

  for (const [pageNumber, rects] of rectsByPage) {
    for (const rect of rects) {
      result.push({ ...rect, pageNumber })
    }
  }

  return result
}

const getRootOverlayRect = (
  rect: ReaderSelectionOverlayRect,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): ReaderSelectionOverlayRect => {
  const pageElement =
    pageRefs.get(rect.pageNumber) ??
    (viewerRoot.querySelector(
      `[data-page-number="${rect.pageNumber}"]`
    ) as HTMLElement | null) ??
    (viewerRoot
      .querySelectorAll('.hamster-note-page')
      .item(rect.pageNumber - 1) as HTMLElement | null)
  if (!pageElement) return rect

  const pageRect = pageElement.getBoundingClientRect()
  const rootRect = viewerRoot.getBoundingClientRect()

  return {
    ...rect,
    x: pageRect.left - rootRect.left + viewerRoot.scrollLeft + rect.x,
    y: pageRect.top - rootRect.top + viewerRoot.scrollTop + rect.y
  }
}

const getTextTransform = (
  text: RenderableIntermediateText,
  skipRotate?: boolean
) => {
  const transforms: string[] = []

  if (!skipRotate && text.rotate) {
    transforms.push(`rotate(${text.rotate}deg)`)
  }

  if (text.skew) {
    transforms.push(`skewX(${text.skew}deg)`)
  }

  return transforms.length > 0 ? transforms.join(' ') : undefined
}

const getTextBbox = (text: RenderableIntermediateText) => {
  const polygonGeometry = getPolygonTextGeometry(text.polygon)
  const usePolygonGeometry = polygonGeometry !== null

  if (usePolygonGeometry) {
    return {
      x: polygonGeometry.x,
      y: polygonGeometry.y,
      width: polygonGeometry.width,
      height: polygonGeometry.height,
      rotation: polygonGeometry.rotation
    }
  }

  if (text.polygon) {
    return {
      ...getTextBoundingBox(text.polygon),
      rotation: 0
    }
  }

  return {
    x: text.x ?? 0,
    y: text.y ?? 0,
    width: text.width ?? 0,
    height: text.height ?? 0,
    rotation: 0
  }
}

const buildTextSpanStyle = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>
) => {
  const textTransform = getTextTransform(text, !!bbox.rotation)
  const transform = [
    bbox.rotation ? `rotate(${bbox.rotation}deg)` : '',
    textTransform
  ]
    .filter(Boolean)
    .join(' ')

  return {
    position: 'absolute' as const,
    left: Number.isFinite(bbox.x) ? `${bbox.x}px` : '0px',
    top: Number.isFinite(bbox.y) ? `${bbox.y}px` : '0px',
    width:
      Number.isFinite(bbox.width) && bbox.width > 0
        ? `${bbox.width}px`
        : undefined,
    height:
      Number.isFinite(bbox.height) && bbox.height > 0
        ? `${bbox.height}px`
        : undefined,
    fontSize:
      Number.isFinite(text.fontSize) && text.fontSize > 0
        ? `${text.fontSize}px`
        : undefined,
    fontFamily: text.fontFamily || undefined,
    fontWeight: text.fontWeight || undefined,
    fontStyle: text.italic ? 'italic' : undefined,
    color: text.color || undefined,
    lineHeight:
      Number.isFinite(text.lineHeight) && text.lineHeight > 0
        ? `${text.lineHeight}px`
        : undefined,
    transform,
    transformOrigin: 'left top' as const,
    whiteSpace: 'pre' as const
  }
}

const createSetTextsHandler = (
  pageNumber: number,
  texts: IntermediateText[]
) => {
  return (currentTexts: Map<number, IntermediateText[]>) => {
    const nextTexts = new Map(currentTexts)
    nextTexts.set(pageNumber, texts)
    return nextTexts
  }
}

const createSetPageStatusHandler = (
  pageNumber: number,
  status: PageLoadStatus
) => {
  return (currentStatuses: Map<number, PageLoadStatus>) => {
    const nextStatuses = new Map(currentStatuses)
    nextStatuses.set(pageNumber, status)
    return nextStatuses
  }
}

const createSetBaseImageHandler = (
  pageNumber: number,
  baseImage: string | undefined
) => {
  return (currentImages: Map<number, string>) => {
    const nextImages = new Map(currentImages)
    if (baseImage) {
      nextImages.set(pageNumber, baseImage)
    } else {
      nextImages.delete(pageNumber)
    }
    return nextImages
  }
}

const getOcrCacheKey = (
  docId: string,
  pageNumber: number,
  imageSource: string
) => `${docId}::${pageNumber}::${imageSource}`

type PageWithBaseImage = {
  thumbnail?: unknown
  image?: unknown
  getThumbnail?: () => Promise<unknown> | unknown
}

type ImageSourceLike = {
  src?: unknown
}

const getStringBaseImage = (imageSource: unknown) => {
  if (typeof imageSource === 'string' && imageSource.trim()) {
    return imageSource
  }

  if (imageSource && typeof imageSource === 'object') {
    const image = imageSource as ImageSourceLike
    if (typeof image.src === 'string' && image.src.trim()) {
      return image.src
    }
  }

  return undefined
}

const getBaseImageFromPage = async (page: unknown) => {
  if (!page || typeof page !== 'object') {
    return undefined
  }

  const pageWithImage = page as PageWithBaseImage
  const directBaseImage =
    getStringBaseImage(pageWithImage.thumbnail) ??
    getStringBaseImage(pageWithImage.image)

  if (directBaseImage) {
    return directBaseImage
  }

  if (typeof pageWithImage.getThumbnail !== 'function') {
    return undefined
  }

  try {
    return getStringBaseImage(await pageWithImage.getThumbnail())
  } catch {
    return undefined
  }
}

const getImageParserInput = async (imageSource: string) => {
  const response = await fetch(imageSource)
  return response.blob()
}

const prefixOcrTextIds = (texts: IntermediateText[], pageNumber: number) =>
  texts.map((text) => ({
    ...text,
    id: `ocr-${pageNumber}-${text.id}`
  }))

export const getClosestTextElement = (
  node: Node | null
): HTMLElement | null => {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('[data-text-id]') ?? null
}

const clampToRange = (value: number, min: number, max: number): number => {
  if (value < min) return min - value
  if (value > max) return value - max
  return 0
}

const getPointToRectDistanceSquared = (
  point: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number }
): number => {
  const dx = clampToRange(point.x, rect.left, rect.right)
  const dy = clampToRange(point.y, rect.top, rect.bottom)
  return dx * dx + dy * dy
}

export const getPageElementForPoint = (
  clientX: number,
  clientY: number,
  viewerRoot: HTMLElement | null,
  pageRefs: Map<number, HTMLDivElement>
): { pageElement: HTMLElement; pageNumber: number } | null => {
  if (!viewerRoot) return null

  const pointElement = document.elementFromPoint(clientX, clientY)
  const hitElement = pointElement?.closest('[data-page-number]')

  if (hitElement && viewerRoot.contains(hitElement)) {
    const pageNumber = Number((hitElement as HTMLElement).dataset.pageNumber)
    return { pageElement: hitElement as HTMLElement, pageNumber }
  }

  const htmlParserPageElement = pointElement?.closest('.hamster-note-page')
  if (htmlParserPageElement && viewerRoot.contains(htmlParserPageElement)) {
    const pageElements = Array.from(
      viewerRoot.querySelectorAll('.hamster-note-page')
    )
    const pageIndex = pageElements.indexOf(htmlParserPageElement)
    if (pageIndex !== -1) {
      return {
        pageElement: htmlParserPageElement as HTMLElement,
        pageNumber: pageIndex + 1
      }
    }
  }

  let nearestElement: HTMLElement | null = null
  let minDistance = Infinity

  for (const element of pageRefs.values()) {
    const rect = element.getBoundingClientRect()
    const distance = getPointToRectDistanceSquared(
      { x: clientX, y: clientY },
      rect
    )
    if (distance < minDistance) {
      minDistance = distance
      nearestElement = element
    }
  }

  if (!nearestElement) return null

  return {
    pageElement: nearestElement,
    pageNumber: Number(nearestElement.dataset.pageNumber)
  }
}

export const getNearestTextElementForPoint = (
  clientX: number,
  clientY: number,
  pageNumber: number,
  viewerRoot: HTMLElement | null,
  textElementsRef: Map<string, { text: IntermediateText; pageNumber: number }>
): HTMLElement | null => {
  if (!viewerRoot) return null

  let nearestElement: HTMLElement | null = null
  let minDistance = Infinity

  for (const [id, entry] of textElementsRef.entries()) {
    if (entry.pageNumber !== pageNumber) continue

    const element = viewerRoot.querySelector(`[data-text-id="${id}"]`)
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const distance = getPointToRectDistanceSquared(
      { x: clientX, y: clientY },
      rect
    )

    if (distance < minDistance) {
      minDistance = distance
      nearestElement = element as HTMLElement
    } else if (distance === minDistance && nearestElement) {
      if (
        (element as HTMLElement).compareDocumentPosition(nearestElement) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        nearestElement = element as HTMLElement
      }
    }
  }

  return nearestElement
}

type CaretPointDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/**
 * Get caret position from a point, with fallback to nearest text element.
 * Uses caretPositionFromPoint/caretRangeFromPoint when available.
 */
const buildSnapRange = (
  nearestElement: HTMLElement,
  clientX: number
): Range => {
  const range = document.createRange()
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

const getCaretFromPoint = (
  clientX: number,
  clientY: number,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>,
  textElementsRef: Map<string, { text: IntermediateText; pageNumber: number }>
): { range: Range; pageNumber: number } | null => {
  const caretDocument = document as CaretPointDocument

  if (typeof caretDocument.caretPositionFromPoint === 'function') {
    const pos = caretDocument.caretPositionFromPoint(clientX, clientY)
    if (pos) {
      const range = document.createRange()
      range.setStart(pos.offsetNode, pos.offset)
      range.collapse(true)

      const pageInfo = getPageElementForPoint(
        clientX,
        clientY,
        viewerRoot,
        pageRefs
      )
      if (pageInfo) {
        return { range, pageNumber: pageInfo.pageNumber }
      }
      range.detach()
    }
  }

  if (typeof caretDocument.caretRangeFromPoint === 'function') {
    const range = caretDocument.caretRangeFromPoint(clientX, clientY)
    if (range) {
      const pageInfo = getPageElementForPoint(
        clientX,
        clientY,
        viewerRoot,
        pageRefs
      )
      if (pageInfo) {
        return { range, pageNumber: pageInfo.pageNumber }
      }
      range.detach()
    }
  }

  const pageInfo = getPageElementForPoint(
    clientX,
    clientY,
    viewerRoot,
    pageRefs
  )
  if (!pageInfo) return null

  const nearestElement = getNearestTextElementForPoint(
    clientX,
    clientY,
    pageInfo.pageNumber,
    viewerRoot,
    textElementsRef
  )
  if (!nearestElement) return null

  return {
    range: buildSnapRange(nearestElement, clientX),
    pageNumber: pageInfo.pageNumber
  }
}

export function IntermediateDocumentViewer({
  document,
  serializedDocument,
  className,
  overscan = 1,
  pageRange,
  renderMode = 'html-parser',
  backgroundQuality,
  ocr,
  onOcrError,
  onTextSelectionChange,
  onTextSelectionEnd,
  selectionOverlay,
  selectionHandleElement
}: IntermediateDocumentViewerProps) {
  const runtimeDocument = useMemo(() => {
    const inputDocument = document ?? serializedDocument

    if (!inputDocument) {
      return null
    }

    return isRuntimeDocument(inputDocument)
      ? inputDocument
      : IntermediateDocument.parse(inputDocument)
  }, [document, serializedDocument])

  const pageNumbers = useMemo(() => {
    const allPageNumbers = runtimeDocument?.pageNumbers ?? []

    if (!pageRange) {
      return allPageNumbers
    }

    const start = Math.trunc(pageRange.start)
    const end = Math.trunc(pageRange.end)

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return []
    }

    return allPageNumbers.filter(
      (pageNumber) => pageNumber >= start && pageNumber <= end
    )
  }, [runtimeDocument, pageRange])
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const loadingPagesRef = useRef(new Set<number>())
  const ocrLoadingPagesRef = useRef(new Set<number>())
  const ocrCacheRef = useRef(new Map<string, IntermediateText[]>())
  const activeDocumentRef = useRef<IntermediateDocument | null>(null)
  const isMountedRef = useRef(false)
  const viewerRootRef = useRef<HTMLDivElement>(null)
  const textElementsRef = useRef<
    Map<string, { text: IntermediateText; pageNumber: number }>
  >(new Map())
  const activeMouseSelectionRef = useRef<{
    active: boolean
    clientX: number
    clientY: number
  }>({ active: false, clientX: 0, clientY: 0 })
  const ignoreNextBlankClickRef = useRef(false)
  const dragStateRef = useRef<{
    active: boolean
    handleType: 'start' | 'end' | null
    fixedPoint: { x: number; y: number; pageNumber: number } | null
    fixedAnchor: { node: Node; offset: number } | null
  }>({ active: false, handleType: null, fixedPoint: null, fixedAnchor: null })
  const [loadablePages, setLoadablePages] = useState(() => new Set<number>())
  const [visiblePages, setVisiblePages] = useState(() => new Set<number>())
  const [textsByPageNumber, setTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [ocrTextsByPageNumber, setOcrTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [pageStatuses, setPageStatuses] = useState(
    () => new Map<number, PageLoadStatus>()
  )
  const [baseImagesByPageNumber, setBaseImagesByPageNumber] = useState(
    () => new Map<number, string>()
  )
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [htmlParserError, setHtmlParserError] = useState(false)
  const overlayRectsRef = useRef<ReaderSelectionOverlayRect[]>([])
  const overlayContainerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  // 记录所有曾出现过的 overlay 容器，便于 React 卸载后仍能清理孤立 DOM 节点
  const allOverlayContainersRef = useRef<Set<HTMLElement>>(new Set())
  const overlayElRef = useRef<HTMLDivElement | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const preserveOverlayDuringMouseUpRef = useRef(false)
  // T6 选择手柄位置：每页记录 start/end 两个手柄坐标（页面相对坐标）。
  // 当 selection 落在该页时填入对应位置；否则该页无手柄渲染。
  const [selectionHandlePositions, setSelectionHandlePositions] = useState<
    Map<
      number,
      {
        start?: ReaderSelectionHandlePosition
        end?: ReaderSelectionHandlePosition
      }
    >
  >(() => new Map())

  const overlayOptions = useMemo(() => {
    if (!selectionOverlay) return null
    if (selectionOverlay === true) {
      return { color: '#3b82f6', opacity: 0.3, enabled: true }
    }
    return {
      color: selectionOverlay.color ?? '#3b82f6',
      opacity: selectionOverlay.opacity ?? 0.3,
      enabled: selectionOverlay.enabled ?? true
    }
  }, [selectionOverlay])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      activeDocumentRef.current = null
    }
  }, [])

  useEffect(() => {
    activeDocumentRef.current = runtimeDocument
    loadingPagesRef.current.clear()
    ocrLoadingPagesRef.current.clear()
    ocrCacheRef.current.clear()
    setLoadablePages(new Set())
    setVisiblePages(new Set())
    setTextsByPageNumber(new Map())
    setOcrTextsByPageNumber(new Map())
    setPageStatuses(new Map())
    setBaseImagesByPageNumber(new Map())
    setHtmlContent(null)
    setHtmlParserError(false)
  }, [runtimeDocument])

  // Primary render path: convert the runtime document to HTML via @hamster-note/html-parser.
  // On success we render the HTML fragment directly. Because html-parser output does not
  // expose the same `data-text-id` span tree that powers text-selection and OCR overlays,
  // those features are only fully available on the fallback (direct-render) path.
  // The fallback automatically activates when decodeToHtml throws or returns empty.
  useEffect(() => {
    if (!runtimeDocument || renderMode === 'direct') {
      setHtmlContent(null)
      setHtmlParserError(renderMode === 'direct')
      return
    }

    let cancelled = false

    const decodeOptions: DecodeOptions | undefined = backgroundQuality
      ? {
          background: {
            backgroundQuality: BACKGROUND_QUALITY_MAP[backgroundQuality]
          }
        }
      : undefined

    HtmlParser.decodeToHtml(
      runtimeDocument as unknown as HtmlParserDocumentInput,
      decodeOptions
    )
      .then((html) => {
        if (!cancelled) {
          setHtmlContent(html)
          setHtmlParserError(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtmlContent(null)
          setHtmlParserError(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [runtimeDocument, renderMode, backgroundQuality])

  const markLoadableWithOverscan = useCallback(
    (pageNumber: number) => {
      const pageIndex = pageNumbers.indexOf(pageNumber)

      if (pageIndex === -1) {
        return
      }

      const safeOverscan = Math.max(0, overscan)
      const startIndex = Math.max(0, pageIndex - safeOverscan)
      const endIndex = Math.min(
        pageNumbers.length - 1,
        pageIndex + safeOverscan
      )

      setLoadablePages((currentPages) => {
        const nextPages = new Set(currentPages)

        for (let index = startIndex; index <= endIndex; index += 1) {
          nextPages.add(pageNumbers[index])
        }

        return nextPages
      })
    },
    [overscan, pageNumbers]
  )

  const setPageRef = useCallback(
    (pageNumber: number) => (element: HTMLDivElement | null) => {
      if (element) {
        pageRefs.current.set(pageNumber, element)
      } else {
        pageRefs.current.delete(pageNumber)
      }
    },
    []
  )

  const setTextRef = useCallback(
    (text: IntermediateText, pageNumber: number) =>
      (element: HTMLSpanElement | null) => {
        if (element) {
          textElementsRef.current.set(text.id, { text, pageNumber })
        } else {
          textElementsRef.current.delete(text.id)
        }
      },
    []
  )

  const buildNormalizedSelection = useCallback(
    (
      selection: Selection,
      viewerRoot: HTMLElement
    ): ReaderTextSelectionDetail | null => {
      if (!activeMouseSelectionRef.current.active) return null

      const startElement =
        getClosestTextElement(selection.anchorNode) ??
        getClosestTextElement(selection.focusNode)
      if (!startElement) return null

      const startId = startElement.getAttribute('data-text-id')
      if (!startId) return null

      const startEntry = textElementsRef.current.get(startId)
      if (!startEntry) return null

      const pageInfo = getPageElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pageInfo) return null

      const endElement = getNearestTextElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        pageInfo.pageNumber,
        viewerRoot,
        textElementsRef.current
      )
      if (!endElement) return null

      const endId = endElement.getAttribute('data-text-id')
      if (!endId) return null

      const endEntry = textElementsRef.current.get(endId)
      if (!endEntry) return null

      const pageNumber = startEntry.pageNumber

      const allTextElements = Array.from(
        viewerRoot.querySelectorAll('[data-text-id]')
      )

      const startIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === startId
      )
      const endIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === endId
      )
      if (startIndex === -1 || endIndex === -1) return null

      const minIndex = Math.min(startIndex, endIndex)
      const maxIndex = Math.max(startIndex, endIndex)
      const sortedElements = allTextElements.slice(minIndex, maxIndex + 1)

      const texts = sortedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')
        if (!id) return []
        const entry = textElementsRef.current.get(id)
        return entry ? [entry.text] : []
      })

      if (texts.length === 0) return null

      return {
        text: texts[0],
        texts,
        selectedText: texts.map((t) => t.content ?? '').join(''),
        pageNumber,
        selection
      }
    },
    []
  )

  const getSelectionDetail = useCallback(
    (selection: Selection): ReaderTextSelectionDetail | null => {
      if (!selection || selection.isCollapsed) return null

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return null

      const anchorInViewer = viewerRoot.contains(selection.anchorNode)
      const focusInViewer = viewerRoot.contains(selection.focusNode)
      if (!anchorInViewer || !focusInViewer) return null

      const selectedElements: HTMLElement[] = []
      textElementsRef.current.forEach((_, id) => {
        const element = viewerRoot.querySelector(`[data-text-id="${id}"]`)
        if (element && selection.containsNode(element, true)) {
          selectedElements.push(element as HTMLElement)
        }
      })

      if (selectedElements.length === 0) {
        return buildNormalizedSelection(selection, viewerRoot)
      }

      selectedElements.sort((a, b) => {
        const range = globalThis.document.createRange()
        range.setStartBefore(a)
        range.setEndBefore(b)
        const order = range.collapsed ? 1 : -1
        range.detach()
        return order
      })

      const firstElement = selectedElements[0]
      const firstTextId = firstElement.getAttribute('data-text-id')
      const firstPageNumber = Number(
        firstElement.getAttribute('data-page-number')
      )

      if (!firstTextId) return null

      const firstEntry = textElementsRef.current.get(firstTextId)

      if (!firstEntry) return null

      const texts = selectedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')

        if (!id) {
          return []
        }

        const entry = textElementsRef.current.get(id)
        return entry ? [entry.text] : []
      })

      return {
        text: firstEntry.text,
        texts,
        selectedText: selection.toString(),
        pageNumber: firstPageNumber,
        selection
      }
    },
    [buildNormalizedSelection]
  )

  const markVisiblePage = useCallback(
    (pageNumber: number) => {
      markLoadableWithOverscan(pageNumber)
      setVisiblePages((currentPages) => {
        if (currentPages.has(pageNumber)) {
          return currentPages
        }

        const nextPages = new Set(currentPages)
        nextPages.add(pageNumber)
        return nextPages
      })
    },
    [markLoadableWithOverscan]
  )

  const emitSelectionEnd = useCallback(() => {
    if (!onTextSelectionEnd) return

    const selection = window.getSelection()
    if (!selection) return

    const detail = getSelectionDetail(selection)
    if (detail) {
      onTextSelectionEnd(detail.text, detail)
    }
  }, [onTextSelectionEnd, getSelectionDetail])

  useEffect(() => {
    if (!runtimeDocument || pageNumbers.length === 0) {
      return
    }

    markLoadableWithOverscan(pageNumbers[0])

    if (typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageNumber = Number(
          (entry.target as HTMLElement).dataset.pageNumber
        )

        if (!Number.isFinite(pageNumber) || !entry.isIntersecting) {
          return
        }

        markVisiblePage(pageNumber)
      })
    })

    pageNumbers.forEach((pageNumber) => {
      const element = pageRefs.current.get(pageNumber)

      if (element) {
        observer.observe(element)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [markLoadableWithOverscan, markVisiblePage, pageNumbers, runtimeDocument])

  useEffect(() => {
    if (!runtimeDocument) {
      return
    }

    loadablePages.forEach((pageNumber) => {
      if (
        textsByPageNumber.has(pageNumber) ||
        loadingPagesRef.current.has(pageNumber)
      ) {
        return
      }

      let pagePromise: ReturnType<IntermediateDocument['getPageByPageNumber']>

      try {
        pagePromise = runtimeDocument.getPageByPageNumber(pageNumber)
      } catch {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        return
      }

      if (!pagePromise) {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        return
      }

      loadingPagesRef.current.add(pageNumber)
      pagePromise
        .then((page) => {
          return Promise.all([getBaseImageFromPage(page), page.getContent()])
        })
        .then(([baseImage, content]) => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          const texts = content.filter(isIntermediateText)
          setBaseImagesByPageNumber(
            createSetBaseImageHandler(pageNumber, baseImage)
          )
          setTextsByPageNumber(createSetTextsHandler(pageNumber, texts))
          setPageStatuses(createSetPageStatusHandler(pageNumber, 'loaded'))
        })
        .catch(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          setBaseImagesByPageNumber(
            createSetBaseImageHandler(pageNumber, undefined)
          )
          setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
          setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        })
        .finally(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          loadingPagesRef.current.delete(pageNumber)
        })
    })
  }, [loadablePages, runtimeDocument, textsByPageNumber])

  useEffect(() => {
    if (!ocr || !runtimeDocument) {
      return
    }

    const isOcrEnabled =
      ocr === true || (typeof ocr === 'object' && ocr.enabled !== false)

    if (!isOcrEnabled) {
      return
    }

    visiblePages.forEach((pageNumber) => {
      if (
        ocrTextsByPageNumber.has(pageNumber) ||
        ocrLoadingPagesRef.current.has(pageNumber)
      ) {
        return
      }

      const baseImageSource = baseImagesByPageNumber.get(pageNumber)

      if (!baseImageSource) {
        return
      }

      const cacheKey = getOcrCacheKey(
        runtimeDocument.id,
        pageNumber,
        baseImageSource
      )
      const cachedTexts = ocrCacheRef.current.get(cacheKey)

      if (cachedTexts) {
        setOcrTextsByPageNumber((currentTexts) => {
          const nextTexts = new Map(currentTexts)
          nextTexts.set(pageNumber, cachedTexts)
          return nextTexts
        })
        return
      }

      ocrLoadingPagesRef.current.add(pageNumber)

      const runOcr = async () => {
        try {
          const { ImageParser } = await import('@hamster-note/image-parser')
          const input = await getImageParserInput(baseImageSource)
          const ocrDocument = await ImageParser.encode(input)
          const ocrPages = await ocrDocument.pages
          const ocrPage = ocrPages[0]
          const ocrContent = ocrPage?.content ?? []
          const ocrTexts = prefixOcrTextIds(
            ocrContent.filter(isIntermediateText),
            pageNumber
          )

          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          ocrCacheRef.current.set(cacheKey, ocrTexts)
          setOcrTextsByPageNumber(createSetTextsHandler(pageNumber, ocrTexts))
        } catch (error) {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          if (onOcrError) {
            onOcrError(error, { pageNumber })
          }
          // 没有 onOcrError 时静默吞掉，避免在生产代码中遗留 console.warn；
          // 调用方需要可观测性时应主动传入 onOcrError 回调。
        } finally {
          if (
            isMountedRef.current &&
            activeDocumentRef.current === runtimeDocument
          ) {
            ocrLoadingPagesRef.current.delete(pageNumber)
          }
        }
      }

      runOcr()
    })
  }, [
    visiblePages,
    ocr,
    runtimeDocument,
    baseImagesByPageNumber,
    onOcrError,
    ocrTextsByPageNumber
  ])

  const rootClassName = [
    'hamster-reader__intermediate-document-viewer',
    className,
    overlayOptions?.enabled
      ? 'hamster-reader__intermediate-document-viewer--custom-selection'
      : ''
  ]
    .filter(Boolean)
    .join(' ')

  useEffect(() => {
    if (!onTextSelectionChange) return

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection) return

      const detail = getSelectionDetail(selection)
      if (detail) {
        onTextSelectionChange(detail.text, detail)
      }
    }

    globalThis.document.addEventListener(
      'selectionchange',
      handleSelectionChange
    )
    return () => {
      globalThis.document.removeEventListener(
        'selectionchange',
        handleSelectionChange
      )
    }
  }, [onTextSelectionChange, getSelectionDetail])

  const htmlContentRef = useRef(htmlContent)
  htmlContentRef.current = htmlContent
  const htmlParserErrorRef = useRef(htmlParserError)
  htmlParserErrorRef.current = htmlParserError

  const clearOverlay = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    overlayRectsRef.current = []
    if (overlayElRef.current) {
      overlayElRef.current.innerHTML = ''
    }
    overlayContainerRefs.current.forEach((container) => {
      container.innerHTML = ''
    })
    allOverlayContainersRef.current.forEach((container) => {
      container.innerHTML = ''
    })
    setSelectionHandlePositions((prev) => (prev.size === 0 ? prev : new Map()))
  }, [])

  const executeRefreshSelectionOverlay = useCallback(() => {
    rafIdRef.current = null

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !viewerRootRef.current) {
      if (
        preserveOverlayDuringMouseUpRef.current &&
        overlayRectsRef.current.length > 0
      ) {
        return
      }
      clearOverlay()
      return
    }

    const viewerRoot = viewerRootRef.current
    const rects = getSelectionOverlayRects(
      selection,
      viewerRoot,
      pageRefs.current
    )

    overlayRectsRef.current = rects

    if (rects.length === 0) {
      clearOverlay()
      return
    }

    const htmlParserOverlayActive =
      htmlContentRef.current && !htmlParserErrorRef.current

    if (htmlParserOverlayActive) {
      if (overlayElRef.current) {
        const rootRects = rects.map((rect) =>
          getRootOverlayRect(rect, viewerRoot, pageRefs.current)
        )
        const polygons = rectsToUnionPolygons(rootRects)
        const d = polygonsToSvgPath(polygons)
        overlayElRef.current.innerHTML = `<svg class="hamster-reader__selection-overlay-svg" width="100%" height="100%"><path class="hamster-reader__selection-overlay-path" fill-rule="evenodd" d="${d}"/></svg>`
      }
    } else {
      overlayContainerRefs.current.forEach((container, pageNumber) => {
        const pageRects = rects.filter((r) => r.pageNumber === pageNumber)
        if (pageRects.length === 0) {
          container.innerHTML = ''
          return
        }
        const polygons = rectsToUnionPolygons(pageRects)
        const d = polygonsToSvgPath(polygons)
        container.innerHTML = `<svg class="hamster-reader__selection-overlay-svg" width="100%" height="100%"><path class="hamster-reader__selection-overlay-path" fill-rule="evenodd" d="${d}"/></svg>`
      })
    }

    // 根据每页的首/末矩形推导出 start/end 手柄位置（取该矩形底部两角）
    const handlePositions = new Map<
      number,
      {
        start?: ReaderSelectionHandlePosition
        end?: ReaderSelectionHandlePosition
      }
    >()
    const rectsByPage = new Map<number, ReaderSelectionOverlayRect[]>()
    for (const rect of rects) {
      const list = rectsByPage.get(rect.pageNumber)
      if (list) list.push(rect)
      else rectsByPage.set(rect.pageNumber, [rect])
    }
    const sortedPages = Array.from(rectsByPage.keys()).sort((a, b) => a - b)
    sortedPages.forEach((pageNumber, index) => {
      const pageRects = rectsByPage.get(pageNumber) ?? []
      const sorted = [...pageRects].sort((a, b) => {
        const yDiff = a.y - b.y
        return Math.abs(yDiff) < 1 ? a.x - b.x : yDiff
      })
      const entry: {
        start?: ReaderSelectionHandlePosition
        end?: ReaderSelectionHandlePosition
      } = {}
      if (index === 0) {
        const first = sorted[0]
        entry.start = {
          x: first.x,
          y: first.y + first.height,
          pageNumber
        }
      }
      if (index === sortedPages.length - 1) {
        const last = sorted[sorted.length - 1]
        entry.end = {
          x: last.x + last.width,
          y: last.y + last.height,
          pageNumber
        }
      }
      if (htmlParserOverlayActive) {
        if (entry.start) {
          const rootStart = getRootOverlayRect(
            { ...entry.start, width: 0, height: 0 },
            viewerRoot,
            pageRefs.current
          )
          entry.start.rootX = rootStart.x
          entry.start.rootY = rootStart.y
        }
        if (entry.end) {
          const rootEnd = getRootOverlayRect(
            { ...entry.end, width: 0, height: 0 },
            viewerRoot,
            pageRefs.current
          )
          entry.end.rootX = rootEnd.x
          entry.end.rootY = rootEnd.y
        }
      }
      handlePositions.set(pageNumber, entry)
    })
    setSelectionHandlePositions(handlePositions)
  }, [clearOverlay])

  const refreshSelectionOverlay = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    executeRefreshSelectionOverlay()
  }, [executeRefreshSelectionOverlay])

  // 通过 ref 暴露 refreshSelectionOverlay，避免 useCallback 循环依赖
  const refreshSelectionOverlayRef = useRef(refreshSelectionOverlay)
  refreshSelectionOverlayRef.current = refreshSelectionOverlay

  useEffect(() => {
    if (!overlayOptions?.enabled) {
      clearOverlay()
      return
    }

    globalThis.document.addEventListener(
      'selectionchange',
      refreshSelectionOverlay
    )
    globalThis.document.addEventListener('mouseup', refreshSelectionOverlay)

    return () => {
      globalThis.document.removeEventListener(
        'selectionchange',
        refreshSelectionOverlay
      )
      globalThis.document.removeEventListener(
        'mouseup',
        refreshSelectionOverlay
      )
      clearOverlay()
    }
  }, [overlayOptions, clearOverlay, refreshSelectionOverlay])

  useEffect(() => {
    if (!overlayOptions?.enabled) return

    globalThis.window.addEventListener('resize', refreshSelectionOverlay)
    globalThis.document.addEventListener('scroll', refreshSelectionOverlay)

    return () => {
      globalThis.window.removeEventListener('resize', refreshSelectionOverlay)
      globalThis.document.removeEventListener('scroll', refreshSelectionOverlay)
    }
  }, [overlayOptions, refreshSelectionOverlay])

  useEffect(() => {
    const root = viewerRootRef.current
    if (!root) return

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return // Only primary button
      const target = event.target as Node
      if (!root.contains(target)) return
      activeMouseSelectionRef.current = {
        active: true,
        clientX: event.clientX,
        clientY: event.clientY
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!activeMouseSelectionRef.current.active) return
      if (!(event.buttons & 1)) {
        activeMouseSelectionRef.current.active = false
        return
      }
      activeMouseSelectionRef.current.clientX = event.clientX
      activeMouseSelectionRef.current.clientY = event.clientY
      // 拖拽期间持续刷新覆盖层；overlay 启用时才有意义
      if (overlayOptions?.enabled) {
        refreshSelectionOverlay()
      }
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (!activeMouseSelectionRef.current.active) return

      activeMouseSelectionRef.current.clientX = event.clientX
      activeMouseSelectionRef.current.clientY = event.clientY

      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) {
        ignoreNextBlankClickRef.current = true
        preserveOverlayDuringMouseUpRef.current = true
      }

      const finishMouseSelectionAfterCurrentEvent = () => {
        activeMouseSelectionRef.current.active = false

        const currentSelection = window.getSelection()
        if (
          overlayOptions?.enabled &&
          currentSelection &&
          !currentSelection.isCollapsed
        ) {
          refreshSelectionOverlay()
        }

        preserveOverlayDuringMouseUpRef.current = false
      }
      window.setTimeout(finishMouseSelectionAfterCurrentEvent, 0)
    }

    root.addEventListener('mousedown', handleMouseDown)
    root.addEventListener('mousemove', handleMouseMove)
    root.addEventListener('mouseup', handleMouseUp)

    return () => {
      root.removeEventListener('mousedown', handleMouseDown)
      root.removeEventListener('mousemove', handleMouseMove)
      root.removeEventListener('mouseup', handleMouseUp)
    }
  }, [overlayOptions, refreshSelectionOverlay])

  useEffect(() => {
    if (!overlayOptions?.enabled) return

    const root = viewerRootRef.current
    if (!root) return

    // 点击页面空白区域时清除原生 selection 与覆盖层；
    // 排除文本节点、覆盖层、手柄自身的点击。
    const handleBlankClick = (event: MouseEvent) => {
      if (ignoreNextBlankClickRef.current) {
        ignoreNextBlankClickRef.current = false
        return
      }

      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-text-id]')) return
      if (target.closest('.hamster-reader__intermediate-text')) return
      if (target.closest('.hamster-reader__html-parser-output')) return
      if (target.closest('.hamster-reader__selection-overlay')) return
      if (target.closest('.hamster-reader__selection-overlay-path')) return
      if (target.closest('.hamster-reader__selection-handles')) return
      if (target.closest('[data-handle-type]')) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges()
      }
      clearOverlay()
    }

    root.addEventListener('click', handleBlankClick)
    return () => {
      root.removeEventListener('click', handleBlankClick)
    }
  }, [overlayOptions, clearOverlay])

  useEffect(() => {
    if (!onTextSelectionEnd) return

    const root = viewerRootRef.current
    if (!root) return

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) {
        emitSelectionEnd()
      }
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (activeMouseSelectionRef.current.active) {
        activeMouseSelectionRef.current.clientX = event.clientX
        activeMouseSelectionRef.current.clientY = event.clientY
        ignoreNextBlankClickRef.current = true
      }
      emitSelectionEnd()
      activeMouseSelectionRef.current.active = false
    }

    root.addEventListener('mouseup', handleMouseUp)
    root.addEventListener('touchend', emitSelectionEnd)
    root.addEventListener('keyup', handleKeyUp)

    return () => {
      root.removeEventListener('mouseup', handleMouseUp)
      root.removeEventListener('touchend', emitSelectionEnd)
      root.removeEventListener('keyup', handleKeyUp)
    }
  }, [onTextSelectionEnd, emitSelectionEnd])

  const applyHandleDragSelection = useCallback(
    (movingCaretInfo: { range: Range; pageNumber: number }) => {
      const dragState = dragStateRef.current
      if (!dragState.active || !dragState.handleType) {
        return
      }

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return

      let fixedPoint: { node: Node; offset: number } | null = null
      if (dragState.fixedAnchor) {
        // 优先使用 pointerdown 时记录的固定端节点/偏移，
        // 避免因 caretPositionFromPoint 抖动导致固定端漂移
        fixedPoint = {
          node: dragState.fixedAnchor.node,
          offset: dragState.fixedAnchor.offset
        }
      } else if (dragState.fixedPoint) {
        const fixedPageElement = pageRefs.current.get(
          dragState.fixedPoint.pageNumber
        )
        if (!fixedPageElement) return
        const fixedPageRect = fixedPageElement.getBoundingClientRect()
        const fixedCaretInfo = getCaretFromPoint(
          fixedPageRect.left + dragState.fixedPoint.x,
          fixedPageRect.top + dragState.fixedPoint.y,
          viewerRoot,
          pageRefs.current,
          textElementsRef.current
        )
        if (!fixedCaretInfo) return
        fixedPoint = {
          node: fixedCaretInfo.range.startContainer,
          offset: fixedCaretInfo.range.startOffset
        }
        fixedCaretInfo.range.detach()
      }
      if (!fixedPoint) return

      const movingPoint = {
        node: movingCaretInfo.range.startContainer,
        offset: movingCaretInfo.range.startOffset
      }
      const startPoint =
        dragState.handleType === 'start' ? movingPoint : fixedPoint
      const endPoint =
        dragState.handleType === 'start' ? fixedPoint : movingPoint
      const orderRange = globalThis.document.createRange()
      orderRange.setStart(startPoint.node, startPoint.offset)
      orderRange.collapse(true)

      const endIsBeforeStart =
        orderRange.comparePoint(endPoint.node, endPoint.offset) < 0
      orderRange.detach()

      const newRange = globalThis.document.createRange()
      if (endIsBeforeStart) {
        newRange.setStart(endPoint.node, endPoint.offset)
        newRange.setEnd(startPoint.node, startPoint.offset)
      } else {
        newRange.setStart(startPoint.node, startPoint.offset)
        newRange.setEnd(endPoint.node, endPoint.offset)
      }

      const selection = window.getSelection()
      if (selection) {
        selection.removeAllRanges()
        selection.addRange(newRange)
      }
      // 手动触发覆盖层刷新：测试环境下 mock 的 selection 不会自动派发 selectionchange，
      // 真实浏览器中此处也提前刷新，避免拖动期间出现一帧延迟。
      refreshSelectionOverlayRef.current()
    },
    []
  )

  const handleHandlePointerDown = useCallback((event: React.PointerEvent) => {
    const handleElement = (event.target as HTMLElement).closest(
      '[data-handle-type]'
    )
    if (!handleElement) return

    const handleType = handleElement.getAttribute('data-handle-type') as
      | 'start'
      | 'end'
    if (!handleType) return

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const range = selection.getRangeAt(0)
    const viewerRoot = viewerRootRef.current
    if (!viewerRoot) return

    // 记录固定端的实际节点/偏移；start 手柄拖动 → 固定端=range.end，反之亦然
    const fixedAnchor =
      handleType === 'start'
        ? { node: range.endContainer, offset: range.endOffset }
        : { node: range.startContainer, offset: range.startOffset }

    let fixedRange: Range
    if (handleType === 'start') {
      fixedRange = globalThis.document.createRange()
      fixedRange.setStart(range.endContainer, range.endOffset)
      fixedRange.collapse(true)
    } else {
      fixedRange = globalThis.document.createRange()
      fixedRange.setStart(range.startContainer, range.startOffset)
      fixedRange.collapse(true)
    }

    const fixedRect = fixedRange.getBoundingClientRect()
    fixedRange.detach()

    const fixedPageInfo = getPageElementForPoint(
      fixedRect.left,
      fixedRect.top,
      viewerRoot,
      pageRefs.current
    )

    if (!fixedPageInfo) return

    const fixedPageRect = fixedPageInfo.pageElement.getBoundingClientRect()

    dragStateRef.current = {
      active: true,
      handleType,
      fixedPoint: {
        x: fixedRect.left - fixedPageRect.left,
        y: fixedRect.top - fixedPageRect.top,
        pageNumber: fixedPageInfo.pageNumber
      },
      fixedAnchor
    }
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)

    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleHandlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragStateRef.current.active || !dragStateRef.current.handleType)
        return

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return

      const caretInfo = getCaretFromPoint(
        event.clientX,
        event.clientY,
        viewerRoot,
        pageRefs.current,
        textElementsRef.current
      )

      if (!caretInfo) return

      applyHandleDragSelection(caretInfo)
      caretInfo.range.detach()

      event.preventDefault()
      event.stopPropagation()
    },
    [applyHandleDragSelection]
  )

  const handleHandlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!dragStateRef.current.active) return

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return

      const caretInfo = getCaretFromPoint(
        event.clientX,
        event.clientY,
        viewerRoot,
        pageRefs.current,
        textElementsRef.current
      )

      if (caretInfo) {
        applyHandleDragSelection(caretInfo)
        caretInfo.range.detach()
      }

      dragStateRef.current = {
        active: false,
        handleType: null,
        fixedPoint: null,
        fixedAnchor: null
      }

      event.preventDefault()
      event.stopPropagation()
    },
    [applyHandleDragSelection]
  )

  const renderSelectionHandle = useCallback(
    (
      type: 'start' | 'end',
      position: ReaderSelectionHandlePosition
    ): React.ReactNode => {
      if (selectionHandleElement === null) return null
      const baseStyle: React.CSSProperties = {
        position: 'absolute',
        left: `${position.rootX ?? position.x}px`,
        top: `${position.rootY ?? position.y}px`,
        pointerEvents: 'auto'
      }
      const baseClassName = `hamster-reader__selection-handle hamster-reader__selection-handle--${type}`

      if (selectionHandleElement === undefined) {
        // 默认 Android 水滴样式手柄；具体外观由 SCSS 控制
        return (
          <div
            key={type}
            data-handle-type={type}
            className={`${baseClassName} hamster-reader__selection-handle--default hamster-reader__selection-handle--default-${type}`}
            style={baseStyle}
          />
        )
      }

      const existingProps = (selectionHandleElement.props ?? {}) as {
        className?: string
        style?: React.CSSProperties
      }
      const mergedClassName = [existingProps.className, baseClassName]
        .filter(Boolean)
        .join(' ')
      const mergedStyle: React.CSSProperties = {
        ...(existingProps.style ?? {}),
        ...baseStyle
      }
      return React.cloneElement(
        selectionHandleElement as React.ReactElement<{
          className?: string
          style?: React.CSSProperties
          'data-handle-type'?: string
          key?: string
        }>,
        {
          key: type,
          className: mergedClassName,
          style: mergedStyle,
          'data-handle-type': type
        }
      )
    },
    [selectionHandleElement]
  )

  if (!runtimeDocument) {
    return (
      <div
        className={rootClassName}
        data-testid='intermediate-document-viewer'
      />
    )
  }

  return (
    <div
      ref={viewerRootRef}
      role='document'
      className={rootClassName}
      data-testid='intermediate-document-viewer'
      onPointerDown={handleHandlePointerDown}
      onPointerMove={handleHandlePointerMove}
      onPointerUp={handleHandlePointerUp}
    >
      {htmlContent && !htmlParserError ? (
        <>
          <div
            className='hamster-reader__html-parser-output'
            data-testid='html-parser-output'
            // The HTML comes from the trusted @hamster-note/html-parser package,
            // which converts IntermediateDocument data into HTML fragments.
            // Text selection hooks do not rely on this path because it may lack data-text-id attributes.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted html-parser output
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
          {overlayOptions?.enabled && (
            <div
              ref={(el) => {
                overlayElRef.current = el
                if (el) {
                  allOverlayContainersRef.current.add(el)
                }
              }}
              className='hamster-reader__selection-overlay'
              style={
                {
                  '--hamster-reader-selection-color': overlayOptions.color,
                  '--hamster-reader-selection-opacity': overlayOptions.opacity
                } as React.CSSProperties
              }
            />
          )}
          {overlayOptions?.enabled && selectionHandleElement !== null && (
            <div
              className='hamster-reader__selection-handles'
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none'
              }}
            >
              {Array.from(selectionHandlePositions.entries()).flatMap(
                ([pageNumber, entry]) => {
                  const nodes: React.ReactNode[] = []
                  if (entry.start) {
                    nodes.push(
                      <React.Fragment key={`start-${pageNumber}`}>
                        {renderSelectionHandle('start', entry.start)}
                      </React.Fragment>
                    )
                  }
                  if (entry.end) {
                    nodes.push(
                      <React.Fragment key={`end-${pageNumber}`}>
                        {renderSelectionHandle('end', entry.end)}
                      </React.Fragment>
                    )
                  }
                  return nodes
                }
              )}
            </div>
          )}
        </>
      ) : (
        pageNumbers.map((pageNumber) => {
          const pageSize = normalizePageSize(
            runtimeDocument.getPageSizeByPageNumber(pageNumber)
          )
          const texts = textsByPageNumber.get(pageNumber) ?? []
          const ocrTexts = ocrTextsByPageNumber.get(pageNumber) ?? []
          const allTexts = [...texts, ...ocrTexts]
          const pageStatus = pageStatuses.get(pageNumber)
          const isPageLoading =
            loadablePages.has(pageNumber) &&
            pageStatus !== 'loaded' &&
            pageStatus !== 'error'
          const pageClassName = isPageLoading
            ? 'hamster-reader__intermediate-page hamster-reader__intermediate-page--loading'
            : 'hamster-reader__intermediate-page'

          const baseImageSource = baseImagesByPageNumber.get(pageNumber)

          return (
            <div
              key={pageNumber}
              ref={setPageRef(pageNumber)}
              className={pageClassName}
              data-testid={`intermediate-page-${pageNumber}`}
              data-page-number={pageNumber}
              data-page-size-unavailable={
                pageSize.pageSizeUnavailable ? 'true' : undefined
              }
              style={{
                position: 'relative',
                width: `${pageSize.width}px`,
                height: `${pageSize.height}px`,
                overflow: 'hidden'
              }}
            >
              {baseImageSource && (
                <img
                  className='hamster-reader__intermediate-page-base-image'
                  src={baseImageSource}
                  alt=''
                  aria-hidden='true'
                />
              )}
              {overlayOptions?.enabled && (
                <div
                  ref={(el) => {
                    if (el) {
                      overlayContainerRefs.current.set(pageNumber, el)
                      allOverlayContainersRef.current.add(el)
                    } else {
                      overlayContainerRefs.current.delete(pageNumber)
                    }
                  }}
                  className='hamster-reader__selection-overlay'
                  style={
                    {
                      '--hamster-reader-selection-color': overlayOptions.color,
                      '--hamster-reader-selection-opacity':
                        overlayOptions.opacity
                    } as React.CSSProperties
                  }
                />
              )}
              {overlayOptions?.enabled && selectionHandleElement !== null && (
                <div
                  className='hamster-reader__selection-handles'
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none'
                  }}
                >
                  {(() => {
                    const entry = selectionHandlePositions.get(pageNumber)
                    if (!entry) return null
                    return (
                      <>
                        {entry.start &&
                          renderSelectionHandle('start', entry.start)}
                        {entry.end && renderSelectionHandle('end', entry.end)}
                      </>
                    )
                  })()}
                </div>
              )}
              {isPageLoading && (
                <div className='hamster-reader__intermediate-page-status'>
                  Loading page {pageNumber}…
                </div>
              )}
              {pageStatus === 'error' && (
                <div className='hamster-reader__intermediate-page-status hamster-reader__intermediate-page-status--error'>
                  Failed to load page {pageNumber}
                </div>
              )}
              {allTexts.map((textData) => {
                const text = textData as RenderableIntermediateText
                const bbox = getTextBbox(text)
                const style = buildTextSpanStyle(text, bbox)

                return (
                  <span
                    key={text.id}
                    ref={setTextRef(text, pageNumber)}
                    className='hamster-reader__intermediate-text'
                    data-text-id={text.id}
                    data-page-number={pageNumber}
                    style={style}
                  >
                    {text.content}
                  </span>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
