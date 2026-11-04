// HAM-89 / tasks.md 3.2/3.4：pdfjs 官方 text layer 上的原生选区 →
// reader 公开 range 契约（page-N 端点 + 页内拼接 offset + px/percent 矩形）。
// 只读 DOM 与几何，不持有状态；viewer 组件在选区变化时调用。

import { pdfRangeClientRects } from './pdfSelectionPaint'
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
  /** Exact disjoint source spans of a restored logical selection. */
  readonly sourceRanges?: readonly {
    readonly start: { readonly selectionId: string; readonly offset: number }
    readonly end: { readonly selectionId: string; readonly offset: number }
  }[]
  readonly start: { readonly selectionId: string; readonly offset: number }
  readonly end: { readonly selectionId: string; readonly offset: number }
  /** 跨页拼接：起点页后缀 + 中间已加载页全文 + 终点页前缀（无分隔符）。 */
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
  for (const clientRect of pdfRangeClientRects(range)) {
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
 * 连续拖动包含中间已加载页的文字与矩形，沿用 page-N/offset 格式。
 */
export function serializePdfTextSelection(
  selection: Selection | Range,
  contexts: ReadonlyMap<number, PdfPageSelectionContext>,
  unit: OverlayRectUnit
): SerializedPdfSelection | null {
  const managed = 'startContainer' in selection
  if (
    managed
      ? selection.collapsed
      : selection.isCollapsed || selection.rangeCount === 0
  )
    return null
  const anchorNode = managed ? selection.startContainer : selection.anchorNode
  const focusNode = managed ? selection.endContainer : selection.focusNode
  if (!anchorNode || !focusNode) return null

  const anchor = locatePosition(
    anchorNode,
    managed ? selection.startOffset : selection.anchorOffset,
    contexts
  )
  const focus = locatePosition(
    focusNode,
    managed ? selection.endOffset : selection.focusOffset,
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

  const selectedPages = [...contexts.values()]
    .filter(
      (context) =>
        context.pageNumber >= startPage.pageNumber &&
        context.pageNumber <= endPage.pageNumber
    )
    .sort((a, b) => a.pageNumber - b.pageNumber)
  const text = selectedPages
    .map((context) =>
      context.canonical.text.slice(
        context.pageNumber === startPage.pageNumber ? start.canonicalOffset : 0,
        context.pageNumber === endPage.pageNumber
          ? end.canonicalOffset
          : undefined
      )
    )
    .join('')
  const rectsBySelectionId: Record<string, ReaderSelectionRect[]> = {}
  for (const context of selectedPages) {
    const rects = capturePageRects(
      context,
      context.pageNumber === startPage.pageNumber ? start.canonicalOffset : 0,
      context.pageNumber === endPage.pageNumber
        ? end.canonicalOffset
        : context.canonical.text.length,
      unit
    )
    if (rects.length)
      rectsBySelectionId[pageSelectionId(context.pageNumber)] = rects
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
  for (const context of contexts.values()) {
    if (
      context.pageNumber < startPageNumber ||
      context.pageNumber > endPageNumber
    )
      continue
    const rects = capturePageRects(
      context,
      context.pageNumber === startPageNumber ? start.offset : 0,
      context.pageNumber === endPageNumber
        ? end.offset
        : context.canonical.text.length,
      unit
    )
    if (rects.length)
      rectsBySelectionId[pageSelectionId(context.pageNumber)] = rects
  }

  return rectsBySelectionId
}
