import type { DrawingTool, DrawingValue } from '@hamster-note/painting'
import type { SelectionRange, SelectionRect } from '@hamster-note/selection'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'

import type {
  ReaderComment,
  ReaderCommentChangeDetail
} from '../types/comments'
import type { ReaderFontScale } from '../types/fontScale'
import type {
  ReaderBookmark,
  ReaderData,
  ReaderEdgeCrop,
  ReaderTextAnchor,
  ReaderTextReadingProgress,
  ReaderVirtualPaperState
} from '../types/readerData'
import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryOptions,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue,
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderMousePosition,
  ReaderRectanglePopover,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderSelectionTool
} from '../types/selection'
import {
  DefaultHighlightPopover,
  DefaultRectanglePopover,
  DefaultSelectionPopover
} from './DefaultPopover'
import type {
  ReaderExtraOcr,
  ReaderInteractionMode,
  ReaderOcrOptions,
  ReaderPageRange,
  ReaderSelectedTextSegment,
  ReaderTextSelectionDetail,
  ReaderTouchPanMode
} from './IntermediateDocumentViewer'
import { IntermediateDocumentViewer } from './IntermediateDocumentViewer'
import { IntermediateDocumentTextViewer } from './IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import type { IntermediateDocumentRenderTimingCallback } from './IntermediateDocumentViewer/renderTiming'
import { getTextAnchorKey } from './IntermediateDocumentViewer/textAnchor'
import type {
  ReaderPagePaintingMap,
  ReaderPageRectSelectionMap,
  ReaderPageTextSelectionMap,
  ReaderPageTool
} from './Page'
import { DefaultBottomBar } from './Reader/DefaultBottomBar'
import { useBottomBarInset } from './Reader/useBottomBarInset'

export type ReaderRenderMode = 'layout' | 'text'

type ReaderDocumentInput =
  | IntermediateDocument
  | IntermediateDocumentSerialized
  | null
  | undefined

type ReaderPositionHandoff<T> = {
  readonly document: ReaderDocumentInput
  readonly replacedValueKey: string
  readonly value: T
}

const getReaderTextProgressKey = (
  progress: ReaderTextReadingProgress | undefined
): string =>
  progress?.anchor
    ? getTextAnchorKey(progress.anchor)
    : `${progress?.currentPageNumber ?? ''}:page`

const getReaderVirtualPaperKey = (
  virtualPaper: ReaderVirtualPaperState | undefined
): string => {
  if (!virtualPaper) return ''
  const anchorKey = virtualPaper.anchor
    ? getTextAnchorKey(virtualPaper.anchor)
    : ''
  return `${virtualPaper.x}:${virtualPaper.y}:${virtualPaper.scale}:${anchorKey}`
}

type BottomBarHistoryContext = {
  readonly status: ReaderAnnotationHistoryStatus
  readonly renderMode: ReaderRenderMode
  readonly hasHistoryChangeHandler: boolean
  readonly hasControlledAnnotations: boolean
}

const resolveBottomBarHistoryStatus = ({
  status,
  renderMode,
  hasHistoryChangeHandler,
  hasControlledAnnotations
}: BottomBarHistoryContext): ReaderAnnotationHistoryStatus => {
  const commandsSupported =
    renderMode === 'layout' &&
    (hasHistoryChangeHandler || !hasControlledAnnotations)

  return {
    ...status,
    canUndo: status.canUndo && commandsSupported,
    canRedo: status.canRedo && commandsSupported
  }
}

export type ReaderProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  /** 可持久化阅读数据的统一入口；其中字段优先于对应的旧版扁平 props。 */
  data?: ReaderData
  /** 阅读数据变化回调；回传带顶部文字锚点的阅读位置和精确书签。 */
  onDataChange?: (nextData: ReaderData) => void
  /** 边缘裁切编辑模式开关；开启后页面以未裁剪尺寸显示并展示可拖拽虚线。 */
  edgeCropEditing?: boolean
  /**
   * 用户点击"应用裁切"时触发。
   * pageNumber 为 null 表示应用到所有页面（更新 edgeCrop.all），
   * 非 null 表示仅应用到该页（更新 edgeCrop.pages[page-N]）。
   */
  onEdgeCropApply?: (pageNumber: number | null, crop: ReaderEdgeCrop) => void
  className?: string
  emptyText?: string
  onFileUpload?: (file: File) => void
  overscanPages?: number
  pageRange?: ReaderPageRange
  ocr?: boolean | ReaderOcrOptions
  /** OCR 开关变化回调；未传入 ocr 时 Reader 同时更新内部开关。 */
  onOcrChange?: (enabled: boolean) => void
  /** 自定义 OCR 实现；接收页面原尺寸 base64 图片并返回 IntermediatePage。 */
  extraOCR?: ReaderExtraOcr
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  /**
   * 受控 OCR 文本数据（pageNumber -> 文本列表，1-based）。
   * 已有数据的页不会重复发起 OCR；手动模式（ocr.pages）下仅展示列表内的页。
   */
  ocrTexts?: Readonly<Record<number, readonly IntermediateText[]>>
  /** 单页 OCR 完成回调，输出识别结果供宿主持久化 / 受控回传。 */
  onOcrTextsChange?: (pageNumber: number, texts: IntermediateText[]) => void
  /**
   * OCR 开发调试模式：开启后 OCR 文本以黑色 50% 透明度显示并加红色外框，
   * 便于核对识别位置与内容。仅影响渲染，不影响存储/回传的文本数据。
   */
  ocrDebug?: boolean
  renderMode?: ReaderRenderMode
  /** 渲染模式变化回调；未受控时 Reader 同时更新内部模式。 */
  onRenderModeChange?: (mode: ReaderRenderMode) => void
  /** 当前文档是否为 EPUB；EPUB 的 Layout 高亮矩形只实时计算，不写入持久化数据。 */
  isEpub?: boolean
  /** 当前文档是否为 PDF；Text 模式会据此按文字 box 重建行与段落。 */
  isPdf?: boolean
  /** 可重排文档字号倍率；提供时按 `(原字号 / 16) * 倍率` rem 渲染。 */
  fontScale?: ReaderFontScale
  /** 字号倍率变化回调。仅在提供 fontScale、启用字号菜单时触发。 */
  onFontScaleChange?: (scale: ReaderFontScale) => void
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
  interactionMode?: ReaderInteractionMode
  touchPanMode?: ReaderTouchPanMode
  /** 触摸平移模式变化回调；未受控时 Reader 同时更新内部模式。 */
  onTouchPanModeChange?: (mode: ReaderTouchPanMode) => void
  scale?: number
  defaultScale?: number
  onScaleChange?: (
    scale: number,
    detail: {
      source: 'wheel' | 'pinch'
      focalPoint?: { x: number; y: number }
    }
  ) => void
  minScale?: number
  maxScale?: number
  maxLoadedPages?: number
  ranges?: ReaderSelectionRange[]
  defaultRanges?: ReaderSelectionRange[]
  selectedRangeId?: string | null
  defaultSelectedRangeId?: string | null
  onSelect?: (range: ReaderSelectionRange) => void
  onLinkedDataChange?: (next: ReaderLinkedSelectionData) => void
  onLinkedSelect?: (range: ReaderSelectionRange) => void
  onLinkedUpdateRange?: (range: ReaderSelectionRange) => void
  onLinkedSelectRange?: (id: string | null) => void
  onSelectRange?: (id: string | null) => void
  onUpdateRange?: (range: ReaderSelectionRange) => void
  onSelectionStart?: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  onSelectionEnd?: (mousePos: ReaderMousePosition, selection: Selection) => void
  onHighlight?: (range: ReaderSelectionRange) => void
  /** 鼠标拖动高亮或触摸长按高亮进入拖动状态时触发，每次手势仅触发一次。 */
  onDragHighlight?: (highlight: ReaderSelectionRange) => void
  /** 删除指定 range 的回调（供默认 highlightPopover 的删除按钮使用） */
  onRemoveRange?: (id: string) => void
  /** 全局高亮颜色变更回调（供默认 popover 的颜色选择器使用） */
  onHighlightColorChange?: (color: string) => void
  highlightColor?: string
  selectionColor?: string
  /** 是否启用选区端点放大镜，默认 false。 */
  showSelectionMagnifier?: boolean
  selectionPopover?: ReactNode
  highlightPopover?: ReaderHighlightPopover
  onCommentHighlight?: (
    highlight: ReaderSelectionRange
  ) => Promise<ReaderSelectionRange>
  onCommentRect?: (
    rectangle: ReaderSelectionRectangle
  ) => Promise<ReaderSelectionRectangle>
  autoHighlight?: boolean
  selectionRef?: Ref<ReaderSelectionRef>
  overlayRectType?: ReaderSelectionOverlayRectType
  tool?: ReaderSelectionTool
  rects?: ReaderSelectionRectangle[]
  selectedRectId?: string | null
  rectPopover?: ReaderRectanglePopover
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  onSelectRect?: (id: string | null) => void
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  /** 删除指定矩形的回调（供默认 rectPopover 的删除按钮使用） */
  onRemoveRect?: (id: string) => void
  annotationHistory?: boolean | ReaderAnnotationHistoryOptions
  onAnnotationHistoryChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
  initialLoadedPages?: number
  pageLoadConcurrency?: number
  pageLoadEnterDelayMs?: number
  /** 当前可见页前后预加载的页数，默认前后各 3 页。 */
  pagePreloadRadius?: number
  pageUnloadDelayMs?: number
  onIntermediateDocumentRenderTiming?: IntermediateDocumentRenderTimingCallback
  containMarginX?: number
  containMarginTop?: number
  containMarginBottom?: number
  /** @deprecated Use `containMarginTop` and `containMarginBottom`. */
  containMarginY?: number
  /** 是否显示页面浏览侧栏，布局与文本模式均支持，默认 false。 */
  showPageBrowser?: boolean
  /** 页面浏览侧栏被左滑关闭时触发。 */
  onPageBrowserClose?: () => void
  /** 主题色（CSS color），用于 page-browser 选中项的 outline。默认 '#2563eb'。 */
  themeColor?: string
  /** 每个 rangeId 对应的评论数量，传入 page-browser 高亮列表展示评论计数徽章。 */
  commentCountByRangeId?: Readonly<Record<string, number>>
  /** 每个 rectId 对应的评论数量，传入 page-browser 高亮列表展示评论计数徽章。 */
  commentCountByRectId?: Readonly<Record<string, number>>
  /** 受控评论数据；Reader 不内部修改，由 onCommentsChange 通知宿主更新。 */
  comments?: readonly ReaderComment[]
  /** 评论数据变更回调（库本身不修改评论；为宿主层预留的统一变更通道）。 */
  onCommentsChange?: (
    nextComments: readonly ReaderComment[],
    detail: ReaderCommentChangeDetail
  ) => void
  /** 由宿主控制的精确文字书签。 */
  bookmarks?: readonly ReaderBookmark[]
  /** 添加或删除指定文字锚点书签。 */
  onToggleBookmark?: (bookmark: ReaderBookmark) => void
  /** @deprecated Use `bookmarks`. */
  bookmarkedPageNumbers?: readonly number[]
  /** @deprecated Use `onToggleBookmark`. */
  onTogglePageBookmark?: (pageNumber: number) => void
  onPageLoadStatusChange?: (loadedPageNumbers: number[]) => void
  selectedTool?: ReaderPageTool
  /** 页面工具变化回调；未受控时 Reader 同时更新内部工具。 */
  onSelectedToolChange?: (tool: ReaderPageTool) => void
  paintingTool?: DrawingTool
  /** 绘制图形的描边颜色，默认 '#2563eb' */
  drawingStrokeColor?: string
  /** 绘图颜色变化回调；未受控时 Reader 同时更新内部颜色。 */
  onDrawingStrokeColorChange?: (color: string) => void
  pagePaintings?: ReaderPagePaintingMap
  defaultPagePaintings?: ReaderPagePaintingMap
  /** @deprecated Use the linked `ranges` API. */
  pageTextSelections?: ReaderPageTextSelectionMap
  /** @deprecated Use `defaultRanges`. */
  defaultPageTextSelections?: ReaderPageTextSelectionMap
  /** @deprecated Use the page-scoped `rects` API. */
  pageRectSelections?: ReaderPageRectSelectionMap
  /** @deprecated Initialize `rects` in the host. */
  defaultPageRectSelections?: ReaderPageRectSelectionMap
  onPagePaintingChange?: (
    pageId: string,
    nextValue: DrawingValue,
    nextPaintings: ReaderPagePaintingMap
  ) => void
  onPagePaintingsChange?: (nextPaintings: ReaderPagePaintingMap) => void
  /** @deprecated Use `onSelect` and `onUpdateRange`. */
  onPageTextSelectionsChange?: (
    pageId: string,
    nextSelections: readonly SelectionRange[],
    nextPageSelections: ReaderPageTextSelectionMap
  ) => void
  /** @deprecated Use `onCreateRect` and `onUpdateRect`. */
  onPageRectSelectionsChange?: (
    pageId: string,
    nextSelections: readonly SelectionRect[],
    nextPageSelections: ReaderPageRectSelectionMap
  ) => void
  /** Popover 使用相对定位（absolute）相对于容器，而非 fixed 相对于 window */
  popoverRelative?: boolean
  /**
   * 自定义底部栏；省略时使用内置底部栏，显式传 null 时关闭底部栏。
   * Reader 仅自动避让内置底部栏；自定义悬浮栏的遮挡应由宿主计入 containMarginBottom。
   */
  bottomBar?: ReactNode
  /** 边缘裁切编辑状态变化回调；未受控时 Reader 同时更新内部状态。 */
  onEdgeCropEditingChange?: (editing: boolean) => void
}

export const SUPPORTED_UPLOAD_ACCEPT =
  '.pdf,application/pdf,.txt,text/plain,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md,.markdown,text/markdown,text/x-markdown,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml'

export const SUPPORTED_UPLOAD_COPY = 'PDF, TXT, DOCX, Markdown, and image'

const documentHasPages = (
  document:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
) => {
  if (!document) {
    return false
  }

  if (Array.isArray((document as IntermediateDocumentSerialized).pages)) {
    return (document as IntermediateDocumentSerialized).pages.length > 0
  }

  return (document as IntermediateDocument).pageCount > 0
}

interface UploadedFile {
  name: string
  size: number
  type: string
}

function getLinkedRanges(
  selectionsByPage: ReaderPageTextSelectionMap
): ReaderSelectionRange[] {
  return Object.entries(selectionsByPage).flatMap(([pageId, selections]) =>
    selections.map((selection) => ({
      id: selection.id,
      text: selection.text,
      start: { selectionId: pageId, offset: selection.start },
      end: { selectionId: pageId, offset: selection.end },
      createdAt: selection.createdAt,
      overlayRectType: selection.overlayRectType,
      rectsBySelectionId: { [pageId]: [...(selection.rects ?? [])] },
      markerStyle: selection.markerStyle,
      selectionStyle: selection.selectionStyle
    }))
  )
}

function getPageTextSelection(range: ReaderSelectionRange): SelectionRange {
  const pageId = range.start.selectionId
  return {
    id: range.id,
    text: range.text,
    start: range.start.offset,
    end: range.end.offset,
    createdAt: range.createdAt,
    overlayRectType: range.overlayRectType,
    rects: [...(range.rectsBySelectionId[pageId] ?? [])],
    markerStyle: range.markerStyle,
    selectionStyle: range.selectionStyle
  }
}

function getPageRects(
  selectionsByPage: ReaderPageRectSelectionMap
): ReaderSelectionRectangle[] {
  return Object.entries(selectionsByPage).flatMap(([pageId, selections]) =>
    selections.map((selection) => ({ ...selection, selectionId: pageId }))
  )
}

function normalizeAnnotationHistoryOptions(
  annotationHistory: boolean | ReaderAnnotationHistoryOptions | undefined
): ReaderAnnotationHistoryOptions {
  if (annotationHistory === true) {
    return { enabled: true }
  }

  if (annotationHistory === false || annotationHistory === undefined) {
    return { enabled: false }
  }

  return {
    enabled: annotationHistory.enabled ?? true,
    resetKey: annotationHistory.resetKey
  }
}

interface ResolvedVerticalMargins {
  readonly top: number | undefined
  readonly bottom: number | undefined
  readonly legacy: number | undefined
}

interface BookmarkCapabilities {
  readonly usesPreciseBookmarks: boolean
  readonly canTogglePreciseBookmarks: boolean
}

function resolveBookmarkCapabilities({
  bookmarks,
  bookmarkedPageNumbers,
  hasPreciseToggle,
  hasPageToggle,
  hasDataChange
}: {
  readonly bookmarks: readonly ReaderBookmark[] | undefined
  readonly bookmarkedPageNumbers: readonly number[] | undefined
  readonly hasPreciseToggle: boolean
  readonly hasPageToggle: boolean
  readonly hasDataChange: boolean
}): BookmarkCapabilities {
  return {
    usesPreciseBookmarks:
      bookmarks !== undefined ||
      hasPreciseToggle ||
      (hasDataChange && bookmarkedPageNumbers === undefined && !hasPageToggle),
    canTogglePreciseBookmarks: hasPreciseToggle || hasDataChange
  }
}

function whenEnabled<Value>(enabled: boolean, value: Value): Value | undefined {
  return enabled ? value : undefined
}

function resolveVerticalMargins(
  containMarginTop: number | undefined,
  containMarginBottom: number | undefined,
  containMarginY: number | undefined,
  bottomBarInset: number
): ResolvedVerticalMargins {
  if (bottomBarInset === 0) {
    return {
      top: containMarginTop,
      bottom: containMarginBottom,
      legacy: containMarginY
    }
  }

  return {
    top: containMarginTop ?? containMarginY,
    bottom: (containMarginBottom ?? containMarginY ?? 0) + bottomBarInset,
    legacy: undefined
  }
}

export function Reader({
  document,
  data,
  onDataChange,
  edgeCropEditing,
  onEdgeCropEditingChange,
  onEdgeCropApply,
  className,
  emptyText = 'No document',
  onFileUpload,
  overscanPages,
  pageRange,
  ocr,
  onOcrChange,
  extraOCR,
  onOcrError,
  ocrTexts,
  onOcrTextsChange,
  ocrDebug,
  renderMode,
  onRenderModeChange,
  isEpub,
  isPdf,
  fontScale,
  onFontScaleChange,
  onTextSelectionChange,
  onTextSelectionEnd,
  onSelectText,
  scale,
  defaultScale,
  onScaleChange,
  minScale,
  maxScale,
  maxLoadedPages,
  interactionMode,
  touchPanMode,
  onTouchPanModeChange,
  ranges,
  defaultRanges,
  selectedRangeId,
  defaultSelectedRangeId,
  onSelect,
  onLinkedDataChange,
  onLinkedSelect,
  onLinkedUpdateRange,
  onLinkedSelectRange,
  onSelectRange,
  onUpdateRange,
  onSelectionStart,
  onSelectionEnd,
  onHighlight,
  onDragHighlight,
  onRemoveRange,
  onHighlightColorChange,
  highlightColor,
  selectionColor,
  showSelectionMagnifier = false,
  selectionPopover,
  highlightPopover,
  onCommentHighlight,
  onCommentRect,
  autoHighlight,
  selectionRef,
  overlayRectType = 'percent',
  tool,
  rects,
  selectedRectId,
  rectPopover,
  onCreateRect,
  onSelectRect,
  onUpdateRect,
  onRemoveRect,
  annotationHistory,
  onAnnotationHistoryChange,
  initialLoadedPages,
  pageLoadConcurrency,
  pageLoadEnterDelayMs,
  pagePreloadRadius,
  pageUnloadDelayMs,
  onIntermediateDocumentRenderTiming,
  containMarginX,
  containMarginTop,
  containMarginBottom,
  containMarginY,
  showPageBrowser,
  onPageBrowserClose,
  themeColor,
  commentCountByRangeId,
  commentCountByRectId,
  comments,
  onCommentsChange,
  bookmarks,
  onToggleBookmark,
  bookmarkedPageNumbers,
  onTogglePageBookmark,
  selectedTool,
  onSelectedToolChange,
  paintingTool = 'pen',
  drawingStrokeColor,
  onDrawingStrokeColorChange,
  pagePaintings,
  defaultPagePaintings,
  pageTextSelections,
  defaultPageTextSelections,
  pageRectSelections,
  defaultPageRectSelections,
  onPagePaintingChange,
  onPagePaintingsChange,
  onPageTextSelectionsChange,
  onPageRectSelectionsChange,
  onPageLoadStatusChange,
  popoverRelative,
  bottomBar
}: ReaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const [internalPagePaintings, setInternalPagePaintings] =
    useState<ReaderPagePaintingMap>(defaultPagePaintings ?? {})
  const [internalPageTextSelections, setInternalPageTextSelections] =
    useState<ReaderPageTextSelectionMap>(defaultPageTextSelections ?? {})
  const [internalPageRectSelections, setInternalPageRectSelections] =
    useState<ReaderPageRectSelectionMap>(defaultPageRectSelections ?? {})
  const [internalRenderMode, setInternalRenderMode] =
    useState<ReaderRenderMode>('layout')
  const [layoutPositionHandoff, setLayoutPositionHandoff] =
    useState<ReaderPositionHandoff<ReaderVirtualPaperState> | null>(null)
  const [textPositionHandoff, setTextPositionHandoff] =
    useState<ReaderPositionHandoff<ReaderTextReadingProgress> | null>(null)
  const [internalOcrEnabled, setInternalOcrEnabled] = useState(false)
  const [internalTouchPanMode, setInternalTouchPanMode] =
    useState<ReaderTouchPanMode>('single-finger')
  const [internalEdgeCropEditing, setInternalEdgeCropEditing] = useState(false)
  const [internalSelectedTool, setInternalSelectedTool] =
    useState<ReaderPageTool>('text-selection')
  const [internalDrawingStrokeColor, setInternalDrawingStrokeColor] =
    useState('#2563eb')
  const [internalHighlightColor, setInternalHighlightColor] = useState<
    string | undefined
  >(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const readerRootRef = useRef<HTMLDivElement>(null)
  const defaultBottomBarRef = useRef<HTMLDivElement>(null)
  const defaultSelectionRef = useRef<ReaderSelectionRef>(null)
  const currentTextAnchorRef = useRef<{
    readonly mode: ReaderRenderMode
    readonly document: ReaderDocumentInput
    readonly persistedValueKey: string
    readonly anchor: ReaderTextAnchor | undefined
  } | null>(null)
  const currentVirtualPaperStateRef = useRef<{
    readonly document: ReaderDocumentInput
    readonly replacedValueKey: string
    readonly value: ReaderVirtualPaperState
  } | null>(null)
  const resolvedPagePaintings =
    data?.pagePaintings ?? pagePaintings ?? internalPagePaintings
  const pagePaintingsRef = useRef(resolvedPagePaintings)
  pagePaintingsRef.current = resolvedPagePaintings
  const resolvedPageTextSelections =
    pageTextSelections ?? internalPageTextSelections
  const resolvedPageRectSelections =
    pageRectSelections ?? internalPageRectSelections
  const pageTextSelectionsRef = useRef(resolvedPageTextSelections)
  pageTextSelectionsRef.current = resolvedPageTextSelections
  const pageRectSelectionsRef = useRef(resolvedPageRectSelections)
  pageRectSelectionsRef.current = resolvedPageRectSelections
  const resolvedRanges =
    data?.ranges ??
    ranges ??
    (Object.keys(resolvedPageTextSelections).length > 0
      ? getLinkedRanges(resolvedPageTextSelections)
      : undefined)
  const resolvedRects =
    data?.rects ??
    rects ??
    (Object.keys(resolvedPageRectSelections).length > 0
      ? getPageRects(resolvedPageRectSelections)
      : undefined)
  const normalizedAnnotationHistory =
    normalizeAnnotationHistoryOptions(annotationHistory)
  const [historyStatus, setHistoryStatus] =
    useState<ReaderAnnotationHistoryStatus>({
      enabled: normalizedAnnotationHistory.enabled ?? false,
      canUndo: false,
      canRedo: false,
      pastCount: 0,
      futureCount: 0
    })
  const resolvedRenderMode = renderMode ?? internalRenderMode
  const previousRenderModeRef = useRef(resolvedRenderMode)
  const resolvedTextReadingProgress =
    textPositionHandoff !== null &&
    textPositionHandoff.document === document &&
    textPositionHandoff.replacedValueKey ===
      getReaderTextProgressKey(data?.textReadingProgress)
      ? textPositionHandoff.value
      : data?.textReadingProgress
  const resolvedVirtualPaperState =
    layoutPositionHandoff !== null &&
    layoutPositionHandoff.document === document &&
    layoutPositionHandoff.replacedValueKey ===
      getReaderVirtualPaperKey(data?.virtualPaper)
      ? layoutPositionHandoff.value
      : data?.virtualPaper
  const resolvedOcr = ocr ?? internalOcrEnabled
  const resolvedOcrEnabled =
    resolvedOcr === true ||
    (typeof resolvedOcr === 'object' && resolvedOcr.enabled === true)
  const resolvedTouchPanMode = touchPanMode ?? internalTouchPanMode
  const resolvedEdgeCropEditing = edgeCropEditing ?? internalEdgeCropEditing
  const resolvedSelectedTool = selectedTool ?? internalSelectedTool
  const resolvedDrawingStrokeColor =
    drawingStrokeColor ?? internalDrawingStrokeColor
  const resolvedHighlightColor = highlightColor ?? internalHighlightColor
  const hasDocumentPages = documentHasPages(document)
  const bottomBarInset = useBottomBarInset({
    rootRef: readerRootRef,
    bottomBarRef: defaultBottomBarRef,
    enabled: hasDocumentPages && bottomBar === undefined
  })
  const resolvedVerticalMargins = resolveVerticalMargins(
    containMarginTop,
    containMarginBottom,
    containMarginY,
    bottomBarInset
  )
  const bottomBarHistoryStatus = resolveBottomBarHistoryStatus({
    status: historyStatus,
    renderMode: resolvedRenderMode,
    hasHistoryChangeHandler: onAnnotationHistoryChange !== undefined,
    hasControlledAnnotations: [resolvedRanges, resolvedRects].some(
      (value) => value !== undefined
    )
  })
  const resolvedSelectionTool =
    tool ?? (resolvedSelectedTool === 'rect-selection' ? 'rect' : 'text')
  const resolvedBookmarkedPageNumbers =
    data?.bookmarkedPageNumbers ?? bookmarkedPageNumbers
  const resolvedBookmarks = data?.bookmarks ?? bookmarks
  const { usesPreciseBookmarks, canTogglePreciseBookmarks } =
    resolveBookmarkCapabilities({
      bookmarks: resolvedBookmarks,
      bookmarkedPageNumbers: resolvedBookmarkedPageNumbers,
      hasPreciseToggle: onToggleBookmark !== undefined,
      hasPageToggle: onTogglePageBookmark !== undefined,
      hasDataChange: onDataChange !== undefined
    })
  const usesPageTextSelectionCompatibility =
    pageTextSelections !== undefined ||
    defaultPageTextSelections !== undefined ||
    onPageTextSelectionsChange !== undefined
  const usesPageRectSelectionCompatibility =
    pageRectSelections !== undefined ||
    defaultPageRectSelections !== undefined ||
    onPageRectSelectionsChange !== undefined

  const handleSelectionRef = useCallback(
    (value: ReaderSelectionRef | null) => {
      defaultSelectionRef.current = value

      if (typeof selectionRef === 'function') {
        selectionRef(value)
      } else if (selectionRef) {
        selectionRef.current = value
      }
    },
    [selectionRef]
  )
  const popoverSelectionRef =
    selectionRef && typeof selectionRef !== 'function'
      ? selectionRef
      : defaultSelectionRef
  const resolvedSelectionRef =
    typeof selectionRef === 'function'
      ? handleSelectionRef
      : (selectionRef ?? defaultSelectionRef)

  useEffect(() => {
    setHistoryStatus((current) => ({
      ...current,
      enabled: normalizedAnnotationHistory.enabled ?? false
    }))
  }, [normalizedAnnotationHistory.enabled])

  const handoffReadingPosition = useCallback(
    (sourceMode: ReaderRenderMode, nextMode: ReaderRenderMode) => {
      if (nextMode === sourceMode) return
      const currentTextAnchor = currentTextAnchorRef.current
      const sourcePersistedValueKey =
        sourceMode === 'layout'
          ? getReaderVirtualPaperKey(data?.virtualPaper)
          : getReaderTextProgressKey(data?.textReadingProgress)
      const currentAnchor =
        currentTextAnchor !== null &&
        currentTextAnchor.mode === sourceMode &&
        currentTextAnchor.document === document &&
        currentTextAnchor.persistedValueKey === sourcePersistedValueKey
          ? currentTextAnchor.anchor
          : undefined
      const sourceAnchor =
        currentAnchor ??
        (sourceMode === 'layout'
          ? resolvedVirtualPaperState?.anchor
          : resolvedTextReadingProgress?.anchor)

      if (nextMode === 'text') {
        if (!sourceAnchor) {
          setTextPositionHandoff(null)
          return
        }
        setTextPositionHandoff({
          document,
          replacedValueKey: getReaderTextProgressKey(data?.textReadingProgress),
          value: {
            currentPageNumber: sourceAnchor.pageNumber,
            anchor: sourceAnchor
          }
        })
        return
      }

      if (!sourceAnchor) {
        setLayoutPositionHandoff(null)
        return
      }

      const persistedVirtualPaperKey = getReaderVirtualPaperKey(
        data?.virtualPaper
      )
      const currentVirtualPaperState = currentVirtualPaperStateRef.current
      const localVirtualPaper =
        currentVirtualPaperState !== null &&
        currentVirtualPaperState.document === document &&
        currentVirtualPaperState.replacedValueKey === persistedVirtualPaperKey
          ? currentVirtualPaperState.value
          : undefined
      const currentVirtualPaper = localVirtualPaper ??
        data?.virtualPaper ?? {
          x: 0,
          y: 0,
          scale: scale ?? defaultScale ?? 1
        }
      setLayoutPositionHandoff({
        document,
        replacedValueKey: persistedVirtualPaperKey,
        value: { ...currentVirtualPaper, anchor: sourceAnchor }
      })
    },
    [
      data?.textReadingProgress,
      data?.virtualPaper,
      defaultScale,
      document,
      resolvedTextReadingProgress?.anchor,
      resolvedVirtualPaperState?.anchor,
      scale
    ]
  )

  const handleRenderModeChange = useCallback(
    (nextMode: ReaderRenderMode) => {
      handoffReadingPosition(resolvedRenderMode, nextMode)
      if (renderMode === undefined) setInternalRenderMode(nextMode)
      onRenderModeChange?.(nextMode)

      if (nextMode === 'text' && resolvedEdgeCropEditing) {
        if (edgeCropEditing === undefined) setInternalEdgeCropEditing(false)
        onEdgeCropEditingChange?.(false)
      }
    },
    [
      edgeCropEditing,
      handoffReadingPosition,
      onEdgeCropEditingChange,
      onRenderModeChange,
      renderMode,
      resolvedEdgeCropEditing,
      resolvedRenderMode
    ]
  )

  useLayoutEffect(() => {
    const persistedTextProgressKey = getReaderTextProgressKey(
      data?.textReadingProgress
    )
    if (
      textPositionHandoff !== null &&
      (textPositionHandoff.document !== document ||
        textPositionHandoff.replacedValueKey !== persistedTextProgressKey)
    ) {
      setTextPositionHandoff(null)
    }

    const persistedVirtualPaperKey = getReaderVirtualPaperKey(
      data?.virtualPaper
    )
    if (
      layoutPositionHandoff !== null &&
      (layoutPositionHandoff.document !== document ||
        layoutPositionHandoff.replacedValueKey !== persistedVirtualPaperKey)
    ) {
      setLayoutPositionHandoff(null)
    }
  }, [
    data?.textReadingProgress,
    data?.virtualPaper,
    document,
    layoutPositionHandoff,
    textPositionHandoff
  ])

  useLayoutEffect(() => {
    const previousMode = previousRenderModeRef.current
    previousRenderModeRef.current = resolvedRenderMode
    if (previousMode === resolvedRenderMode) return
    handoffReadingPosition(previousMode, resolvedRenderMode)
  }, [handoffReadingPosition, resolvedRenderMode])

  const handleOcrChange = useCallback(
    (enabled: boolean) => {
      if (ocr === undefined) setInternalOcrEnabled(enabled)
      onOcrChange?.(enabled)
    },
    [ocr, onOcrChange]
  )

  const handleFontScaleChange = useCallback(
    (nextScale: ReaderFontScale) => onFontScaleChange?.(nextScale),
    [onFontScaleChange]
  )

  const handleTouchPanModeChange = useCallback(
    (nextMode: ReaderTouchPanMode) => {
      if (touchPanMode === undefined) setInternalTouchPanMode(nextMode)
      onTouchPanModeChange?.(nextMode)
    },
    [onTouchPanModeChange, touchPanMode]
  )

  const handleEdgeCropEditingChange = useCallback(
    (editing: boolean) => {
      if (edgeCropEditing === undefined) setInternalEdgeCropEditing(editing)
      onEdgeCropEditingChange?.(editing)
    },
    [edgeCropEditing, onEdgeCropEditingChange]
  )

  const handleSelectedToolChange = useCallback(
    (nextTool: ReaderPageTool) => {
      if (selectedTool === undefined) setInternalSelectedTool(nextTool)
      onSelectedToolChange?.(nextTool)
      if (
        nextTool === 'rect-selection' &&
        resolvedTouchPanMode !== 'two-finger'
      ) {
        handleTouchPanModeChange('two-finger')
      }
    },
    [
      handleTouchPanModeChange,
      onSelectedToolChange,
      resolvedTouchPanMode,
      selectedTool
    ]
  )

  const handleDrawingStrokeColorChange = useCallback(
    (color: string) => {
      if (drawingStrokeColor === undefined) setInternalDrawingStrokeColor(color)
      onDrawingStrokeColorChange?.(color)
    },
    [drawingStrokeColor, onDrawingStrokeColorChange]
  )

  const handleHighlightColorChange = useCallback(
    (color: string) => {
      if (highlightColor === undefined) setInternalHighlightColor(color)
      onHighlightColorChange?.(color)
    },
    [highlightColor, onHighlightColorChange]
  )

  const handleVirtualPaperTransformChangeEnd = useCallback(
    (virtualPaper: ReaderVirtualPaperState) => {
      currentVirtualPaperStateRef.current = {
        document,
        replacedValueKey: getReaderVirtualPaperKey(data?.virtualPaper),
        value: virtualPaper
      }
      onDataChange?.({ ...data, virtualPaper })
    },
    [data, document, onDataChange]
  )
  const handleTextAnchorChange = useCallback(
    (anchor: ReaderTextAnchor | undefined) => {
      currentTextAnchorRef.current = {
        mode: resolvedRenderMode,
        document,
        persistedValueKey:
          resolvedRenderMode === 'layout'
            ? getReaderVirtualPaperKey(data?.virtualPaper)
            : getReaderTextProgressKey(data?.textReadingProgress),
        anchor
      }
    },
    [
      data?.textReadingProgress,
      data?.virtualPaper,
      document,
      resolvedRenderMode
    ]
  )
  const handleTextReadingProgressChange = useCallback(
    (textReadingProgress: NonNullable<ReaderData['textReadingProgress']>) => {
      currentTextAnchorRef.current = {
        mode: 'text',
        document,
        persistedValueKey: getReaderTextProgressKey(data?.textReadingProgress),
        anchor: textReadingProgress.anchor
      }
      onDataChange?.({ ...data, textReadingProgress })
    },
    [data, document, onDataChange]
  )
  const handleToggleBookmark = useCallback(
    (bookmark: ReaderBookmark) => {
      onToggleBookmark?.(bookmark)
      if (!onDataChange) return

      const bookmarkKey = getTextAnchorKey(bookmark)
      const currentBookmarks = resolvedBookmarks ?? []
      const containsBookmark = currentBookmarks.some(
        (currentBookmark) => getTextAnchorKey(currentBookmark) === bookmarkKey
      )
      const nextBookmarks = containsBookmark
        ? currentBookmarks.filter(
            (currentBookmark) =>
              getTextAnchorKey(currentBookmark) !== bookmarkKey
          )
        : [...currentBookmarks, bookmark]
      onDataChange({ ...data, bookmarks: nextBookmarks })
    },
    [data, onDataChange, onToggleBookmark, resolvedBookmarks]
  )

  const handleFile = useCallback(
    (file: File) => {
      const fileInfo: UploadedFile = {
        name: file.name,
        size: file.size,
        type: file.type
      }
      setUploadedFile(fileInfo)
      onFileUpload?.(file)
    },
    [onFileUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        handleFile(files[0])
      }
    },
    [handleFile]
  )

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFile(files[0])
      }
    },
    [handleFile]
  )

  const handlePagePaintingChange = useCallback(
    (pageId: string, nextValue: DrawingValue) => {
      const nextPaintings: ReaderPagePaintingMap = {
        ...pagePaintingsRef.current,
        [pageId]: nextValue
      }
      pagePaintingsRef.current = nextPaintings

      if (data?.pagePaintings === undefined && pagePaintings === undefined) {
        setInternalPagePaintings(nextPaintings)
      }

      onPagePaintingChange?.(pageId, nextValue, nextPaintings)
      onPagePaintingsChange?.(nextPaintings)
    },
    [
      data?.pagePaintings,
      onPagePaintingChange,
      onPagePaintingsChange,
      pagePaintings
    ]
  )

  const handleSelect = useCallback(
    (range: ReaderSelectionRange) => {
      onSelect?.(range)
      if (
        !usesPageTextSelectionCompatibility ||
        range.start.selectionId !== range.end.selectionId
      ) {
        return
      }
      const pageId = range.start.selectionId
      const nextPageSelections = {
        ...pageTextSelectionsRef.current,
        [pageId]: [
          ...(pageTextSelectionsRef.current[pageId] ?? []),
          getPageTextSelection(range)
        ]
      }
      pageTextSelectionsRef.current = nextPageSelections
      if (pageTextSelections === undefined) {
        setInternalPageTextSelections(nextPageSelections)
      }
      onPageTextSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onPageTextSelectionsChange,
      onSelect,
      pageTextSelections,
      usesPageTextSelectionCompatibility
    ]
  )

  const handleUpdateRange = useCallback(
    (range: ReaderSelectionRange) => {
      onUpdateRange?.(range)
      if (
        !usesPageTextSelectionCompatibility ||
        range.start.selectionId !== range.end.selectionId
      ) {
        return
      }
      const pageId = range.start.selectionId
      const nextSelection = getPageTextSelection(range)
      const nextPageSelections = {
        ...pageTextSelectionsRef.current,
        [pageId]: (pageTextSelectionsRef.current[pageId] ?? []).map(
          (selection) =>
            selection.id === nextSelection.id ? nextSelection : selection
        )
      }
      pageTextSelectionsRef.current = nextPageSelections
      if (pageTextSelections === undefined) {
        setInternalPageTextSelections(nextPageSelections)
      }
      onPageTextSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onPageTextSelectionsChange,
      onUpdateRange,
      pageTextSelections,
      usesPageTextSelectionCompatibility
    ]
  )

  const handleCreateRect = useCallback(
    (rectangle: ReaderSelectionRectangle) => {
      onCreateRect?.(rectangle)
      if (!usesPageRectSelectionCompatibility || !rectangle.selectionId) return
      const pageId = rectangle.selectionId
      const nextPageSelections = {
        ...pageRectSelectionsRef.current,
        [pageId]: [...(pageRectSelectionsRef.current[pageId] ?? []), rectangle]
      }
      pageRectSelectionsRef.current = nextPageSelections
      if (pageRectSelections === undefined) {
        setInternalPageRectSelections(nextPageSelections)
      }
      onPageRectSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onCreateRect,
      onPageRectSelectionsChange,
      pageRectSelections,
      usesPageRectSelectionCompatibility
    ]
  )

  const handleUpdateRect = useCallback(
    (rectangle: ReaderSelectionRectangle) => {
      onUpdateRect?.(rectangle)
      if (!usesPageRectSelectionCompatibility || !rectangle.selectionId) return
      const pageId = rectangle.selectionId
      const nextPageSelections = {
        ...pageRectSelectionsRef.current,
        [pageId]: (pageRectSelectionsRef.current[pageId] ?? []).map(
          (selection) => (selection.id === rectangle.id ? rectangle : selection)
        )
      }
      pageRectSelectionsRef.current = nextPageSelections
      if (pageRectSelections === undefined) {
        setInternalPageRectSelections(nextPageSelections)
      }
      onPageRectSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onPageRectSelectionsChange,
      onUpdateRect,
      pageRectSelections,
      usesPageRectSelectionCompatibility
    ]
  )

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const rootClassName = className
    ? `hamster-reader ${className}`
    : 'hamster-reader'
  const readerThemeStyle: CSSProperties & {
    '--hamster-reader-theme-color': string
  } = {
    '--hamster-reader-theme-color': themeColor ?? '#2563eb'
  }

  const handleDefaultCommentHighlight = useCallback(
    async (range: ReaderSelectionRange) => {
      const result = await onCommentHighlight?.(range)
      if (selectedRangeId === range.id) {
        onSelectRange?.(null)
      }
      return result ?? range
    },
    [onCommentHighlight, selectedRangeId, onSelectRange]
  )

  const handleDefaultCommentRect = useCallback(
    async (rectangle: ReaderSelectionRectangle) => {
      await onCommentRect?.(rectangle)
      if (selectedRectId === rectangle.id) {
        onSelectRect?.(null)
      }
      return rectangle
    },
    [onCommentRect, onSelectRect, selectedRectId]
  )

  const showUploadZone = !document && !uploadedFile
  const showFileInfo = !document && uploadedFile
  const showDocumentContent = document?.title ?? emptyText
  const renderDocumentContent = () => {
    if (hasDocumentPages) {
      if (resolvedRenderMode === 'text') {
        return (
          <IntermediateDocumentTextViewer
            document={document}
            isEpub={isEpub}
            isPdf={isPdf}
            fontScale={fontScale}
            containMarginX={containMarginX}
            containMarginTop={resolvedVerticalMargins.top}
            containMarginBottom={resolvedVerticalMargins.bottom}
            containMarginY={resolvedVerticalMargins.legacy}
            showPageBrowser={showPageBrowser}
            onPageBrowserClose={onPageBrowserClose}
            themeColor={themeColor}
            commentCountByRangeId={commentCountByRangeId}
            bookmarks={whenEnabled(usesPreciseBookmarks, resolvedBookmarks)}
            onToggleBookmark={whenEnabled(
              usesPreciseBookmarks && canTogglePreciseBookmarks,
              handleToggleBookmark
            )}
            bookmarkedPageNumbers={resolvedBookmarkedPageNumbers}
            onTogglePageBookmark={onTogglePageBookmark}
            textReadingProgress={resolvedTextReadingProgress}
            onTextReadingProgressChange={handleTextReadingProgressChange}
            onTextAnchorChange={handleTextAnchorChange}
            pageRange={pageRange}
            hiddenPages={data?.hiddenPages}
            className={className}
            maxLoadedPages={maxLoadedPages}
            ranges={resolvedRanges}
            defaultRanges={defaultRanges}
            selectedRangeId={selectedRangeId}
            defaultSelectedRangeId={defaultSelectedRangeId}
            onSelect={handleSelect}
            onLinkedDataChange={onLinkedDataChange}
            onLinkedSelect={onLinkedSelect}
            onLinkedUpdateRange={onLinkedUpdateRange}
            onLinkedSelectRange={onLinkedSelectRange}
            onSelectRange={onSelectRange}
            onUpdateRange={handleUpdateRange}
            onRemoveRange={onRemoveRange}
            onRemoveRect={onRemoveRect}
            onSelectionStart={onSelectionStart}
            onSelectionEnd={onSelectionEnd}
            onHighlight={onHighlight}
            highlightColor={resolvedHighlightColor}
            selectionColor={selectionColor}
            showSelectionMagnifier={showSelectionMagnifier}
            selectionPopover={
              selectionPopover ?? (
                <DefaultSelectionPopover
                  selectionRef={popoverSelectionRef}
                  highlightColor={resolvedHighlightColor}
                  onHighlightColorChange={handleHighlightColorChange}
                  selectedRangeId={selectedRangeId}
                  ranges={resolvedRanges}
                  onUpdateRange={handleUpdateRange}
                  onRemoveRange={onRemoveRange}
                />
              )
            }
            highlightPopover={
              highlightPopover ??
              ((highlight) => (
                <DefaultHighlightPopover
                  selectionRef={popoverSelectionRef}
                  highlightColor={resolvedHighlightColor}
                  onHighlightColorChange={handleHighlightColorChange}
                  selectedRangeId={highlight.id}
                  ranges={resolvedRanges}
                  onUpdateRange={handleUpdateRange}
                  onRemoveRange={onRemoveRange}
                  onCommentHighlight={whenEnabled(
                    onCommentHighlight !== undefined,
                    handleDefaultCommentHighlight
                  )}
                />
              ))
            }
            onCommentHighlight={whenEnabled(
              highlightPopover !== undefined,
              onCommentHighlight
            )}
            autoHighlight={autoHighlight}
            selectionRef={resolvedSelectionRef}
            overlayRectType={overlayRectType}
            initialLoadedPages={initialLoadedPages}
            pageLoadConcurrency={pageLoadConcurrency}
            pageLoadEnterDelayMs={pageLoadEnterDelayMs}
            pagePreloadRadius={pagePreloadRadius}
            pageUnloadDelayMs={pageUnloadDelayMs}
            onTextSelectionChange={onTextSelectionChange}
            onTextSelectionEnd={onTextSelectionEnd}
            onSelectText={onSelectText}
            onIntermediateDocumentRenderTiming={
              onIntermediateDocumentRenderTiming
            }
            popoverRelative={popoverRelative}
          />
        )
      }

      return (
        <IntermediateDocumentViewer
          document={document}
          isEpub={isEpub}
          isPdf={isPdf}
          fontScale={fontScale}
          overscan={overscanPages}
          pageRange={pageRange}
          hiddenPages={data?.hiddenPages}
          edgeCrop={data?.edgeCrop}
          edgeCropEditing={resolvedEdgeCropEditing}
          onEdgeCropApply={onEdgeCropApply}
          ocr={resolvedOcr}
          extraOCR={extraOCR}
          onOcrError={onOcrError}
          ocrTexts={ocrTexts}
          onOcrTextsChange={onOcrTextsChange}
          ocrDebug={ocrDebug}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
          onSelectText={onSelectText}
          scale={whenEnabled(resolvedVirtualPaperState === undefined, scale)}
          defaultScale={whenEnabled(
            resolvedVirtualPaperState === undefined,
            defaultScale
          )}
          defaultVirtualPaperTransform={resolvedVirtualPaperState}
          onVirtualPaperTransformChangeEnd={
            handleVirtualPaperTransformChangeEnd
          }
          onTextAnchorChange={handleTextAnchorChange}
          onScaleChange={onScaleChange}
          minScale={minScale}
          maxScale={maxScale}
          maxLoadedPages={maxLoadedPages}
          interactionMode={interactionMode}
          touchPanMode={resolvedTouchPanMode}
          ranges={resolvedRanges}
          defaultRanges={defaultRanges}
          selectedRangeId={selectedRangeId}
          defaultSelectedRangeId={defaultSelectedRangeId}
          onSelect={handleSelect}
          onLinkedDataChange={onLinkedDataChange}
          onLinkedSelect={onLinkedSelect}
          onLinkedUpdateRange={onLinkedUpdateRange}
          onLinkedSelectRange={onLinkedSelectRange}
          onSelectRange={onSelectRange}
          onUpdateRange={handleUpdateRange}
          onRemoveRange={onRemoveRange}
          onRemoveRect={onRemoveRect}
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          onHighlight={onHighlight}
          onDragHighlight={onDragHighlight}
          highlightColor={resolvedHighlightColor}
          selectionColor={selectionColor}
          showSelectionMagnifier={showSelectionMagnifier}
          selectionPopover={
            selectionPopover ?? (
              <DefaultSelectionPopover
                selectionRef={popoverSelectionRef}
                highlightColor={resolvedHighlightColor}
                onHighlightColorChange={handleHighlightColorChange}
                selectedRangeId={selectedRangeId}
                ranges={resolvedRanges}
                onUpdateRange={handleUpdateRange}
                onRemoveRange={onRemoveRange}
              />
            )
          }
          highlightPopover={
            highlightPopover ??
            ((highlight) => (
              <DefaultHighlightPopover
                selectionRef={popoverSelectionRef}
                highlightColor={resolvedHighlightColor}
                onHighlightColorChange={handleHighlightColorChange}
                selectedRangeId={highlight.id}
                ranges={resolvedRanges}
                onUpdateRange={handleUpdateRange}
                onRemoveRange={onRemoveRange}
                onCommentHighlight={whenEnabled(
                  onCommentHighlight !== undefined,
                  handleDefaultCommentHighlight
                )}
              />
            ))
          }
          onCommentHighlight={whenEnabled(
            highlightPopover !== undefined,
            onCommentHighlight
          )}
          autoHighlight={autoHighlight}
          selectionRef={resolvedSelectionRef}
          overlayRectType={overlayRectType}
          tool={resolvedSelectionTool}
          rects={resolvedRects}
          selectedRectId={selectedRectId}
          rectPopover={
            rectPopover ??
            ((rectangle) => (
              <DefaultRectanglePopover
                rectangle={rectangle}
                highlightColor={resolvedHighlightColor}
                onHighlightColorChange={handleHighlightColorChange}
                onUpdateRect={handleUpdateRect}
                onRemoveRect={onRemoveRect}
                onCommentRect={whenEnabled(
                  onCommentRect !== undefined,
                  handleDefaultCommentRect
                )}
              />
            ))
          }
          onCreateRect={handleCreateRect}
          onSelectRect={onSelectRect}
          onUpdateRect={handleUpdateRect}
          annotationHistory={normalizedAnnotationHistory}
          onAnnotationHistoryChange={onAnnotationHistoryChange}
          onAnnotationHistoryStatusChange={setHistoryStatus}
          initialLoadedPages={initialLoadedPages}
          pageLoadConcurrency={pageLoadConcurrency}
          pageLoadEnterDelayMs={pageLoadEnterDelayMs}
          pagePreloadRadius={pagePreloadRadius}
          pageUnloadDelayMs={pageUnloadDelayMs}
          onIntermediateDocumentRenderTiming={
            onIntermediateDocumentRenderTiming
          }
          containMarginX={containMarginX}
          containMarginTop={resolvedVerticalMargins.top}
          containMarginBottom={resolvedVerticalMargins.bottom}
          containMarginY={resolvedVerticalMargins.legacy}
          selectedTool={resolvedSelectedTool}
          paintingTool={paintingTool}
          drawingStrokeColor={resolvedDrawingStrokeColor}
          pagePaintings={resolvedPagePaintings}
          onPagePaintingChange={handlePagePaintingChange}
          showPageBrowser={showPageBrowser}
          onPageBrowserClose={onPageBrowserClose}
          themeColor={themeColor}
          commentCountByRangeId={commentCountByRangeId}
          commentCountByRectId={commentCountByRectId}
          comments={comments}
          onCommentsChange={onCommentsChange}
          bookmarks={whenEnabled(usesPreciseBookmarks, resolvedBookmarks)}
          onToggleBookmark={whenEnabled(
            usesPreciseBookmarks && canTogglePreciseBookmarks,
            handleToggleBookmark
          )}
          bookmarkedPageNumbers={resolvedBookmarkedPageNumbers}
          onTogglePageBookmark={onTogglePageBookmark}
          onPageLoadStatusChange={onPageLoadStatusChange}
          popoverRelative={popoverRelative}
        />
      )
    }

    return showUploadZone ? emptyText : showDocumentContent
  }

  return (
    <div
      ref={readerRootRef}
      className={rootClassName}
      data-testid='reader-root'
      style={readerThemeStyle}
    >
      {showUploadZone && (
        <button
          type='button'
          className={`hamster-reader__upload-zone ${isDragging ? 'hamster-reader__upload-zone--dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
          data-testid='upload-zone'
        >
          <input
            ref={fileInputRef}
            type='file'
            accept={SUPPORTED_UPLOAD_ACCEPT}
            onChange={handleInputChange}
            className='hamster-reader__file-input'
            data-testid='file-input'
          />
          <div className='hamster-reader__upload-content'>
            <svg
              className='hamster-reader__upload-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-label='Upload'
            >
              <title>Upload icon</title>
              <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
              <polyline points='17 8 12 3 7 8' />
              <line x1='12' y1='3' x2='12' y2='15' />
            </svg>
            <p className='hamster-reader__upload-text'>
              {isDragging
                ? 'Drop document here'
                : 'Click or drag document to upload'}
            </p>
            <p className='hamster-reader__upload-hint'>
              Supports {SUPPORTED_UPLOAD_COPY} files
            </p>
          </div>
        </button>
      )}

      {showDocumentContent && !showFileInfo && (
        <div className='hamster-reader__content' data-testid='reader-content'>
          {renderDocumentContent()}
        </div>
      )}

      {hasDocumentPages &&
        (bottomBar === undefined ? (
          <DefaultBottomBar
            bottomBarRef={defaultBottomBarRef}
            renderMode={resolvedRenderMode}
            isEpub={isEpub}
            ocrEnabled={resolvedOcrEnabled}
            fontScale={fontScale}
            touchPanMode={resolvedTouchPanMode}
            edgeCropEditing={resolvedEdgeCropEditing}
            selectedTool={resolvedSelectedTool}
            drawingStrokeColor={resolvedDrawingStrokeColor}
            historyStatus={bottomBarHistoryStatus}
            selectionRef={popoverSelectionRef}
            onRenderModeChange={handleRenderModeChange}
            onOcrChange={handleOcrChange}
            onFontScaleChange={handleFontScaleChange}
            onTouchPanModeChange={handleTouchPanModeChange}
            onEdgeCropEditingChange={handleEdgeCropEditingChange}
            onSelectedToolChange={handleSelectedToolChange}
            onDrawingStrokeColorChange={handleDrawingStrokeColorChange}
            onHighlightColorChange={handleHighlightColorChange}
          />
        ) : (
          bottomBar
        ))}

      {showFileInfo && (
        <div className='hamster-reader__file-info' data-testid='file-info'>
          <svg
            className='hamster-reader__file-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-label='File'
          >
            <title>File icon</title>
            <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
            <polyline points='14 2 14 8 20 8' />
          </svg>
          <div className='hamster-reader__file-details'>
            <p className='hamster-reader__file-name'>{uploadedFile.name}</p>
            <p className='hamster-reader__file-meta'>
              {formatFileSize(uploadedFile.size)} •{' '}
              {uploadedFile.type || 'unknown type'}
            </p>
          </div>
          <button
            type='button'
            className='hamster-reader__upload-another'
            onClick={handleClick}
            data-testid='upload-another-btn'
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  )
}
