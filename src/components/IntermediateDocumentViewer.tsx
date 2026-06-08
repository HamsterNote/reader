import type { DecodeOptions } from '@hamster-note/html-parser'
import { HtmlParser } from '@hamster-note/html-parser'
import type {
  IntermediateContent,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { IntermediateDocument } from '@hamster-note/types'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  getNearestTextElementForPoint,
  getPageElementByPageNumber,
  getPageElementForPoint,
  isSelectionBackgroundTarget,
  resolveCaret
} from './selection/caretResolver'
import {
  createDragSelectionAdapter,
  type DragSelectionAdapter
} from './selection/dragSelectionAdapter'
import {
  composeSelection,
  createOrderedRange
} from './selection/selectionComposer'
import {
  buildSelectionPayload,
  buildSelectionPayloadFromTexts,
  getClosestTextElement,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload,
  textElementRecords
} from './selection/selectionPayloadSerializer'
import { polygonsToSvgPath, rectsToUnionPolygons } from './selectionGeometry'

export {
  getNearestTextElementForPoint,
  getPageElementByPageNumber,
  getPageElementForPoint,
  resolveCaret
} from './selection/caretResolver'
export {
  composeSelection,
  createOrderedRange
} from './selection/selectionComposer'
export {
  buildSelectionPayload,
  getClosestTextElement,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload,
  textElementRecords
} from './selection/selectionPayloadSerializer'

export type ReaderTextSelectionDetail = {
  text: IntermediateText
  texts: IntermediateText[]
  selectedText: string
  pageNumber: number
  selection: Selection
}

export type ReaderSelectedTextDragCallback = (
  selection: Selection,
  segments: ReaderSelectedTextSegment[],
  extractedText: string
) => void

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
  /** 覆盖层颜色，默认 '#ec4899' */
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
  onSelectText?: (
    selection: Selection,
    segments: ReaderSelectedTextSegment[],
    extractedText: string
  ) => void
  onDragSelectedTextStart?: ReaderSelectedTextDragCallback
  onDragSelectedTextMove?: ReaderSelectedTextDragCallback
  onDragSelectedTextEnd?: ReaderSelectedTextDragCallback
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

const getVisiblePageNumbers = (
  allPageNumbers: number[],
  pageRange: ReaderPageRange | undefined
) => {
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
}

const isRuntimeDocument = (
  document: IntermediateDocument | IntermediateDocumentSerialized
): document is IntermediateDocument =>
  typeof (document as IntermediateDocument).getPageByPageNumber === 'function'

const getRuntimeDocument = (
  inputDocument:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
) => {
  if (!inputDocument) return null
  return isRuntimeDocument(inputDocument)
    ? inputDocument
    : IntermediateDocument.parse(inputDocument)
}

const getSelectionOverlayOptions = (
  selectionOverlay: IntermediateDocumentViewerProps['selectionOverlay']
) => {
  if (!selectionOverlay) return null
  if (selectionOverlay === true) {
    return { color: '#ec4899', opacity: 0.3, enabled: true }
  }
  return {
    color: selectionOverlay.color ?? '#ec4899',
    opacity: selectionOverlay.opacity ?? 0.3,
    enabled: selectionOverlay.enabled ?? true
  }
}

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
  const pageElement = getPageElementByPageNumber(
    rect.pageNumber,
    viewerRoot,
    pageRefs
  )
  if (!pageElement) return rect

  const pageRect = pageElement.getBoundingClientRect()
  const rootRect = viewerRoot.getBoundingClientRect()

  return {
    ...rect,
    x: pageRect.left - rootRect.left + viewerRoot.scrollLeft + rect.x,
    y: pageRect.top - rootRect.top + viewerRoot.scrollTop + rect.y
  }
}

// Compute one boundary handle anchor point from a Selection's range.
// - 'start' → anchor at the LEFT edge of the collapsed-start rect (handle body
//   renders OUTSIDE/LEFT of selection so it never covers the first character).
// - 'end' → anchor at the RIGHT edge of the collapsed-end rect.
// Always returns page-relative coordinates plus the resolved page number.
const buildBoundaryHandlePosition = (
  range: Range,
  type: 'start' | 'end',
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>
): { x: number; y: number; pageNumber: number } | null => {
  const collapsedRange = range.cloneRange()
  collapsedRange.collapse(type === 'start')
  const collapsedRects = Array.from(collapsedRange.getClientRects())

  let boundaryRect:
    | DOMRect
    | { left: number; right: number; top: number; bottom: number }
  if (collapsedRects.length === 0) {
    boundaryRect = collapsedRange.getBoundingClientRect()
  } else if (type === 'start') {
    boundaryRect = collapsedRects[0]
  } else {
    boundaryRect = collapsedRects[collapsedRects.length - 1]
  }

  const anchorX = type === 'start' ? boundaryRect.left : boundaryRect.right
  const anchorY = boundaryRect.bottom

  const pageInfo = getPageElementForPoint(
    anchorX,
    anchorY,
    viewerRoot,
    pageRefs
  )
  if (!pageInfo) return null

  const pageRect = pageInfo.pageElement.getBoundingClientRect()
  return {
    x: anchorX - pageRect.left,
    y: anchorY - pageRect.top,
    pageNumber: pageInfo.pageNumber
  }
}

// Assemble per-page handle positions from a selection range, optionally
// computing viewer-root-relative coordinates for html-parser mode where pages
// are not direct ancestors of the overlay layer.
const buildSelectionHandlePositions = (
  range: Range,
  viewerRoot: HTMLElement,
  pageRefs: Map<number, HTMLDivElement>,
  htmlParserOverlayActive: boolean
): Map<
  number,
  { start?: ReaderSelectionHandlePosition; end?: ReaderSelectionHandlePosition }
> => {
  const handlePositions = new Map<
    number,
    {
      start?: ReaderSelectionHandlePosition
      end?: ReaderSelectionHandlePosition
    }
  >()

  const startPosition = buildBoundaryHandlePosition(
    range,
    'start',
    viewerRoot,
    pageRefs
  )
  if (startPosition) {
    const entry = handlePositions.get(startPosition.pageNumber) ?? {}
    entry.start = {
      x: startPosition.x,
      y: startPosition.y,
      pageNumber: startPosition.pageNumber
    }
    if (htmlParserOverlayActive) {
      const rootStart = getRootOverlayRect(
        { ...entry.start, width: 0, height: 0 },
        viewerRoot,
        pageRefs
      )
      entry.start.rootX = rootStart.x
      entry.start.rootY = rootStart.y
    }
    handlePositions.set(startPosition.pageNumber, entry)
  }

  const endPosition = buildBoundaryHandlePosition(
    range,
    'end',
    viewerRoot,
    pageRefs
  )
  if (endPosition) {
    const entry = handlePositions.get(endPosition.pageNumber) ?? {}
    entry.end = {
      x: endPosition.x,
      y: endPosition.y,
      pageNumber: endPosition.pageNumber
    }
    if (htmlParserOverlayActive) {
      const rootEnd = getRootOverlayRect(
        { ...entry.end, width: 0, height: 0 },
        viewerRoot,
        pageRefs
      )
      entry.end.rootX = rootEnd.x
      entry.end.rootY = rootEnd.y
    }
    handlePositions.set(endPosition.pageNumber, entry)
  }

  return handlePositions
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

type SelectedTextBodyDragState = {
  active: boolean
  pointerId: number | null
  overlayElement: HTMLElement | null
  payload: ReaderSelectionPayload | null
}

type SelectedTextBodyDragAdapterEntry = {
  adapter: DragSelectionAdapter
  stopActivePointerEvent: (event: Event) => void
}

const emptySelectedTextBodyDragState = (): SelectedTextBodyDragState => ({
  active: false,
  pointerId: null,
  overlayElement: null,
  payload: null
})

const useSelectedTextBodyDrag = ({
  viewerRootRef,
  pageRefs,
  overlayRectsRef,
  onDragSelectedTextStart,
  onDragSelectedTextMove,
  onDragSelectedTextEnd
}: {
  viewerRootRef: { current: HTMLDivElement | null }
  pageRefs: { current: Map<number, HTMLDivElement> }
  overlayRectsRef: { current: ReaderSelectionOverlayRect[] }
  onDragSelectedTextStart?: ReaderSelectedTextDragCallback
  onDragSelectedTextMove?: ReaderSelectedTextDragCallback
  onDragSelectedTextEnd?: ReaderSelectedTextDragCallback
}) => {
  const bodyDragStateRef = useRef<SelectedTextBodyDragState>(
    emptySelectedTextBodyDragState()
  )
  const bodyDragRafIdRef = useRef<number | null>(null)
  const bodyDragAdaptersRef = useRef(
    new Map<HTMLElement, SelectedTextBodyDragAdapterEntry>()
  )
  const beginBodyDragRef = useRef<
    (overlayElement: HTMLElement, clientX: number, clientY: number) => boolean
  >((_overlayElement, _clientX, _clientY) => false)
  const moveBodyDragRef = useRef((_clientX: number, _clientY: number) => {})
  const finishBodyDragRef = useRef((_clientX: number, _clientY: number) => {})
  const bodyDragCallbacksEnabled = Boolean(
    onDragSelectedTextStart || onDragSelectedTextMove || onDragSelectedTextEnd
  )

  const isPointInsideSelectionBody = useCallback(
    (clientX: number, clientY: number) => {
      const viewerRoot = viewerRootRef.current
      if (!viewerRoot || overlayRectsRef.current.length === 0) return false

      const pageInfo = getPageElementForPoint(
        clientX,
        clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pageInfo) return false

      const pageRect = pageInfo.pageElement.getBoundingClientRect()
      const pageX = clientX - pageRect.left
      const pageY = clientY - pageRect.top

      return overlayRectsRef.current.some((rect) => {
        if (rect.pageNumber !== pageInfo.pageNumber) return false
        return (
          pageX >= rect.x &&
          pageX <= rect.x + rect.width &&
          pageY >= rect.y &&
          pageY <= rect.y + rect.height
        )
      })
    },
    [overlayRectsRef, pageRefs, viewerRootRef]
  )

  const cancelPendingBodyDragMove = useCallback(() => {
    if (bodyDragRafIdRef.current !== null) {
      cancelAnimationFrame(bodyDragRafIdRef.current)
      bodyDragRafIdRef.current = null
    }
  }, [])

  const resetBodyDragState = useCallback(() => {
    bodyDragStateRef.current = emptySelectedTextBodyDragState()
  }, [])

  const beginBodyDrag = useCallback(
    (overlayElement: HTMLElement, clientX: number, clientY: number) => {
      if (!bodyDragCallbacksEnabled) return false
      if (!isPointInsideSelectionBody(clientX, clientY)) return false

      // Retained as a payload source only: body dragging is initiated by the
      // per-overlay Drag adapter, then reads the current composed Selection to
      // preserve the legacy selected-text drag callback arguments.
      const selection = window.getSelection()
      if (!selection) return false

      const payload = buildSelectionPayload(selection)
      if (!payload) return false

      bodyDragStateRef.current = {
        active: true,
        pointerId: null,
        overlayElement,
        payload
      }

      if (onDragSelectedTextStart) {
        onDragSelectedTextStart(
          payload.selection,
          payload.segments,
          payload.extractedText
        )
      }

      return true
    },
    [
      bodyDragCallbacksEnabled,
      isPointInsideSelectionBody,
      onDragSelectedTextStart
    ]
  )

  const handleBodyDragMove = useCallback(
    (_clientX: number, _clientY: number) => {
      if (!bodyDragStateRef.current.active) return
      if (!onDragSelectedTextMove || bodyDragRafIdRef.current !== null) return

      bodyDragRafIdRef.current = requestAnimationFrame(() => {
        bodyDragRafIdRef.current = null
        const payload = bodyDragStateRef.current.payload
        if (!bodyDragStateRef.current.active || !payload) return
        onDragSelectedTextMove(
          payload.selection,
          payload.segments,
          payload.extractedText
        )
      })
    },
    [onDragSelectedTextMove]
  )

  const finishBodyDrag = useCallback(
    (_clientX: number, _clientY: number) => {
      const bodyDragState = bodyDragStateRef.current
      if (!bodyDragState.active) return

      cancelPendingBodyDragMove()
      const payload = bodyDragState.payload
      resetBodyDragState()

      if (payload && onDragSelectedTextEnd) {
        onDragSelectedTextEnd(
          payload.selection,
          payload.segments,
          payload.extractedText
        )
      }
    },
    [cancelPendingBodyDragMove, onDragSelectedTextEnd, resetBodyDragState]
  )

  beginBodyDragRef.current = beginBodyDrag
  moveBodyDragRef.current = handleBodyDragMove
  finishBodyDragRef.current = finishBodyDrag

  const handleSelectionOverlayDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (bodyDragCallbacksEnabled) {
        event.preventDefault()
      }
    },
    [bodyDragCallbacksEnabled]
  )

  const destroyBodyDragAdapters = useCallback(() => {
    bodyDragAdaptersRef.current.forEach((entry, element) => {
      // These native pointer listeners are guards, not body-drag lifecycle
      // handlers. Drag owns start/move/end; the guards only stop an already
      // active overlay drag from bubbling into the root text-selection adapter.
      element.removeEventListener('pointerdown', entry.stopActivePointerEvent)
      element.removeEventListener('pointermove', entry.stopActivePointerEvent)
      element.removeEventListener('pointerup', entry.stopActivePointerEvent)
      element.removeEventListener('pointercancel', entry.stopActivePointerEvent)
      entry.adapter.destroy()
    })
    bodyDragAdaptersRef.current.clear()
  }, [])

  useEffect(() => {
    if (!bodyDragCallbacksEnabled) {
      destroyBodyDragAdapters()
      return
    }

    const viewerRoot = viewerRootRef.current
    if (!viewerRoot) {
      destroyBodyDragAdapters()
      return
    }

    const currentOverlayElements = new Set(
      Array.from(
        viewerRoot.querySelectorAll<HTMLElement>(
          '.hamster-reader__selection-overlay'
        )
      )
    )

    bodyDragAdaptersRef.current.forEach((entry, element) => {
      if (currentOverlayElements.has(element)) return

      // Stale overlay guards are lifecycle cleanup for Drag-owned body drags;
      // they do not initiate selection.
      element.removeEventListener('pointerdown', entry.stopActivePointerEvent)
      element.removeEventListener('pointermove', entry.stopActivePointerEvent)
      element.removeEventListener('pointerup', entry.stopActivePointerEvent)
      element.removeEventListener('pointercancel', entry.stopActivePointerEvent)
      entry.adapter.destroy()
      bodyDragAdaptersRef.current.delete(element)
    })

    currentOverlayElements.forEach((element) => {
      if (bodyDragAdaptersRef.current.has(element)) return

      const adapter = createDragSelectionAdapter(element, {
        onStart: (clientX, clientY) => {
          beginBodyDragRef.current(element, clientX, clientY)
        },
        onMove: (clientX, clientY) => {
          moveBodyDragRef.current(clientX, clientY)
        },
        onEnd: (clientX, clientY) => {
          finishBodyDragRef.current(clientX, clientY)
        },
        onAllEnd: (clientX, clientY) => {
          finishBodyDragRef.current(clientX, clientY)
        }
      })
      // Guard only: registered after the Drag adapter so Drag observes the
      // pointer first, then native propagation is suppressed while active.
      const stopActivePointerEvent = (event: Event) => {
        if (!bodyDragStateRef.current.active) return

        event.preventDefault()
        event.stopPropagation()
      }

      element.addEventListener('pointerdown', stopActivePointerEvent)
      element.addEventListener('pointermove', stopActivePointerEvent)
      element.addEventListener('pointerup', stopActivePointerEvent)
      element.addEventListener('pointercancel', stopActivePointerEvent)
      bodyDragAdaptersRef.current.set(element, {
        adapter,
        stopActivePointerEvent
      })
    })
  })

  useEffect(
    () => () => {
      cancelPendingBodyDragMove()
      resetBodyDragState()
      destroyBodyDragAdapters()
    },
    [cancelPendingBodyDragMove, destroyBodyDragAdapters, resetBodyDragState]
  )

  const overlayBodyDragProps = useMemo(
    () =>
      bodyDragCallbacksEnabled
        ? {
            onDragStart: handleSelectionOverlayDragStart
          }
        : {},
    [bodyDragCallbacksEnabled, handleSelectionOverlayDragStart]
  )

  const overlayBodyDragStyle = useMemo<React.CSSProperties>(
    () =>
      bodyDragCallbacksEnabled
        ? { pointerEvents: 'auto', touchAction: 'none' }
        : {},
    [bodyDragCallbacksEnabled]
  )

  return {
    bodyDragCallbacksEnabled,
    overlayBodyDragProps,
    overlayBodyDragStyle
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
  onSelectText,
  onDragSelectedTextStart,
  onDragSelectedTextMove,
  onDragSelectedTextEnd,
  selectionOverlay,
  selectionHandleElement
}: IntermediateDocumentViewerProps) {
  const runtimeDocument = useMemo(() => {
    const inputDocument = document ?? serializedDocument
    return getRuntimeDocument(inputDocument)
  }, [document, serializedDocument])

  const pageNumbers = useMemo(() => {
    const allPageNumbers = runtimeDocument?.pageNumbers ?? []
    return getVisiblePageNumbers(allPageNumbers, pageRange)
  }, [runtimeDocument, pageRange])
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const loadingPagesRef = useRef(new Set<number>())
  const ocrLoadingPagesRef = useRef(new Set<number>())
  const ocrCacheRef = useRef(new Map<string, IntermediateText[]>())
  const activeDocumentRef = useRef<IntermediateDocument | null>(null)
  const isMountedRef = useRef(false)
  const viewerRootRef = useRef<HTMLDivElement>(null)
  const [viewerRootElement, setViewerRootElement] =
    useState<HTMLDivElement | null>(null)
  const textElementsRef = useRef<
    Map<string, { text: IntermediateText; pageNumber: number }>
  >(new Map())
  const boundedDirectRenderPayloadsRef = useRef(
    new WeakMap<ReaderTextSelectionDetail, ReaderSelectionPayload>()
  )
  const activeMouseSelectionRef = useRef<{
    active: boolean
    startClientX: number
    startClientY: number
    clientX: number
    clientY: number
  }>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    clientX: 0,
    clientY: 0
  })
  const dragSelectionAnchorRef = useRef<{
    node: Node
    offset: number
  } | null>(null)
  const dragSelectionEndEmittedRef = useRef(false)
  const skipNextMouseUpSelectionEndRef = useRef(false)
  const lastDragComposedSelectionRef = useRef<{
    selection: Selection
    selectedText: string
  } | null>(null)
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

  const overlayOptions = useMemo(
    () => getSelectionOverlayOptions(selectionOverlay),
    [selectionOverlay]
  )
  const selectionHandleAdapterKey = useMemo(
    () =>
      Array.from(selectionHandlePositions.entries())
        .flatMap(([pageNumber, entry]) => [
          entry.start ? `${pageNumber}:start` : '',
          entry.end ? `${pageNumber}:end` : ''
        ])
        .filter(Boolean)
        .join('|'),
    [selectionHandlePositions]
  )
  const {
    bodyDragCallbacksEnabled,
    overlayBodyDragProps,
    overlayBodyDragStyle
  } = useSelectedTextBodyDrag({
    viewerRootRef,
    pageRefs,
    overlayRectsRef,
    onDragSelectedTextStart,
    onDragSelectedTextMove,
    onDragSelectedTextEnd
  })

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

  const setViewerRootRef = useCallback((element: HTMLDivElement | null) => {
    viewerRootRef.current = element
    setViewerRootElement(element)
  }, [])

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
          textElementRecords.set(element, { text, pageNumber })
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

  const buildSelectionDetailBetweenElements = useCallback(
    (
      selection: Selection,
      viewerRoot: HTMLElement,
      startElement: HTMLElement,
      endElement: HTMLElement
    ): ReaderTextSelectionDetail | null => {
      const startId = startElement.getAttribute('data-text-id')
      const endId = endElement.getAttribute('data-text-id')
      if (!startId || !endId) return null

      const startEntry = textElementsRef.current.get(startId)
      const endEntry = textElementsRef.current.get(endId)
      if (!startEntry || !endEntry) return null

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
      const orderedEntries = sortedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')
        if (!id) return []
        const entry = textElementsRef.current.get(id)
        return entry ? [entry] : []
      })
      const texts = orderedEntries.map((entry) => entry.text)

      if (texts.length === 0) return null

      const selectedText = texts.map((text) => text.content ?? '').join('')

      const detail = {
        text: texts[0],
        texts,
        selectedText,
        pageNumber: orderedEntries[0].pageNumber,
        selection
      }
      const payload = buildSelectionPayloadFromTexts(selection, texts)
      if (payload) {
        boundedDirectRenderPayloadsRef.current.set(detail, payload)
      }

      return detail
    },
    []
  )

  const getNearestActiveTextElementForPoint = useCallback(
    (
      point: { clientX: number; clientY: number },
      viewerRoot: HTMLElement
    ): HTMLElement | null => {
      const pageInfo = getPageElementForPoint(
        point.clientX,
        point.clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pageInfo) return null

      return getNearestTextElementForPoint(
        point.clientX,
        point.clientY,
        pageInfo.pageNumber,
        viewerRoot,
        textElementsRef.current
      )
    },
    []
  )

  const buildPointerClampedSelection = useCallback(
    (
      selection: Selection,
      viewerRoot: HTMLElement
    ): ReaderTextSelectionDetail | null => {
      if (!activeMouseSelectionRef.current.active) return null

      const startElement = getNearestActiveTextElementForPoint(
        {
          clientX: activeMouseSelectionRef.current.startClientX,
          clientY: activeMouseSelectionRef.current.startClientY
        },
        viewerRoot
      )
      if (!startElement) return null

      const pointerPageInfo = getPageElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pointerPageInfo) return null

      const snappedFocusElement = getNearestTextElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        pointerPageInfo.pageNumber,
        viewerRoot,
        textElementsRef.current
      )
      if (!snappedFocusElement) return null

      return buildSelectionDetailBetweenElements(
        selection,
        viewerRoot,
        startElement,
        snappedFocusElement
      )
    },
    [buildSelectionDetailBetweenElements, getNearestActiveTextElementForPoint]
  )

  const getDirectTextElementForPoint = useCallback(
    (
      point: { clientX: number; clientY: number },
      viewerRoot: HTMLElement
    ): HTMLElement | null => {
      const pointElement = viewerRoot.ownerDocument.elementFromPoint?.(
        point.clientX,
        point.clientY
      )
      const textElement = pointElement?.closest('[data-text-id]')
      return textElement instanceof HTMLElement &&
        viewerRoot.contains(textElement)
        ? textElement
        : null
    },
    []
  )

  const isOverBroadDirectRenderSelection = useCallback(
    (selectedElements: HTMLElement[], viewerRoot: HTMLElement): boolean => {
      const selectedIds = new Set(
        selectedElements.flatMap((element) => {
          const id = element.getAttribute('data-text-id')
          return id ? [id] : []
        })
      )
      const pageTextCounts = new Map<number, number>()
      const selectedPageTextCounts = new Map<number, number>()

      viewerRoot.querySelectorAll('[data-text-id]').forEach((element) => {
        if (!(element instanceof HTMLElement)) return

        const textId = element.getAttribute('data-text-id')
        if (!textId || !textElementsRef.current.has(textId)) return

        const pageNumber = Number(element.getAttribute('data-page-number'))
        if (!Number.isFinite(pageNumber)) return

        pageTextCounts.set(
          pageNumber,
          (pageTextCounts.get(pageNumber) ?? 0) + 1
        )
        if (selectedIds.has(textId)) {
          selectedPageTextCounts.set(
            pageNumber,
            (selectedPageTextCounts.get(pageNumber) ?? 0) + 1
          )
        }
      })

      for (const [pageNumber, pageTextCount] of pageTextCounts) {
        // 单个文本 span 的页面常见且合法；至少 3 个 span 才能代表“页面级”误选。
        if (pageTextCount < 3) continue

        const selectedCount = selectedPageTextCounts.get(pageNumber) ?? 0
        if (selectedCount >= Math.ceil(pageTextCount * 0.9)) {
          return true
        }
      }

      return false
    },
    []
  )

  const hasValidActiveSelectionBoundaries = useCallback(
    (selectedElements: HTMLElement[], viewerRoot: HTMLElement): boolean => {
      if (!activeMouseSelectionRef.current.active) return false

      const firstTextId = selectedElements[0]?.getAttribute('data-text-id')
      const lastTextId =
        selectedElements[selectedElements.length - 1]?.getAttribute(
          'data-text-id'
        )
      if (!firstTextId || !lastTextId) return false

      const startElement = getNearestActiveTextElementForPoint(
        {
          clientX: activeMouseSelectionRef.current.startClientX,
          clientY: activeMouseSelectionRef.current.startClientY
        },
        viewerRoot
      )
      const endElement = getNearestActiveTextElementForPoint(
        {
          clientX: activeMouseSelectionRef.current.clientX,
          clientY: activeMouseSelectionRef.current.clientY
        },
        viewerRoot
      )
      const startTextId = startElement?.getAttribute('data-text-id')
      const endTextId = endElement?.getAttribute('data-text-id')
      const firstPageNumber = Number(selectedElements[0]?.dataset.pageNumber)
      const lastPageNumber = Number(
        selectedElements[selectedElements.length - 1]?.dataset.pageNumber
      )

      if (firstPageNumber === lastPageNumber) {
        const directStartTextId = getDirectTextElementForPoint(
          {
            clientX: activeMouseSelectionRef.current.startClientX,
            clientY: activeMouseSelectionRef.current.startClientY
          },
          viewerRoot
        )?.getAttribute('data-text-id')
        const directEndTextId = getDirectTextElementForPoint(
          {
            clientX: activeMouseSelectionRef.current.clientX,
            clientY: activeMouseSelectionRef.current.clientY
          },
          viewerRoot
        )?.getAttribute('data-text-id')

        return (
          (directStartTextId === firstTextId &&
            directEndTextId === lastTextId) ||
          (directStartTextId === lastTextId && directEndTextId === firstTextId)
        )
      }

      return (
        (startTextId === firstTextId && endTextId === lastTextId) ||
        (startTextId === lastTextId && endTextId === firstTextId)
      )
    },
    [getDirectTextElementForPoint, getNearestActiveTextElementForPoint]
  )

  const shouldRejectOverBroadSelection = useCallback(
    (
      selectedElements: HTMLElement[],
      viewerRoot: HTMLElement,
      firstPageNumber: number,
      lastPageNumber: number
    ): boolean => {
      if (!isOverBroadDirectRenderSelection(selectedElements, viewerRoot)) {
        return false
      }

      if (!activeMouseSelectionRef.current.active) return true

      return (
        firstPageNumber === lastPageNumber &&
        !hasValidActiveSelectionBoundaries(selectedElements, viewerRoot)
      )
    },
    [hasValidActiveSelectionBoundaries, isOverBroadDirectRenderSelection]
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
      const lastElement = selectedElements[selectedElements.length - 1]
      const firstTextId = firstElement.getAttribute('data-text-id')
      const firstPageNumber = Number(
        firstElement.getAttribute('data-page-number')
      )
      const lastPageNumber = Number(
        lastElement.getAttribute('data-page-number')
      )
      if (
        shouldRejectOverBroadSelection(
          selectedElements,
          viewerRoot,
          firstPageNumber,
          lastPageNumber
        )
      ) {
        return null
      }

      if (
        activeMouseSelectionRef.current.active &&
        firstPageNumber !== lastPageNumber
      ) {
        const pointerClampedDetail = buildPointerClampedSelection(
          selection,
          viewerRoot
        )
        if (pointerClampedDetail) return pointerClampedDetail
      }

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
    [
      buildNormalizedSelection,
      buildPointerClampedSelection,
      shouldRejectOverBroadSelection
    ]
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
    if (!onTextSelectionEnd && !onSelectText && !bodyDragCallbacksEnabled) {
      return
    }

    // Retained as a payload source only. Gesture completion is driven by Drag
    // (or by external/native Selection fallbacks below); this reads the live
    // composed Selection to emit public callbacks without changing their API.
    const selection = window.getSelection()
    if (!selection) return

    const detail = getSelectionDetail(selection)
    if (!detail) return

    if (onTextSelectionEnd) {
      onTextSelectionEnd(detail.text, detail)
    }

    if (onSelectText) {
      const payload =
        boundedDirectRenderPayloadsRef.current.get(detail) ??
        buildSelectionPayload(selection)
      if (payload) {
        onSelectText(payload.selection, payload.segments, payload.extractedText)
      }
    }
  }, [
    onTextSelectionEnd,
    onSelectText,
    bodyDragCallbacksEnabled,
    getSelectionDetail
  ])

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
          // 没有 onOcrError 时静默吞掉，避免在生产代码中遗留日志输出；
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
      // Retained for external Selection sync only. Drag-composed selections are
      // emitted directly from the adapter path and skipped here to avoid double
      // onTextSelectionChange callbacks.
      const selection = window.getSelection()
      if (!selection) return

      const composedSelection = lastDragComposedSelectionRef.current
      if (
        composedSelection &&
        composedSelection.selection === selection &&
        composedSelection.selectedText === selection.toString()
      ) {
        return
      }

      const detail = getSelectionDetail(selection)
      if (detail) {
        onTextSelectionChange(detail.text, detail)
      }
    }

    // Observe browser/user-agent or test-created selections; this listener no
    // longer drives drag selection initiation.
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

    // Retained for overlay extraction from the live Selection, including
    // externally-created selections. Drag paths refresh explicitly after they
    // compose Selection ranges.
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

    // 根据 selection 的 start/end 容器创建 collapsed range 并取其边界矩形：
    // - start 手柄：锚定在 collapsed-start 矩形的 LEFT 边缘（不覆盖文字）
    // - end 手柄：锚定在 collapsed-end 矩形的 RIGHT 边缘
    const range = selection.getRangeAt(0)
    const handlePositions = buildSelectionHandlePositions(
      range,
      viewerRoot,
      pageRefs.current,
      Boolean(htmlParserOverlayActive)
    )
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

    // External Selection observer only: keeps overlays in sync when Selection
    // is created outside the Drag adapters (keyboard, browser UI, tests).
    globalThis.document.addEventListener(
      'selectionchange',
      refreshSelectionOverlay
    )
    // Demoted native mouseup fallback: refreshes overlays after externally
    // created native selections; root Drag remains the primary selection path.
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
    const root = viewerRootElement
    if (!root || !runtimeDocument) return

    const resolveDragCaret = (clientX: number, clientY: number) => {
      const pointElement = root.ownerDocument.elementFromPoint?.(
        clientX,
        clientY
      )
      const pointTextElement = pointElement?.closest('[data-text-id]')
      const shouldSnapToNearestText =
        !pointTextElement ||
        !root.contains(pointTextElement) ||
        isSelectionBackgroundTarget(pointElement)

      return resolveCaret(clientX, clientY, {
        viewerRoot: root,
        pageRefs: pageRefs.current,
        textElements: textElementsRef.current,
        ...(shouldSnapToNearestText
          ? {
              caretPositionFromPoint: () => null,
              caretRangeFromPoint: () => null
            }
          : {})
      })
    }

    const finishDragSelection = (clientX: number, clientY: number) => {
      if (!dragSelectionAnchorRef.current) return

      activeMouseSelectionRef.current.clientX = clientX
      activeMouseSelectionRef.current.clientY = clientY

      // Retained to inspect the Selection that the Drag path just composed, so
      // blank-click suppression and final overlay refresh can be applied.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) {
        ignoreNextBlankClickRef.current = true
        preserveOverlayDuringMouseUpRef.current = true
      }

      if (!dragSelectionEndEmittedRef.current) {
        dragSelectionEndEmittedRef.current = true
        skipNextMouseUpSelectionEndRef.current = true
        emitSelectionEnd()
        window.setTimeout(() => {
          skipNextMouseUpSelectionEndRef.current = false
        }, 0)
      }

      activeMouseSelectionRef.current.active = false
      dragSelectionAnchorRef.current = null

      if (overlayOptions?.enabled && selection && !selection.isCollapsed) {
        refreshSelectionOverlayRef.current()
      }

      preserveOverlayDuringMouseUpRef.current = false
    }

    const adapter = createDragSelectionAdapter(root, {
      onStart: (clientX, clientY) => {
        if (dragStateRef.current.active) {
          dragSelectionAnchorRef.current = null
          activeMouseSelectionRef.current.active = false
          return
        }

        const caretInfo = resolveDragCaret(clientX, clientY)
        if (!caretInfo) {
          dragSelectionAnchorRef.current = null
          activeMouseSelectionRef.current.active = false
          return
        }

        dragSelectionAnchorRef.current = {
          node: caretInfo.range.startContainer,
          offset: caretInfo.range.startOffset
        }
        dragSelectionEndEmittedRef.current = false
        activeMouseSelectionRef.current = {
          active: true,
          startClientX: clientX,
          startClientY: clientY,
          clientX,
          clientY
        }
        caretInfo.range.detach()
      },
      onMove: (clientX, clientY) => {
        const anchor = dragSelectionAnchorRef.current
        if (!anchor) return
        if (dragStateRef.current.active) {
          dragSelectionAnchorRef.current = null
          activeMouseSelectionRef.current.active = false
          return
        }

        activeMouseSelectionRef.current.clientX = clientX
        activeMouseSelectionRef.current.clientY = clientY

        // Required Selection composition capability check. Do not remove: the
        // Drag adapter writes the composed range via removeAllRanges/addRange.
        const writableSelection = window.getSelection()
        if (
          !writableSelection ||
          typeof writableSelection.removeAllRanges !== 'function' ||
          typeof writableSelection.addRange !== 'function'
        ) {
          return
        }

        const caretInfo = resolveDragCaret(clientX, clientY)
        if (!caretInfo) return

        const range = createOrderedRange(
          anchor.node,
          anchor.offset,
          caretInfo.range.startContainer,
          caretInfo.range.startOffset
        )
        caretInfo.range.detach()
        composeSelection(range)

        // Read back the composed Selection for payload/detail generation and
        // to suppress the external selectionchange observer's duplicate event.
        const selection = window.getSelection()
        if (!selection) return

        lastDragComposedSelectionRef.current = {
          selection,
          selectedText: selection.toString()
        }

        if (overlayOptions?.enabled) {
          refreshSelectionOverlayRef.current()
        }

        if (onTextSelectionChange) {
          const detail = getSelectionDetail(selection)
          if (detail) {
            onTextSelectionChange(detail.text, detail)
          }
        }
      },
      onEnd: finishDragSelection,
      onAllEnd: finishDragSelection
    })

    return () => {
      adapter.destroy()
      activeMouseSelectionRef.current.active = false
      dragSelectionAnchorRef.current = null
      dragSelectionEndEmittedRef.current = false
    }
  }, [
    viewerRootElement,
    runtimeDocument,
    overlayOptions?.enabled,
    emitSelectionEnd,
    getSelectionDetail,
    onTextSelectionChange
  ])

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
      // Blank-click cleanup is not a selection initiation path; it clears an
      // existing external or Drag-composed Selection when the user clicks empty
      // viewer space.
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
    if (!onTextSelectionEnd && !onSelectText && !bodyDragCallbacksEnabled) {
      return
    }

    const root = viewerRootRef.current
    if (!root) return

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) {
        emitSelectionEnd()
      }
    }

    // Demoted native mouseup/touchend fallback: Drag emits selection end for
    // adapter-driven gestures. These listeners only cover externally-created
    // native selections and keyboard/touch browser selection completions.
    const handleMouseUp = (event: MouseEvent) => {
      if (skipNextMouseUpSelectionEndRef.current) {
        skipNextMouseUpSelectionEndRef.current = false
        activeMouseSelectionRef.current.active = false
        return
      }

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
  }, [
    onTextSelectionEnd,
    onSelectText,
    bodyDragCallbacksEnabled,
    emitSelectionEnd
  ])

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
        // 优先使用 Drag start 时记录的固定端节点/偏移，
        // 避免因浏览器 caret resolver 抖动导致固定端漂移。
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
        const fixedCaretInfo = resolveCaret(
          fixedPageRect.left + dragState.fixedPoint.x,
          fixedPageRect.top + dragState.fixedPoint.y,
          {
            viewerRoot,
            pageRefs: pageRefs.current,
            textElements: textElementsRef.current
          }
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
      const newRange = createOrderedRange(
        startPoint.node,
        startPoint.offset,
        endPoint.node,
        endPoint.offset
      )
      composeSelection(newRange)
      // 手动触发覆盖层刷新：测试环境下 mock 的 selection 不会自动派发 selectionchange，
      // 真实浏览器中此处也提前刷新，避免拖动期间出现一帧延迟。
      refreshSelectionOverlayRef.current()
    },
    []
  )

  const beginHandleDrag = useCallback((handleType: 'start' | 'end') => {
    if (dragStateRef.current.active || dragSelectionAnchorRef.current) {
      return false
    }

    // Retained as handle-drag seed state only: the per-handle Drag adapter has
    // already initiated the gesture, and this reads the current Selection range
    // to determine the fixed anchor for subsequent composed updates.
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false
    }

    const range = selection.getRangeAt(0)
    const viewerRoot = viewerRootRef.current
    if (!viewerRoot) return false

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

    // 手柄拖拽接管后，清理主文本 Drag 的临时状态，避免 root adapter 同时合成选择区。
    dragSelectionAnchorRef.current = null
    activeMouseSelectionRef.current.active = false
    return true
  }, [])

  const applyHandleDragAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragStateRef.current.active || !dragStateRef.current.handleType)
        return false

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return false

      const caretInfo = resolveCaret(clientX, clientY, {
        viewerRoot,
        pageRefs: pageRefs.current,
        textElements: textElementsRef.current
      })

      if (!caretInfo) return false

      applyHandleDragSelection(caretInfo)
      caretInfo.range.detach()
      return true
    },
    [applyHandleDragSelection]
  )

  const finishHandleDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragStateRef.current.active) return

      applyHandleDragAtPoint(clientX, clientY)

      dragStateRef.current = {
        active: false,
        handleType: null,
        fixedPoint: null,
        fixedAnchor: null
      }

      emitSelectionEnd()
    },
    [applyHandleDragAtPoint, emitSelectionEnd]
  )

  useEffect(() => {
    const root = viewerRootElement
    if (
      !root ||
      !runtimeDocument ||
      selectionHandleElement === null ||
      !selectionHandleAdapterKey
    ) {
      return
    }

    const handleElements: Array<{
      element: HTMLElement
      handleType: 'start' | 'end'
    }> = []
    for (const element of Array.from(
      root.querySelectorAll<HTMLElement>('[data-handle-type]')
    )) {
      const handleType = element.dataset.handleType
      if (handleType === 'start' || handleType === 'end') {
        handleElements.push({ element, handleType })
      }
    }

    if (handleElements.length === 0) return

    // Guard only: per-handle Drag owns start/move/end. These native pointer
    // listeners prevent the same pointer stream from bubbling into the root
    // adapter or triggering browser-native handle behavior.
    const stopHandlePointerEvent = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const pointerEventTypes = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel'
    ] as const

    const adapters = handleElements.map(({ element, handleType }) => {
      const adapter = createDragSelectionAdapter(element, {
        onStart: () => {
          beginHandleDrag(handleType)
        },
        onMove: (clientX, clientY) => {
          if (dragStateRef.current.handleType !== handleType) return
          applyHandleDragAtPoint(clientX, clientY)
        },
        onEnd: finishHandleDrag,
        onAllEnd: finishHandleDrag
      })

      pointerEventTypes.forEach((eventType) => {
        element.addEventListener(eventType, stopHandlePointerEvent)
      })

      return { adapter, element }
    })

    return () => {
      for (const { adapter, element } of adapters) {
        for (const eventType of pointerEventTypes) {
          element.removeEventListener(eventType, stopHandlePointerEvent)
        }
        adapter.destroy()
      }

      if (dragStateRef.current.active) {
        dragStateRef.current = {
          active: false,
          handleType: null,
          fixedPoint: null,
          fixedAnchor: null
        }
      }
    }
  }, [
    viewerRootElement,
    selectionHandleAdapterKey,
    runtimeDocument,
    selectionHandleElement,
    beginHandleDrag,
    applyHandleDragAtPoint,
    finishHandleDrag
  ])

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
        ref={setViewerRootRef}
        className={rootClassName}
        data-testid='intermediate-document-viewer'
      />
    )
  }

  return (
    <div
      ref={setViewerRootRef}
      role='document'
      className={rootClassName}
      data-testid='intermediate-document-viewer'
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
              role='presentation'
              aria-hidden='true'
              {...overlayBodyDragProps}
              style={
                {
                  '--hamster-reader-selection-color': overlayOptions.color,
                  '--hamster-reader-selection-opacity': overlayOptions.opacity,
                  ...overlayBodyDragStyle
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
                  role='presentation'
                  aria-hidden='true'
                  {...overlayBodyDragProps}
                  style={
                    {
                      '--hamster-reader-selection-color': overlayOptions.color,
                      '--hamster-reader-selection-opacity':
                        overlayOptions.opacity,
                      ...overlayBodyDragStyle
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
