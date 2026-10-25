// HAM-89 / tasks.md 3.2/3.4：pdfjs 官方 text layer 上的原生选区 →
// reader 公开 range 契约（page-N 端点 + 页内拼接 offset + px/percent 矩形）。
// 只读 DOM 与几何，不持有状态；viewer 组件在选区变化时调用。

import type { ReaderSelectionRect } from '../types/selection'
import type { PageViewport } from './pdfjsRuntime'
import type { OverlayRectUnit, PageVisualSize } from './pdfOverlayGeometry'
import { captureViewportRectAsStored } from './pdfOverlayGeometry'
import type { CanonicalPageText } from './pdfTextMapping'
import {
  canonicalRangeToDomRange,
  domPositionToCanonicalOffset
} from './pdfTextMapping'

export type PdfPageSelectionContext = {
  readonly pageNumber: number
  /** 官方 text layer div（已 enhanceTextLayer 注入属性）。 */
  readonly textLayerDiv: HTMLElement
  /** pdfjs `.page` div，用于把 clientRect 归一到页内显示坐标。 */
  readonly pageDiv: HTMLElement
  readonly canonical: CanonicalPageText
  readonly viewport: PageViewport
  readonly scaleOneViewport: PageViewport
  readonly visual: PageVisualSize
}

export type SerializedPdfSelection = {
  readonly start: { readonly selectionId: string; readonly offset: number }
  readonly end: { readonly selectionId: string; readonly offset: number }
  /** 跨页按契约拼接：起点页选中后缀 + 终点页选中前缀（无分隔符）。 */
  readonly text: string
  readonly rectsBySelectionId: Readonly<Record<string, ReaderSelectionRect[]>>
}

const pageSelectionId = (pageNumber: number): string => `page-${pageNumber}`

type LocatedPosition = {
  readonly context: PdfPageSelectionContext
  readonly canonicalOffset: number
}

const locatePosition = (
  node: Node,
  offset: number,
  contexts: ReadonlyMap<number, PdfPageSelectionContext>
): LocatedPosition | null => {
  for (const context of contexts.values()) {
    if (!context.textLayerDiv.contains(node)) continue
    const canonicalOffset = domPositionToCanonicalOffset(
      node,
      offset,
      context.canonical
    )
    if (canonicalOffset !== null) return { context, canonicalOffset }
  }
  return null
}

/** 单页 canonical 区间 → 存储矩形列表（逐 clientRect 独立投影）。 */
const capturePageRects = (
  context: PdfPageSelectionContext,
  startOffset: number,
  endOffset: number,
  unit: OverlayRectUnit
): ReaderSelectionRect[] => {
  const range = canonicalRangeToDomRange(
    context.canonical,
    startOffset,
    endOffset,
    context.textLayerDiv
  )
  // jsdom 等环境无 Range.getClientRects；真实浏览器必有。
  if (!range || typeof range.getClientRects !== 'function') return []

  const pageBox = context.pageDiv.getBoundingClientRect()
  const rects: ReaderSelectionRect[] = []
  for (const clientRect of Array.from(range.getClientRects())) {
    if (clientRect.width <= 0 || clientRect.height <= 0) continue
    rects.push(
      captureViewportRectAsStored(
        {
          left: clientRect.left - pageBox.left,
          top: clientRect.top - pageBox.top,
          width: clientRect.width,
          height: clientRect.height
        },
        context.viewport,
        context.scaleOneViewport,
        unit,
        context.visual
      )
    )
  }
  return rects
}

/**
 * 序列化跨页原生选区。选区任一端点不在已增强 text layer 内时返回 null。
 * 只覆盖 start/end 两页（契约不含中间页文本）。
 */
export function serializePdfTextSelection(
  selection: Selection,
  contexts: ReadonlyMap<number, PdfPageSelectionContext>,
  unit: OverlayRectUnit
): SerializedPdfSelection | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null
  if (!selection.anchorNode || !selection.focusNode) return null

  const anchor = locatePosition(
    selection.anchorNode,
    selection.anchorOffset,
    contexts
  )
  const focus = locatePosition(
    selection.focusNode,
    selection.focusOffset,
    contexts
  )
  if (!anchor || !focus) return null

  const ordered =
    anchor.context.pageNumber < focus.context.pageNumber ||
    (anchor.context.pageNumber === focus.context.pageNumber &&
      anchor.canonicalOffset <= focus.canonicalOffset)
  const start = ordered ? anchor : focus
  const end = ordered ? focus : anchor

  const startPage = start.context
  const endPage = end.context
  const samePage = startPage.pageNumber === endPage.pageNumber

  const text = samePage
    ? startPage.canonical.text.slice(start.canonicalOffset, end.canonicalOffset)
    : startPage.canonical.text.slice(start.canonicalOffset) +
      endPage.canonical.text.slice(0, end.canonicalOffset)

  const rectsBySelectionId: Record<string, ReaderSelectionRect[]> = {}
  const startRects = capturePageRects(
    startPage,
    start.canonicalOffset,
    samePage ? end.canonicalOffset : startPage.canonical.text.length,
    unit
  )
  if (startRects.length > 0) {
    rectsBySelectionId[pageSelectionId(startPage.pageNumber)] = startRects
  }
  if (!samePage) {
    const endRects = capturePageRects(endPage, 0, end.canonicalOffset, unit)
    if (endRects.length > 0) {
      rectsBySelectionId[pageSelectionId(endPage.pageNumber)] = endRects
    }
  }

  return {
    start: {
      selectionId: pageSelectionId(startPage.pageNumber),
      offset: start.canonicalOffset
    },
    end: {
      selectionId: pageSelectionId(endPage.pageNumber),
      offset: end.canonicalOffset
    },
    text,
    rectsBySelectionId
  }
}

/**
 * 由已持久化的 canonical 端点重算显示矩形（rectsBySelectionId 缺失或
 * 回页恢复时使用；矩阵 §1：按字符锚点实时计算，不回写持久化矩形）。
 */
export function deriveRectsForCanonicalRange(
  start: { readonly selectionId: string; readonly offset: number },
  end: { readonly selectionId: string; readonly offset: number },
  contexts: ReadonlyMap<number, PdfPageSelectionContext>,
  unit: OverlayRectUnit
): Record<string, ReaderSelectionRect[]> {
  const pageNumberOf = (selectionId: string): number | null => {
    const match = /^page-([1-9]\d*)$/.exec(selectionId)
    return match ? Number(match[1]) : null
  }

  const startPageNumber = pageNumberOf(start.selectionId)
  const endPageNumber = pageNumberOf(end.selectionId)
  if (startPageNumber === null || endPageNumber === null) return {}

  const startContext = contexts.get(startPageNumber)
  const endContext = contexts.get(endPageNumber)
  if (!startContext || !endContext) return {}

  const rectsBySelectionId: Record<string, ReaderSelectionRect[]> = {}
  const samePage = startPageNumber === endPageNumber
  const startRects = capturePageRects(
    startContext,
    start.offset,
    samePage ? end.offset : startContext.canonical.text.length,
    unit
  )
  if (startRects.length > 0) {
    rectsBySelectionId[start.selectionId] = startRects
  }
  if (!samePage) {
    const endRects = capturePageRects(endContext, 0, end.offset, unit)
    if (endRects.length > 0) rectsBySelectionId[end.selectionId] = endRects
  }
  return rectsBySelectionId
}
