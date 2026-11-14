import { isPdfLayoutReady, observePdfLayout } from './pdfLayoutReady'
import { pdfHighlightFill } from './pdfSelectionPaint'
import { usePdfTouchSelection, pdfCaretAtPoint } from './pdfTouchSelection'
import { normalizeBookmark, type ReadingPosition } from '../readingProgress'
import {
  intersects,
  pagePercentage,
  type ViewportRect
} from '../viewportPosition'
import { readingViewport } from '../components/reading/readingViewport'
import { usePdfLayoutAnchor } from './usePdfLayoutAnchor'
import { createPaintingSettings } from '../painting/paintingSettings'
// HAM-89 / tasks.md 3.1–3.5：PDF 主展示切换到 pdfjs-dist 官方 viewer。
// 官方 PDFViewer/PDFLinkService/EventBus 负责页面、文本层、链接、缩放与
// 渲染队列（懒加载）；reader 叠加层负责高亮/矩形/绘图。本组件不修改公共
// Reader 路由与 demo 入口，接线由集成任务（HAM-91）完成。

import type {
  LayeredEditorTool,
  EditorDocument,
  LayeredToolsSnapshot
} from '@hamster-note/painting/core'
import { createPageGeometry } from '@hamster-note/painting/core'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { EventBus, PDFLinkService, PDFViewer } from './pdfViewerLib'
import { CroppedPdfViewer } from './CroppedPdfViewer'
import { groupHiddenPages, normalizeHiddenPageNumbers } from './hiddenPages'
import { PdfHiddenPageGroupControls } from './PdfHiddenPageGroupControls'
import { PdfHiddenPageRestoreModal } from './PdfHiddenPageRestoreModal'
import { scrollIntoViewIfAttached } from '../components/scrollIntoViewIfAttached'
import {
  activatePageIfReady,
  isPageViewActivatable,
  waitForPageActivation
} from './pageActivation'

import type { ReaderTextAnchor, ReaderBookmark } from '../types/readerData'
import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../types/selection'
import {
  PdfSessionManager,
  type PdfDocumentSource,
  type PdfOpenErrorKind
} from './pdfDocumentSession'
import {
  AnnotationMode,
  configurePdfJsWorker,
  type PageViewport,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type TextItem
} from './pdfjsRuntime'
import type { PdfPageOverlayGeometry } from './PdfPageOverlayLayer'
import { PdfPageOverlayLayer } from './PdfPageOverlayLayer'
import { getSelectionGroup } from '../components/selection/selectionGroups'
import type { OverlayRectUnit } from './pdfOverlayGeometry'
import type { ReaderPageEdgeCrop } from '../types/readerData'
import {
  getPageCropGeometry,
  resolvePageEdgeCrop
} from '../components/IntermediateDocumentViewer/pageDisplay'
import { EdgeCropOverlay } from '../components/IntermediateDocumentViewer/EdgeCropOverlay'
import type { ReaderPageRange } from '../components/IntermediateDocumentViewer'
import { getVisiblePageNumbers } from '../components/IntermediateDocumentViewer/pageDisplay'
import { usePdfOcr, type PdfOcrOptions } from './usePdfOcr'
import { PdfOcrTextLayer } from './PdfOcrTextLayer'
import type { PdfPageSelectionContext } from './pdfSelectionSerializer'
import { serializePdfTextSelection } from './pdfSelectionSerializer'
import { bindPdfSourceLinks } from './pdfSourceLinks'
import type { SerializedPdfSelection } from './pdfSelectionSerializer'
import type { CanonicalPageText } from './pdfTextMapping'
import {
  buildCanonicalPageText,
  enhanceTextLayer,
  canonicalRangeToDomRange
} from './pdfTextMapping'

import { firstVisiblePdfCharacterGeometry } from './pdfReadingPosition'

type VisiblePdfAnchor = { anchor: ReaderTextAnchor; top: number }

function capturePageText(
  context: PdfPageSelectionContext | undefined,
  canonical: CanonicalPageText | undefined,
  failed: boolean,
  clip: ViewportRect
):
  | { status: 'ready'; character?: VisiblePdfAnchor }
  | { status: 'pending' | 'failed' } {
  if (failed) return { status: 'failed' }
  if (
    !context?.textLayerDiv.isConnected ||
    !context.textLayerDiv.querySelector('.textLayer')
  )
    return { status: canonical?.text === '' ? 'ready' : 'pending' }
  return {
    status: 'ready',
    character: firstVisiblePdfCharacterGeometry([context], clip) ?? undefined
  }
}

export type PdfViewerTool = 'text-selection' | 'rect-selection' | 'drawing'

export type PdfViewerStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PdfViewerError = {
  readonly kind: PdfOpenErrorKind
  readonly message: string
}

export type PdfDocumentViewerProps = PdfOcrOptions & {
  readonly source: PdfDocumentSource | null
  readonly readingInsets?: { top: number; bottom: number; horizontal: number }
  readonly onDocumentReady?: (document: PDFDocumentProxy | null) => void
  /** pdfjs worker 资产 URL（宿主提供；不设置时沿用全局配置）。 */
  readonly workerSrc?: string
  /** cMapUrl/standardFontDataUrl 等 getDocument 透传参数。 */
  readonly documentOptions?: Readonly<Record<string, unknown>>
  readonly className?: string
  readonly scale?: number
  readonly defaultScale?: number
  readonly fitWidth?: boolean
  readonly onScaleChange?: (scale: number) => void
  readonly currentPageNumber?: number
  readonly onPageChange?: (pageNumber: number) => void
  readonly onPagesLoaded?: (pageCount: number) => void
  readonly onTextLayerReady?: (loadedPages: readonly number[]) => void
  readonly onLoadingProgress?: (
    loaded: number,
    total: number | undefined
  ) => void
  readonly onError?: (error: PdfViewerError) => void
  readonly tool?: PdfViewerTool
  readonly overlayRectType?: OverlayRectUnit
  readonly highlightColor?: string
  readonly ranges?: readonly ReaderSelectionRange[]
  readonly rects?: readonly ReaderSelectionRectangle[]
  readonly pagePaintings?: Record<string, EditorDocument>
  readonly selectedRangeId?: string | null
  readonly selectedRectId?: string | null
  readonly onHighlight?: (range: ReaderSelectionRange) => void
  readonly onSelectRange?: (id: string | null) => void
  readonly onCreateRect?: (rect: ReaderSelectionRectangle) => void
  readonly onDraftRect?: (rect: ReaderSelectionRectangle) => void
  readonly draftRectangle?: ReaderSelectionRectangle | null
  readonly onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  readonly onSelectRect?: (id: string | null) => void
  readonly onPagePaintingChange?: (
    pageId: string,
    nextValue: EditorDocument,
    nextPaintings: Record<string, EditorDocument>
  ) => void
  readonly onPagePaintingsChange?: (
    next: Record<string, EditorDocument>
  ) => void
  readonly paintingSettings?: LayeredToolsSnapshot
  readonly onPaintingSettingsChange?: (data: LayeredToolsSnapshot) => void
  /** 未受控 controllerData 时的默认绘图工具（默认 'pen'）。 */
  readonly paintingTool?: LayeredEditorTool
  /** 未受控 controllerData 时的默认笔触颜色（默认 '#2563eb'）。 */
  readonly drawingStrokeColor?: string
  /** 原生选区变化（text 为拼接文本，detail 含公开端点与矩形）。 */
  readonly onTextSelectionChange?: (
    text: string,
    detail: SerializedPdfSelection | null
  ) => void
  /** 阅读锚点变化（书签/进度用；textId 失效时宿主按 offset 兜底）。 */
  readonly onTextAnchorChange?: (anchor: ReaderTextAnchor | null) => void
  readonly onReadingPositionChange?: (position: ReadingPosition) => void
  readonly onRestoreError?: (message: string) => void
  readonly viewportTopInset?: number
  readonly viewportBottomInset?: number
  /** 隐藏页（数字或 'page-N'，与 ReaderData.hiddenPages 同契约）。 */
  readonly hiddenPages?: readonly (number | string)[]
  readonly pageRange?: ReaderPageRange
  /** 裁切（0..1 分数；页级覆盖由宿主合并后传入单页值亦可）。 */
  readonly edgeCrop?: ReaderPageEdgeCrop
  readonly edgeCropEditing?: boolean
  readonly onEdgeCropApply?: React.ComponentProps<
    typeof EdgeCropOverlay
  >['onApply']
  readonly onEdgeCropHidePage?: (pageNumber: number) => void
  readonly onDisposal?: (completion: Promise<void>) => void
  readonly onHiddenPagesRestore?: (pageNumbers: readonly number[]) => void
  readonly canUndoHiddenPagesRestore?: boolean
  readonly onHiddenPagesRestoreUndo?: () => void
}

export type PdfDocumentViewerRef = {
  readonly releasePreviewPage: (
    document: PDFDocumentProxy,
    page: PDFPageProxy
  ) => void
  readonly scrollToPage: (pageNumber: number) => void
  readonly setScale: (scale: number) => void
  readonly captureTextAnchor: () => ReaderTextAnchor | null
  readonly captureReadingPosition: () => ReadingPosition
  readonly captureModeSwitchPosition?: () => ReadingPosition
  readonly isRendering: () => boolean
  /**
   * Scrolls to a saved anchor.
   *
   * Rejects immediately when the target page is not in the current visible
   * set, its page view is detached, or it has a `display:none` ancestor. The
   * request is NOT queued until the page becomes visible; callers must treat
   * this as "unavailable now" and retry from a user action.
   *
   * Resolves once the positioning rectangle for the anchor has been applied
   * and PDF.js reports the destination; this does NOT mean the canvas/page
   * render has completed.
   *
   * Rejects on the 10s positioning timeout or when a newer navigation
   * supersedes this request. A timeout/superseded request may already have
   * invoked PDF.js positioning before rejecting; only the entry-level
   * unavailable check below guarantees PDF.js was not touched.
   */
  readonly scrollToAnchor: (
    anchor: ReaderBookmark,
    options?: { preserveOnFailure?: boolean }
  ) => Promise<void>
  /**
   * Internal restore path. Same contract as `scrollToAnchor`, except that a
   * page view which is not attached/visible yet (initial load, crop restore)
   * is awaited up to the positioning timeout instead of rejecting.
   */
  readonly scrollToAnchorForRestore: (
    anchor: ReaderBookmark,
    options?: { preserveOnFailure?: boolean }
  ) => Promise<void>
  readonly scrollToRange: (rangeId: string) => void
  readonly getCanonicalPageText: (pageNumber: number) => string | undefined
  /** 把当前原生选区转为公开 range 并触发 onHighlight。 */
  readonly confirmSelection: () => void
  readonly clearSelection: () => void
  readonly selectRange: (id: string) => Range | null
  readonly getSelectionRange: () => Range | null
  readonly setSelectionRange: (range: Range | null, touch?: boolean) => void
  readonly serializeRangeEndpoint: (
    id: string,
    range: Range,
    end: boolean
  ) => SerializedPdfSelection | null
  readonly hitTestSelection: (x: number, y: number) => Range | null
  readonly serializeSelection: () => SerializedPdfSelection | null
}

type TextLayerRenderedEvent = {
  readonly pageNumber: number
  readonly source: { readonly div: HTMLElement }
}

let highlightIdCounter = 0
const nextHighlightId = (): string => {
  highlightIdCounter += 1
  return `pdf-range-${Date.now().toString(36)}-${highlightIdCounter}`
}

// 未受控时忽略 controllerData 变更，与 IntermediateDocumentViewer 一致。
function ignoreControllerDataChange() {}

// 官方类型声明只接受 PDFDocumentProxy，运行时 setDocument(null) 是清空文档的
// 公开路径（pdf.js viewer.js 内部判空）。
const setViewerDocument = (
  target: { setDocument: (doc: PDFDocumentProxy) => void },
  doc: PDFDocumentProxy | null
): void => {
  target.setDocument(doc as PDFDocumentProxy)
}

type OverlayPortalProps = {
  readonly pageDiv: HTMLElement
  readonly children: ReactNode
}

const filterHiddenPages = (
  pages: readonly number[],
  hiddenPages: readonly (number | string)[] | undefined
): readonly number[] => {
  const hidden = normalizeHiddenPageNumbers(hiddenPages)
  return pages.filter((page) => !hidden.has(page))
}

/**
 * 叠加层 portal 容器。pdf.js 缩放/重渲染时会清空 page div 的子节点——
 * 若 React portal 直接挂在 page div 上，卸载时 removeChild 会与 pdf.js
 * 冲突（NotFoundError）。portal 挂进自有 wrapper：pdf.js 清空时 wrapper
 * 连同其子树整体脱离，React 内部一致性不受破坏；渲染后若 wrapper 已脱离
 * 则重新挂载（懒加载重挂载，tasks.md 3.3）。
 */
function PdfOverlayPortal({ pageDiv, children }: OverlayPortalProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  if (!wrapperRef.current) {
    wrapperRef.current = pageDiv.ownerDocument.createElement('div')
    wrapperRef.current.style.display = 'contents'
  }
  const wrapper = wrapperRef.current

  useEffect(() => {
    pageDiv.appendChild(wrapper)
    return () => wrapper.remove()
  }, [pageDiv, wrapper])

  // pdf.js 重置 page div 后 wrapper 处于脱离状态：每次渲染检查并重新挂载。
  useEffect(() => {
    if (wrapper.parentElement !== pageDiv) pageDiv.appendChild(wrapper)
  })

  return createPortal(children, wrapper)
}

export const PdfDocumentViewer = forwardRef<
  PdfDocumentViewerRef,
  PdfDocumentViewerProps
>(function PdfDocumentViewer(props, ref) {
  const {
    source,
    workerSrc,
    documentOptions,
    className,
    scale,
    defaultScale = 1,
    fitWidth = false,
    onScaleChange,
    currentPageNumber,
    onPageChange,
    onPagesLoaded,
    onTextLayerReady,
    onLoadingProgress,
    onError,
    tool = 'text-selection',
    overlayRectType = 'percent',
    highlightColor = 'rgba(255, 193, 7, 0.35)',
    ranges = [],
    rects = [],
    pagePaintings = {},
    selectedRangeId,
    selectedRectId,
    onHighlight,
    onSelectRange,
    onCreateRect,
    onDraftRect,
    draftRectangle,
    onUpdateRect,
    onSelectRect,
    onPagePaintingChange,
    onPagePaintingsChange,
    paintingSettings,
    paintingTool,
    drawingStrokeColor,
    onPaintingSettingsChange,
    onTextSelectionChange,
    onTextAnchorChange,
    hiddenPages,
    pageRange,
    edgeCrop,
    edgeCropEditing,
    onEdgeCropApply,
    onEdgeCropHidePage
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElementRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const eventBusRef = useRef<EventBus | null>(null)
  const linkServiceRef = useRef<PDFLinkService | null>(null)
  const sessionManagerRef = useRef(new PdfSessionManager())
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const failedTextPages = useRef(new Set<number>())
  const progressOptions = useRef(props)
  progressOptions.current = props
  const canonicalCacheRef = useRef(new Map<number, CanonicalPageText>())
  const selectionContextsRef = useRef(
    new Map<number, PdfPageSelectionContext>()
  )
  const [status, setStatus] = useState<PdfViewerStatus>('idle')
  const [geometryVersion, setGeometryVersion] = useState(0)
  const [overlayPages, setOverlayPages] = useState<readonly number[]>([])
  const [ocrDocument, setOcrDocument] = useState<PDFDocumentProxy | null>(null)
  const [renderedPages, setRenderedPages] = useState<readonly number[]>([])
  const [restoreGroupStart, setRestoreGroupStart] = useState<number | null>(
    null
  )
  const restoreTriggerRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => setRestoreGroupStart(null), [source, edgeCropEditing])
  useEffect(() => {
    pendingPageRef.current = null
  }, [source])
  useEffect(() => {
    if (restoreGroupStart !== null || !restoreTriggerRef.current) return
    restoreTriggerRef.current.focus()
    restoreTriggerRef.current = null
  }, [restoreGroupStart])
  const allowedPages = getVisiblePageNumbers([...overlayPages], pageRange)
  const readablePages = filterHiddenPages(allowedPages, hiddenPages)
  const hiddenGroups = groupHiddenPages(hiddenPages, allowedPages)
  const visiblePagesRef = useRef(readablePages)
  visiblePagesRef.current = readablePages
  const pendingPageRef = useRef<{
    pageNumber: number
    run?: () => void
  } | null>(null)
  const activatePage = (pageNumber: number): boolean => {
    const viewer = viewerRef.current
    if (!viewer || !activatePageIfReady(viewer, pageNumber)) {
      pendingPageRef.current = { pageNumber }
      return false
    }
    pendingPageRef.current = null
    return true
  }
  const retryPendingPage = () => {
    const pending = pendingPageRef.current
    if (!pending) return
    const viewer = viewerRef.current
    if (
      !viewer ||
      !isPageViewActivatable(viewer.getPageView(pending.pageNumber - 1))
    )
      return
    pendingPageRef.current = null
    if (pending.run) pending.run()
    else activatePage(pending.pageNumber)
  }
  const navigationOptionsRef = useRef({ pageRange, hiddenPages })
  navigationOptionsRef.current = { pageRange, hiddenPages }
  const ocrTexts = usePdfOcr(ocrDocument, renderedPages, readablePages, props)
  const ocrTextsRef = useRef(ocrTexts)
  ocrTextsRef.current = ocrTexts
  const withOcr = (canonical: CanonicalPageText): CanonicalPageText =>
    buildCanonicalPageText(canonical.pageNumber, [
      ...canonical.spans.map((span) => ({ str: span.domText })),
      ...(ocrTextsRef.current.get(canonical.pageNumber) ?? []).map((text) => ({
        str: text.content,
        textId: text.id
      }))
    ])
  // 事件回调经 ref 读取，避免 init effect 闭包过期。
  const paintingsState = useRef({
    source,
    supplied: pagePaintings,
    current: pagePaintings
  })
  if (
    paintingsState.current.source !== source ||
    paintingsState.current.supplied !== pagePaintings
  ) {
    paintingsState.current = {
      source,
      supplied: pagePaintings,
      current: pagePaintings
    }
  }
  const callbacksRef = useRef({
    onOcrError: props.onOcrError,
    onPageChange,
    onScaleChange,
    onPagesLoaded,
    onTextLayerReady
  })
  callbacksRef.current = {
    onOcrError: props.onOcrError,
    onPageChange,
    onScaleChange,
    onPagesLoaded,
    onTextLayerReady
  }
  // pagesinit 时的初始缩放：受控 scale 优先于 defaultScale。
  const initialScaleRef = useRef(scale ?? defaultScale)
  initialScaleRef.current = scale ?? defaultScale
  const fitWidthRef = useRef(fitWidth)
  fitWidthRef.current = fitWidth
  const effectiveEdgeCrop = edgeCropEditing ? undefined : edgeCrop
  const cropOptionsRef = useRef(effectiveEdgeCrop)
  cropOptionsRef.current = effectiveEdgeCrop
  const fitCroppedWidth = useCallback(() => {
    const viewer = viewerRef.current
    const container = containerRef.current
    if (!viewer || !container || !fitWidthRef.current) return
    const pageNumber = viewer.currentPageNumber
    const pageView = viewer.getPageView(pageNumber - 1)
    if (!pageView) return
    const viewport = pageView.viewport
    const crop = getPageCropGeometry(
      viewport,
      resolvePageEdgeCrop(cropOptionsRef.current, pageNumber)
    )
    // PDFViewer's page-width preset always measures the original full viewport.
    const nextScale = (container.clientWidth / crop.width) * viewer.currentScale
    if (nextScale > 0 && Math.abs(viewer.currentScale - nextScale) > 0.001)
      viewer.currentScaleValue = String(nextScale)
  }, [])

  const applyPageCrop = useCallback(() => {
    const viewer = viewerRef.current
    const element = viewerElementRef.current
    if (!viewer || !element) return
    const visible = new Set(visiblePagesRef.current)
    let widest = 0
    for (let pageNumber = 1; pageNumber <= viewer.pagesCount; pageNumber++) {
      const pageView = viewer.getPageView(pageNumber - 1)
      if (!pageView) continue
      const crop = getPageCropGeometry(
        pageView.viewport,
        resolvePageEdgeCrop(cropOptionsRef.current, pageNumber)
      )
      const { top, right, bottom, left } = crop
      // Keep the full page's coordinate origin and PDF.js-owned layers intact.
      // Flex margins remove exactly the clipped space without wrapping page.div
      // (PDF.js visibility/navigation read its offsetTop/offsetLeft directly).
      pageView.div.style.clipPath =
        top || right || bottom || left
          ? `inset(${top}px ${right}px ${bottom}px ${left}px)`
          : ''
      pageView.div.style.margin = `${-top}px ${-right}px ${10 - bottom}px ${-left}px`
      if (visible.has(pageNumber)) widest = Math.max(widest, crop.width)
    }
    element.style.minWidth = `${widest}px`
  }, [])
  const restoredPosition = useRef<ReaderBookmark | null>(null)
  const lastStablePosition = useRef<ReaderBookmark | null>(null)
  const pendingAnchor = useRef<{
    anchor: ReaderBookmark
    done: () => void
    fail: (error: Error) => void
    preserveOnFailure?: boolean
    awaitingLayout?: boolean
  } | null>(null)
  // Restore may wait for the target page (initial load/crop). That wait owns
  // navigation like any other request: a newer navigation, a source change or
  // unmount aborts it immediately instead of letting it replay later.
  const navigationGeneration = useRef(0)
  const restoreWait = useRef<{
    generation: number
    controller: AbortController
  } | null>(null)
  const cancelRestoreWait = useCallback(() => {
    navigationGeneration.current += 1
    const wait = restoreWait.current
    restoreWait.current = null
    wait?.controller.abort(
      new DOMException('PDF navigation superseded', 'AbortError')
    )
  }, [])
  const {
    restoreAfterLayout,
    cancelRestore: cancelLayoutRestore,
    isRestoring: isRestoringLayout
  } = usePdfLayoutAnchor({
    source,
    viewer: viewerRef,
    container: containerRef,
    element: viewerElementRef,
    document: documentRef,
    pages: visiblePagesRef,
    text: selectionContextsRef,
    navigation: pendingAnchor,
    crop: effectiveEdgeCrop,
    insets: props.readingInsets,
    onRestored: (pageNumber) => {
      restoredPosition.current = null
      restoredTextPosition.current = null
      callbacksRef.current.onPageChange?.(pageNumber)
    }
  })
  const scrollToCroppedPage = useCallback(
    (pageNumber: number) => {
      cancelRestoreWait()
      cancelLayoutRestore()
      restoredPosition.current = null
      restoredTextPosition.current = null
      pendingAnchor.current?.fail(
        new DOMException('PDF navigation superseded', 'AbortError')
      )
      pendingAnchor.current = null
      pendingPageRef.current = null
      const viewer = viewerRef.current
      if (!viewer) return
      if (!isPageViewActivatable(viewer.getPageView(pageNumber - 1))) {
        pendingPageRef.current = { pageNumber }
        return
      }
      if (
        !isPdfLayoutReady(
          containerRef.current,
          viewer.getPageView(pageNumber - 1)?.div
        )
      ) {
        const container = containerRef.current
        if (!container) {
          progressOptions.current.onError?.({
            kind: 'unknown',
            message: 'PDF 翻页容器尚未挂载，请重试'
          })
          return
        }
        const document = documentRef.current,
          source = progressOptions.current.source
        let stopLayout = () => {}
        let timer: ReturnType<typeof setTimeout>
        const finish = () => {
          stopLayout()
          clearTimeout(timer)
          if (pendingAnchor.current === pending) pendingAnchor.current = null
        }
        const pending = {
          anchor: { pageNumber, verticalPercentage: 0 },
          awaitingLayout: true,
          done: finish,
          fail: finish
        }
        const isCurrent = () =>
          pendingAnchor.current === pending &&
          viewerRef.current === viewer &&
          documentRef.current === document &&
          progressOptions.current.source === source &&
          containerRef.current === container &&
          visiblePagesRef.current.includes(pageNumber)
        pendingAnchor.current = pending
        timer = setTimeout(() => {
          const current = isCurrent()
          finish()
          if (current)
            progressOptions.current.onError?.({
              kind: 'unknown',
              message: 'PDF 翻页布局就绪超时（10 秒），请重试'
            })
        }, 10000)
        stopLayout = observePdfLayout(
          container,
          () => viewer.getPageView(pageNumber - 1)?.div,
          () => {
            if (!isCurrent()) {
              finish()
              return
            }
            if (!isPageViewActivatable(viewer.getPageView(pageNumber - 1)))
              return
            finish()
            viewer.scrollPageIntoView({ pageNumber }) // pdf-scroll-guard: observed attached positive layout
          }
        )
        return
      }
      viewer.scrollPageIntoView({ pageNumber }) // pdf-scroll-guard: isPageViewActivatable above, rejected pages pending
    },
    [cancelLayoutRestore, cancelRestoreWait]
  )
  // Layout captures at text-item granularity. Retain a restored Text character
  // while the viewport stays at that exact position, including a quick round trip.
  const restoredTextPosition = useRef<{
    anchor: ReaderTextAnchor
    top: number
    left: number
    scale: number
  } | null>(null)
  const viewportRect = () => {
    const container = containerRef.current
    if (!container) return null
    const box = container.getBoundingClientRect()
    const insets = progressOptions.current.readingInsets
    if (insets)
      return readingViewport(box, {
        topInset: container.clientTop + insets.top,
        bottomInset: insets.bottom,
        horizontalInset: container.clientLeft + insets.horizontal
      })
    const top =
      box.top +
      container.clientTop +
      (progressOptions.current.viewportTopInset ?? 0)
    const bottom =
      box.bottom - (progressOptions.current.viewportBottomInset ?? 0)
    return {
      left: box.left + container.clientLeft,
      right: box.right,
      top,
      bottom,
      width: box.width,
      height: bottom - top
    }
  }
  const pageRect = (pageNumber: number) => {
    const div = viewerRef.current?.getPageView(pageNumber - 1)?.div
    if (!div) return undefined
    const box = div.getBoundingClientRect()
    const crop = progressOptions.current.edgeCropEditing
      ? undefined
      : resolvePageEdgeCrop(progressOptions.current.edgeCrop, pageNumber)
    const top = box.top + box.height * (crop?.top ?? 0)
    const bottom = box.bottom - box.height * (crop?.bottom ?? 0)
    const left = box.left + box.width * (crop?.left ?? 0)
    const right = box.right - box.width * (crop?.right ?? 0)
    return {
      top,
      bottom,
      left,
      right,
      height: bottom - top,
      width: right - left
    }
  }
  const alignTop = (top: number, pageNumber: number, targetLeft?: number) => {
    const container = containerRef.current
    const viewport = viewportRect()
    const viewer = viewerRef.current
    const pageView = viewer?.getPageView(pageNumber - 1)
    if (container && viewport && viewer && pageView) {
      if (!isPageViewActivatable(pageView)) {
        pendingPageRef.current = {
          pageNumber,
          run: () => alignTop(top, pageNumber, targetLeft)
        }
        return
      }
      const box = pageView.div.getBoundingClientRect()
      const offset = top - box.top
      const left = container.scrollLeft
      const horizontalOffset =
        targetLeft === undefined ? left : targetLeft - box.left
      const [x, y] = pageView.viewport.convertToPdfPoint(
        horizontalOffset,
        offset
      )
      const destination: Parameters<typeof viewer.scrollPageIntoView>[0] = {
        pageNumber,
        destArray: [null, { name: 'XYZ' }, x, y, null],
        ignoreDestinationZoom: true,
        allowNegativeOffset: true
      }
      viewer.scrollPageIntoView(destination) // pdf-scroll-guard: guarded above
      // Text destinations use the character's position in the original page
      // frame, including after zoom/rotation. Ratio restores retain horizontal
      // scrolling; the cropped display frame still determines their vertical
      // projection. The browser clamps horizontal scrolling at page boundaries.
      container.scrollLeft =
        targetLeft === undefined
          ? left
          : Math.max(
              0,
              container.scrollLeft +
                pageView.div.getBoundingClientRect().left +
                horizontalOffset -
                viewport.left
            )
      container.scrollTop = Math.max(
        0,
        Math.min(
          container.scrollHeight - container.clientHeight,
          container.scrollTop +
            pageView.div.getBoundingClientRect().top +
            offset -
            viewport.top
        )
      )
    }
  }
  const restoreTextPosition = (
    anchor: ReaderTextAnchor,
    box: { top: number }
  ): boolean => {
    const context = selectionContextsRef.current.get(anchor.pageNumber)
    if (!context && !failedTextPages.current.has(anchor.pageNumber))
      return false
    const range =
      context && anchor.offset < context.canonical.text.length
        ? canonicalRangeToDomRange(
            context.canonical,
            anchor.offset,
            anchor.offset + 1,
            context.textLayerDiv
          )
        : null
    const rect =
      range &&
      Array.from(range.getClientRects()).find(
        (rect) => rect.width > 0 && rect.height > 0
      )
    if (!rect) {
      const pending = pendingAnchor.current
      if (
        context &&
        anchor.offset < context.canonical.text.length &&
        pending?.preserveOnFailure
      )
        return false
      restoredPosition.current = null
      if (pending?.preserveOnFailure) {
        pendingAnchor.current = null
        pending.fail(new Error('文字位置无法定位，原数据已保留'))
        return false
      }
      alignTop(box.top, anchor.pageNumber)
      progressOptions.current.onRestoreError?.(
        '无法精确恢复阅读位置，已显示原页；原进度已保留'
      )
    } else {
      alignTop(rect.top, anchor.pageNumber, rect.left)
      const container = containerRef.current
      if (container && viewerRef.current)
        restoredTextPosition.current = {
          anchor,
          top: container.scrollTop,
          left: container.scrollLeft,
          scale: viewerRef.current.currentScale
        }
    }
    return true
  }

  const restoreAnchor = () => {
    if (isRestoringLayout()) return
    const pending = pendingAnchor.current
    if (!pending) return
    const anchor = pending.anchor
    if (!visiblePagesRef.current.includes(anchor.pageNumber)) return
    if (
      pending.awaitingLayout ||
      !isPdfLayoutReady(
        containerRef.current,
        viewerRef.current?.getPageView(anchor.pageNumber - 1)?.div
      )
    )
      return
    const box = pageRect(anchor.pageNumber)
    if (!box || box.height <= 0) return
    if ('offset' in anchor) {
      if (!restoreTextPosition(anchor, box)) return
    } else
      alignTop(
        box.top + (box.height * anchor.verticalPercentage) / 100,
        anchor.pageNumber
      )
    pendingAnchor.current = null
    pending.done()
  }

  const restoreAnchorRef = useRef(restoreAnchor)
  restoreAnchorRef.current = restoreAnchor

  // text layer 增强（注入三件套 + 注册选区上下文）。幂等：可在
  // textlayerrendered 与 DOM 重组后重复调用。通过 ref 供 init effect 使用；
  // onResult 供观察器记录成功签名。
  const enhancePageTextLayerRef =
    useRef<
      (
        pageNumber: number,
        textLayerDiv: HTMLElement,
        onResult?: (matched: boolean) => void
      ) => void
    >(null)
  enhancePageTextLayerRef.current = (pageNumber, textLayerDiv, onResult) => {
    const viewer = viewerRef.current
    const document = documentRef.current
    if (!viewer) return
    // eslint-disable-next-line sonarjs/void-use -- text layer 增强为后台任务，无需等待
    void getCanonical(pageNumber)
      .then((canonical) => {
        if (
          !canonical ||
          viewerRef.current !== viewer ||
          documentRef.current !== document ||
          !textLayerDiv.isConnected
        )
          return
        const matched = enhanceTextLayer(textLayerDiv, canonical)
        failedTextPages.current.delete(pageNumber)
        onResult?.(matched)
        const pageView = viewer.getPageView(pageNumber - 1)
        const geometry = getPageGeometry(pageNumber)
        if (matched && pageView && geometry) {
          selectionContextsRef.current.set(pageNumber, {
            pageNumber,
            textLayerDiv: pageView.div,
            pageDiv: pageView.div,
            canonical: withOcr(canonical),
            viewport: geometry.viewport,
            scaleOneViewport: geometry.scaleOneViewport,
            visual: geometry.visual
          })
          restoreAnchorRef.current()
          callbacksRef.current.onTextLayerReady?.([
            ...selectionContextsRef.current.keys()
          ])
        } else if (!matched) {
          // 瞬态重组中不匹配：摘除上下文，等下一次 DOM 变化重试。
          selectionContextsRef.current.delete(pageNumber)
        }
        bumpGeometry()
      })
      .catch(() => {
        if (viewerRef.current !== viewer || documentRef.current !== document)
          return
        failedTextPages.current.add(pageNumber)
        restoreAnchor()
        bumpGeometry()
      })
  }

  // 与 IntermediateDocumentViewer 同一约定：未受控时使用静态默认控制面，
  // 变更被忽略（宿主不受控即不关心工具状态）。
  const resolvedPaintingSettings = useMemo<LayeredToolsSnapshot>(
    () =>
      paintingSettings ??
      createPaintingSettings(paintingTool, drawingStrokeColor),
    [drawingStrokeColor, paintingSettings, paintingTool]
  )

  // workerSrc 变化时更新全局 worker 配置。
  useEffect(() => {
    if (workerSrc) configurePdfJsWorker(workerSrc)
  }, [workerSrc])

  const bumpGeometry = useCallback(() => {
    setGeometryVersion((version) => version + 1)
  }, [])

  const getCanonical = useCallback(
    async (pageNumber: number): Promise<CanonicalPageText | null> => {
      const cached = canonicalCacheRef.current.get(pageNumber)
      if (cached) return cached
      const document = documentRef.current
      if (!document) return null
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent()
      if (documentRef.current !== document) return null
      const canonical = buildCanonicalPageText(
        pageNumber,
        textContent.items.filter((item): item is TextItem => 'str' in item)
      )
      canonicalCacheRef.current.set(pageNumber, canonical)
      return canonical
    },
    []
  )

  const getPageGeometry = useCallback(
    (
      pageNumber: number
    ):
      | (PdfPageOverlayGeometry & {
          viewport: PageViewport
          scaleOneViewport: PageViewport
        })
      | null => {
      const viewer = viewerRef.current
      if (!viewer) return null
      const pageView = viewer.getPageView(pageNumber - 1)
      const pdfPage = pageView?.pdfPage as
        | { getViewport: (options: { scale: number }) => PageViewport }
        | undefined
      if (!pageView || !pdfPage) return null
      const viewport = pageView.viewport as PageViewport
      const scaleOneViewport = pdfPage.getViewport({ scale: 1 })
      return {
        viewport,
        scaleOneViewport,
        drawing: createPageGeometry({
          width: scaleOneViewport.width,
          height: scaleOneViewport.height,
          referenceTransform: scaleOneViewport.transform as [
            number,
            number,
            number,
            number,
            number,
            number
          ],
          viewportTransform: viewport.transform as [
            number,
            number,
            number,
            number,
            number,
            number
          ]
        }),
        visual: {
          width: scaleOneViewport.width,
          height: scaleOneViewport.height
        }
      }
    },
    []
  )

  // 初始化官方 viewer 三件套（EventBus / PDFLinkService / PDFViewer）。
  // annotationEditorMode 固定 NONE：PDF 内置标注不进入编辑/存储通道，
  // 与 reader 高亮分属不同所有者（design.md 决策 4）。
  useEffect(() => {
    const container = containerRef.current
    const viewerElement = viewerElementRef.current
    if (!container || !viewerElement) return
    sessionManagerRef.current = new PdfSessionManager()
    if (workerSrc) configurePdfJsWorker(workerSrc)
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const viewer = new CroppedPdfViewer(
      {
        container,
        viewer: viewerElement,
        eventBus,
        linkService,
        // TextLayerMode.ENABLE
        textLayerMode: 1,
        annotationMode: AnnotationMode.ENABLE,
        annotationEditorMode: 0,
        removePageBorders: true
      },
      {
        crop: () => cropOptionsRef.current,
        pages: () => visiblePagesRef.current
      }
    )
    linkService.setViewer(viewer)
    viewerRef.current = viewer
    eventBusRef.current = eventBus
    linkServiceRef.current = linkService

    const handleTextLayerRendered = (event: TextLayerRenderedEvent) => {
      // PDF.js emits the PDFPageView, whose div also contains canvas and
      // annotation layers. Enhancing that div can delete a valid context.
      const layer = event.source.div.matches('.textLayer')
        ? event.source.div
        : event.source.div.querySelector<HTMLElement>('.textLayer')
      if (layer) enhancePageTextLayerRef.current?.(event.pageNumber, layer)
    }

    // pdf.js 5.x text layer 在 textlayerrendered 之后仍会重组 DOM（可能整体
    // 替换 .textLayer 节点）。对每个 page 的 textLayer 做幂等增强；用签名
    // （子节点数 + 文本长度）避免叠加层 portal 变化触发的观察回调死循环。
    const enhancedSignatures = new WeakMap<HTMLElement, string>()
    const textLayerObserver = new MutationObserver(() => {
      for (const [pageNumber, context] of selectionContextsRef.current) {
        if (!viewerElement.contains(context.textLayerDiv))
          selectionContextsRef.current.delete(pageNumber)
      }
      // pdf.js 5.4 在 l10n 完成后会移除 page div 的 data-page-number，
      // 页号改用 pageView div 身份比对（与 viewer 内部状态一致）。
      const pageNumberByDiv = new Map<HTMLElement, number>()
      for (let index = 0; index < viewer.pagesCount; index++) {
        const pageView = viewer.getPageView(index)
        if (pageView) pageNumberByDiv.set(pageView.div, index + 1)
      }
      for (const layer of viewerElement.querySelectorAll<HTMLElement>(
        '.page .textLayer'
      )) {
        const pageDiv = layer.closest('.page')
        const pageNumber =
          pageDiv instanceof HTMLElement
            ? (pageNumberByDiv.get(pageDiv) ?? 0)
            : 0
        if (pageNumber <= 0) continue
        const signature = `${layer.children.length}:${layer.textContent?.length ?? 0}`
        if (enhancedSignatures.get(layer) === signature) continue
        enhancePageTextLayerRef.current?.(pageNumber, layer, (matched) => {
          if (matched) enhancedSignatures.set(layer, signature)
          else enhancedSignatures.delete(layer)
        })
      }
    })
    textLayerObserver.observe(viewerElement, {
      childList: true,
      subtree: true,
      characterData: true
    })

    const handlePageChanging = (event: { pageNumber: number }) => {
      if (isRestoringLayout()) return
      const visible = visiblePagesRef.current
      if (visible.includes(event.pageNumber))
        callbacksRef.current.onPageChange?.(event.pageNumber)
      else if (visible.length)
        activatePage(
          visible.find((page) => page >= event.pageNumber) ?? visible.at(-1)!
        )
    }
    const handleScaleChanging = (event: { scale: number }) => {
      applyPageCrop()
      if (!isRestoringLayout())
        restoredPosition.current ??= lastStablePosition.current
      callbacksRef.current.onScaleChange?.(event.scale)
      // viewport 变化后叠加层按持久化坐标重投影。
      bumpGeometry()
    }
    const handlePagesLoaded = () => {
      callbacksRef.current.onPagesLoaded?.(viewer.pagesCount)
    }
    const handlePagesInit = () => {
      // pdf.js 默认 currentScaleValue='auto'（自适应宽度），且 setDocument
      // 内部在 pagesinit 之后还会按 _currentScaleValue 重设一次缩放；
      // 必须写 currentScaleValue 才能固定契约默认 scale=1（或受控值）。
      viewer.currentScaleValue = fitWidthRef.current
        ? 'page-width'
        : String(initialScaleRef.current)
      const pages = Array.from(
        { length: viewer.pagesCount },
        (_, index) => index + 1
      )
      const navigation = navigationOptionsRef.current
      visiblePagesRef.current = filterHiddenPages(
        getVisiblePageNumbers(pages, navigation.pageRange),
        navigation.hiddenPages
      )
      setOverlayPages(pages)
      fitCroppedWidth()
      applyPageCrop()
    }
    const handlePageRendered = (event: { pageNumber: number }) => {
      if (!visiblePagesRef.current.includes(event.pageNumber)) return
      const document = documentRef.current
      restoreAnchorRef.current()
      getCanonical(event.pageNumber)
        .then(() => {
          if (viewerRef.current !== viewer || documentRef.current !== document)
            return
          restoreAnchorRef.current()
          bumpGeometry()
        })
        .catch(() => {
          if (viewerRef.current !== viewer || documentRef.current !== document)
            return
          failedTextPages.current.add(event.pageNumber)
          restoreAnchorRef.current()
          bumpGeometry()
        })
      setRenderedPages((pages) =>
        pages.includes(event.pageNumber) ? pages : [...pages, event.pageNumber]
      )
      const pageView = viewer.getPageView(event.pageNumber - 1)
      if (pageView) {
        getCanonical(event.pageNumber)
          .then((canonical) => {
            if (canonical && canonical.text.trim() === '')
              enhancePageTextLayerRef.current?.(event.pageNumber, pageView.div)
          })
          .catch(() => undefined)
      }
      restoreAnchorRef.current()
      bumpGeometry()
    }
    const handleRotation = () => {
      restoredPosition.current ??= lastStablePosition.current
      bumpGeometry()
    }
    const resize = new ResizeObserver(() => {
      if (viewer.pagesCount) fitCroppedWidth()
      applyPageCrop()
      viewer.update()
    })
    resize.observe(container)

    eventBus.on('textlayerrendered', handleTextLayerRendered)
    eventBus.on('pagechanging', handlePageChanging)
    eventBus.on('scalechanging', handleScaleChanging)
    eventBus.on('pagesloaded', handlePagesLoaded)
    eventBus.on('pagesinit', handlePagesInit)
    eventBus.on('pagerendered', handlePageRendered)
    eventBus.on('rotationchanging', handleRotation)

    return () => {
      eventBus.off('textlayerrendered', handleTextLayerRendered)
      eventBus.off('pagechanging', handlePageChanging)
      eventBus.off('scalechanging', handleScaleChanging)
      eventBus.off('pagesloaded', handlePagesLoaded)
      eventBus.off('pagesinit', handlePagesInit)
      eventBus.off('pagerendered', handlePageRendered)
      eventBus.off('rotationchanging', handleRotation)
      textLayerObserver.disconnect()
      resize.disconnect()
      pendingAnchor.current?.done()
      pendingAnchor.current = null
      setViewerDocument(viewer, null)
      viewerRef.current = null
      eventBusRef.current = null
      linkServiceRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!isRestoringLayout()) cancelLayoutRestore()
  }, [fitWidth, cancelLayoutRestore, isRestoringLayout])

  useLayoutEffect(() => {
    if (viewerRef.current?.pagesCount) fitCroppedWidth()
  }, [fitWidth, effectiveEdgeCrop, fitCroppedWidth])

  // 打开/切换文档：PdfSessionManager 保证旧加载结果不更新后续文档。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    restoredPosition.current = null
    lastStablePosition.current = null
    restoredTextPosition.current = null
    pendingAnchor.current?.fail(
      new DOMException('PDF navigation cancelled', 'AbortError')
    )
    pendingAnchor.current = null
    if (!source) {
      setOcrDocument(null)
      setRenderedPages([])
      props.onDocumentReady?.(null)
      documentRef.current = null
      failedTextPages.current.clear()
      canonicalCacheRef.current.clear()
      selectionContextsRef.current.clear()
      setViewerDocument(viewer, null)
      if (linkServiceRef.current) {
        setViewerDocument(linkServiceRef.current, null)
      }
      // eslint-disable-next-line sonarjs/void-use -- 卸载路径的释放无需等待
      void sessionManagerRef.current.close()
      setStatus('idle')
      return
    }

    let cancelled = false
    let removeSourceLinks: (() => void) | undefined
    props.onDocumentReady?.(null)
    setStatus('loading')
    setOcrDocument(null)
    setRenderedPages([])
    failedTextPages.current.clear()
    canonicalCacheRef.current.clear()
    selectionContextsRef.current.clear()

    sessionManagerRef.current
      .open(source, {
        documentOptions,
        onProgress: onLoadingProgress
      })
      .then(({ session }) => {
        if (cancelled) return
        documentRef.current = session.document
        props.onDocumentReady?.(session.document)
        setOcrDocument(session.document)
        setStatus('ready')
        viewerRef.current?.setDocument(session.document)
        linkServiceRef.current?.setDocument(session.document)
        if (containerRef.current && linkServiceRef.current) {
          removeSourceLinks = bindPdfSourceLinks(
            containerRef.current,
            session.document,
            linkServiceRef.current
          )
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const kind =
          error instanceof Error && 'kind' in error
            ? (Reflect.get(error, 'kind') as PdfOpenErrorKind)
            : 'unknown'
        // 取消不算错误（切换文档的正常路径），静默忽略。
        if (kind === 'cancelled') return
        setStatus('error')
        onError?.({
          kind,
          message: error instanceof Error ? error.message : String(error)
        })
      })

    return () => {
      cancelled = true
      cancelRestoreWait()
      removeSourceLinks?.()
    }
  }, [source, cancelRestoreWait])

  // 卸载/切文件：取消加载、销毁 worker、清空页面（tasks.md 3.5）。
  useEffect(() => {
    const manager = sessionManagerRef.current
    return () => {
      cancelRestoreWait()
      pendingAnchor.current?.fail(
        new DOMException('PDF navigation cancelled', 'AbortError')
      )
      pendingAnchor.current = null
      props.onDocumentReady?.(null)
      documentRef.current = null
      failedTextPages.current.clear()
      canonicalCacheRef.current.clear()
      selectionContextsRef.current.clear()
      const viewer = viewerRef.current
      if (viewer) setViewerDocument(viewer, null)
      const disposal = manager.dispose()
      props.onDisposal?.(disposal)
      disposal.catch(() => undefined)
    }
  }, [])

  // 受控 scale。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || scale === undefined) return
    if (Math.abs(viewer.currentScale - scale) > 0.001) {
      if (!isRestoringLayout()) cancelLayoutRestore()
      viewer.currentScale = scale
    }
  }, [scale, geometryVersion, cancelLayoutRestore, isRestoringLayout])

  // 受控页码。
  useEffect(() => {
    const viewer = viewerRef.current
    if (
      !viewer ||
      currentPageNumber === undefined ||
      !visiblePagesRef.current.includes(currentPageNumber)
    )
      return
    if (viewer.currentPageNumber !== currentPageNumber) {
      scrollToCroppedPage(currentPageNumber)
    }
  }, [
    currentPageNumber,
    geometryVersion,
    pageRange,
    overlayPages,
    hiddenPages,
    edgeCropEditing,
    scrollToCroppedPage
  ])

  // 隐藏页及范围外页始终退出布局；编辑态只增加独立段入口。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const hidden = normalizeHiddenPageNumbers(hiddenPages)
    Array.from({ length: viewer.pagesCount }, (_, index) => index + 1).forEach(
      (pageNumber) => {
        const pageView = viewer.getPageView(pageNumber - 1)
        if (!pageView) return
        const isHidden = hidden.has(pageNumber)
        const inRange = allowedPages.includes(pageNumber)
        if ((!inRange || isHidden) && pageView.div.childElementCount > 0)
          pageView.reset()
        pageView.div.style.display = !inRange || isHidden ? 'none' : ''
        delete pageView.div.dataset.readerHidden
      }
    )
    const visible = visiblePagesRef.current
    if (
      restoredPosition.current &&
      !visible.includes(restoredPosition.current.pageNumber)
    ) {
      restoredPosition.current = null
      restoredTextPosition.current = null
    }
    if (
      pendingAnchor.current &&
      !visible.includes(pendingAnchor.current.anchor.pageNumber)
    ) {
      pendingAnchor.current.done()
      pendingAnchor.current = null
    }
    if (visible.length && !visible.includes(viewer.currentPageNumber)) {
      const next =
        visible.find((page) => page >= viewer.currentPageNumber) ??
        visible.at(-1)!
      if (activatePage(next)) {
        scrollIntoViewIfAttached(viewer.getPageView(next - 1)?.div, {
          block: 'start'
        })
      }
    }
    retryPendingPage()
    selectionContextsRef.current.forEach((_, page) => {
      if (!visible.includes(page)) selectionContextsRef.current.delete(page)
    })
    // pagesinit and React's visibility commit can precede the first render.
    // A page-ratio restore must retry once the displayed page box exists.
    if (
      !isRestoringLayout() &&
      !pendingAnchor.current &&
      restoredPosition.current
    )
      pendingAnchor.current = {
        anchor: restoredPosition.current,
        done: () => undefined,
        fail: () => undefined
      }
    restoreAnchorRef.current()
    viewer.update()
  }, [
    hiddenPages,
    pageRange,
    edgeCrop,
    edgeCropEditing,
    geometryVersion,
    status,
    overlayPages
  ])

  useEffect(() => {
    let cancelled = false
    for (const pageNumber of ocrTexts.keys()) {
      getCanonical(pageNumber)
        .then((canonical) => {
          const pageView = viewerRef.current?.getPageView(pageNumber - 1)
          const geometry = getPageGeometry(pageNumber)
          if (cancelled || !canonical || !pageView || !geometry) return
          selectionContextsRef.current.set(pageNumber, {
            pageNumber,
            pageDiv: pageView.div,
            textLayerDiv: pageView.div,
            canonical: withOcr(canonical),
            ...geometry
          })
          callbacksRef.current.onTextLayerReady?.([
            ...selectionContextsRef.current.keys()
          ])
          bumpGeometry()
        })
        .catch((error: unknown) => {
          if (!cancelled)
            callbacksRef.current.onOcrError?.(error, { pageNumber })
        })
    }
    for (const [pageNumber, context] of selectionContextsRef.current) {
      const canonical = canonicalCacheRef.current.get(pageNumber)
      if (canonical)
        selectionContextsRef.current.set(pageNumber, {
          ...context,
          canonical: withOcr(canonical)
        })
    }
    return () => {
      cancelled = true
    }
  }, [ocrTexts])

  // Clip and layout must change together, including unrendered page shells.
  useLayoutEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    applyPageCrop()
    const stable = lastStablePosition.current
    if (isRestoringLayout() && stable && !('offset' in stable)) {
      // Blank/scanned pages use the persisted ratio in the displayed crop box.
      // Keep main's close/rotation reprojection contract for those positions.
      cancelLayoutRestore()
      restoredPosition.current = stable
      pendingAnchor.current = {
        anchor: stable,
        done: () => undefined,
        fail: () => undefined
      }
      restoreAnchorRef.current()
    } else restoreAfterLayout()
    viewer.update()
  }, [
    effectiveEdgeCrop,
    geometryVersion,
    status,
    overlayPages,
    pageRange,
    hiddenPages,
    applyPageCrop,
    restoreAfterLayout,
    cancelLayoutRestore,
    isRestoringLayout,
    props.readingInsets?.top,
    props.readingInsets?.bottom,
    props.readingInsets?.horizontal
  ])

  useEffect(() => {
    restoreAnchorRef.current()
  }, [geometryVersion, props.readingInsets])

  const groupPreview = useRef<ReaderSelectionRange[] | null>(null)
  const [previewVersion, setPreviewVersion] = useState(0)
  const rangeFromEndpoints = (
    stored: Pick<ReaderSelectionRange, 'start' | 'end'>
  ): Range | null => {
    const first = selectionContextsRef.current.get(
      Number(stored.start.selectionId.slice(5))
    )
    const last = selectionContextsRef.current.get(
      Number(stored.end.selectionId.slice(5))
    )
    if (!first || !last) return null
    const start = canonicalRangeToDomRange(
      first.canonical,
      stored.start.offset,
      first.canonical.text.length,
      first.textLayerDiv
    )
    const end = canonicalRangeToDomRange(
      last.canonical,
      0,
      stored.end.offset,
      last.textLayerDiv
    )
    if (!start || !end) return null
    start.setEnd(end.endContainer, end.endOffset)
    return start
  }
  const serializeEndpoint = (
    stored: ReaderSelectionRange,
    candidate: Range,
    end: boolean
  ) => {
    const range = rangeFromEndpoints(stored)
    if (!range) return null
    const anchor = range.cloneRange()
    anchor.collapse(end)
    const crossed = end
      ? candidate.compareBoundaryPoints(Range.END_TO_END, anchor) <= 0
      : candidate.compareBoundaryPoints(Range.START_TO_START, anchor) >= 0
    if (crossed) {
      range.setStart(candidate.startContainer, candidate.startOffset)
      range.setEnd(candidate.endContainer, candidate.endOffset)
    } else if (end) range.setEnd(candidate.endContainer, candidate.endOffset)
    else range.setStart(candidate.startContainer, candidate.startOffset)
    return serializePdfTextSelection(
      range,
      selectionContextsRef.current,
      stored.overlayRectType ?? overlayRectType
    )
  }
  const touchSelection = usePdfTouchSelection({
    rootRef: containerRef,
    source,
    enabled: tool === 'text-selection' && !edgeCropEditing,
    validate: (range) =>
      Boolean(
        serializePdfTextSelection(
          range,
          selectionContextsRef.current,
          overlayRectType
        )?.text
      ),
    onChange: () => {
      restoredSelectionGroup.current = null
      groupPreview.current = null
      const range = touchSelection.managed.current
      const detail = range
        ? serializePdfTextSelection(
            range,
            selectionContextsRef.current,
            overlayRectType
          )
        : null
      onTextSelectionChange?.(detail?.text ?? '', detail)
    }
  })
  const currentRange = () => {
    const selection = containerRef.current?.ownerDocument.getSelection()
    return (
      touchSelection.managed.current ??
      (selection?.rangeCount ? selection.getRangeAt(0) : null)
    )
  }

  const restoredSelectionGroup = useRef<{
    native: Range
    members: ReaderSelectionRange[]
  } | null>(null)
  const serializeCurrentSelection =
    useCallback((): SerializedPdfSelection | null => {
      const view = containerRef.current?.ownerDocument.defaultView
      const selection = view?.getSelection?.() ?? null
      if (!selection && !touchSelection.managed.current) return null
      const restored = restoredSelectionGroup.current
      const native = currentRange()
      if (
        restored &&
        native &&
        (Boolean(touchSelection.managed.current) ||
          (native.startContainer === restored.native.startContainer &&
            native.startOffset === restored.native.startOffset &&
            native.endContainer === restored.native.endContainer &&
            native.endOffset === restored.native.endOffset))
      ) {
        const members = groupPreview.current ?? restored.members
        const rectsBySelectionId: ReaderSelectionRange['rectsBySelectionId'] =
          {}
        for (const member of members) {
          for (const [pageId, rects] of Object.entries(
            member.rectsBySelectionId
          )) {
            const pageRects = rectsBySelectionId[pageId] ?? []
            rectsBySelectionId[pageId] = [...pageRects, ...rects]
          }
        }
        return {
          start: members[0]!.start,
          end: members.at(-1)!.end,
          text: members.map((member) => member.text).join(''),
          sourceRanges: members.map(({ start, end }) => ({ start, end })),
          rectsBySelectionId
        }
      }
      restoredSelectionGroup.current = null
      return serializePdfTextSelection(
        touchSelection.managed.current ?? selection!,
        selectionContextsRef.current,
        overlayRectType
      )
    }, [overlayRectType])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const doc = container.ownerDocument
    const editingOrExternalSelection = () =>
      Boolean(
        doc.activeElement?.closest('input, textarea, [contenteditable]') ||
        (touchSelection.managed.current && doc.getSelection()?.rangeCount)
      )
    const copy = (event: ClipboardEvent) => {
      if (editingOrExternalSelection()) return
      const detail = serializeCurrentSelection()
      if (!detail || !event.clipboardData) return
      if (!touchSelection.managed.current && !detail.sourceRanges) return
      event.clipboardData.setData('text/plain', detail.text)
      event.preventDefault()
    }
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'c' ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        !touchSelection.managed.current ||
        editingOrExternalSelection()
      )
        return
      // Some browsers skip their default copy event when native Selection is
      // empty. Trigger the clipboard event in this user gesture; its handler
      // supplies managed text without ever selecting the visible PDF DOM.
      if (doc.execCommand?.('copy')) event.preventDefault()
    }
    doc.addEventListener('copy', copy)
    doc.addEventListener('keydown', keydown)
    return () => {
      doc.removeEventListener('copy', copy)
      doc.removeEventListener('keydown', keydown)
    }
  }, [serializeCurrentSelection])

  // 选区变化 → onTextSelectionChange（text + 公开端点 detail）。
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onTextSelectionChange) return
    const ownerDocument = container.ownerDocument

    let scheduled = false
    const emitSelection = () => {
      scheduled = false
      if (touchSelection.managed.current) return
      const selection = ownerDocument.getSelection()
      if (!selection || selection.isCollapsed) {
        onTextSelectionChange('', null)
        return
      }
      const detail = serializePdfTextSelection(
        selection,
        selectionContextsRef.current,
        overlayRectType
      )
      onTextSelectionChange(detail?.text ?? '', detail)
    }
    const scheduleEmit = () => {
      if (scheduled) return
      scheduled = true
      setTimeout(emitSelection, 0)
    }

    ownerDocument.addEventListener('selectionchange', scheduleEmit)
    return () =>
      ownerDocument.removeEventListener('selectionchange', scheduleEmit)
  }, [onTextSelectionChange, overlayRectType])

  const captureReadingPosition = useCallback((): ReadingPosition => {
    const viewer = viewerRef.current
    const viewport = viewportRect()
    if (
      !viewer ||
      !viewport ||
      viewport.height <= 0 ||
      viewport.width <= 0 ||
      pendingAnchor.current ||
      isRestoringLayout()
    )
      return { status: 'pending' }
    const pages = visiblePagesRef.current.flatMap((pageNumber) => {
      const rect = pageRect(pageNumber)
      return rect && intersects(rect, viewport) ? [{ pageNumber, rect }] : []
    })
    if (!pages.length) return { status: 'pending' }
    const target =
      pages.find(
        ({ rect }) => rect.top <= viewport.top && rect.bottom > viewport.top
      ) ?? pages[0]
    const verticalPercentage = pagePercentage(viewport.top, target.rect)
    if (verticalPercentage === undefined) return { status: 'pending' }
    const position = { pageNumber: target.pageNumber, verticalPercentage }
    lastStablePosition.current = position
    return { status: 'ready', position }
  }, [])

  // Mode handoff needs text readiness independently of geometric persistence.
  const captureModeSwitchPosition = useCallback((): ReadingPosition => {
    const viewer = viewerRef.current
    const viewport = viewportRect()
    if (
      !viewer ||
      !viewport ||
      viewport.height <= 0 ||
      viewport.width <= 0 ||
      pendingAnchor.current ||
      isRestoringLayout()
    )
      return { status: 'pending' }
    const restored = restoredTextPosition.current
    const container = containerRef.current
    if (
      restored &&
      restored.top === container?.scrollTop &&
      restored.left === container.scrollLeft &&
      restored.scale === viewerRef.current?.currentScale
    )
      return { status: 'ready', position: restored.anchor }
    restoredTextPosition.current = null
    const pages = visiblePagesRef.current.flatMap((pageNumber) => {
      const rect = pageRect(pageNumber)
      return rect && intersects(rect, viewport) ? [{ pageNumber, rect }] : []
    })
    if (!pages.length) return { status: 'pending' }
    let first: { anchor: ReaderTextAnchor; top: number } | undefined
    for (const { pageNumber, rect } of pages) {
      // A lower page that has not rendered cannot precede this known first line.
      if (first && rect.top >= first.top) break
      const clip = {
        left: Math.max(viewport.left, rect.left),
        right: Math.min(viewport.right, rect.right),
        top: Math.max(viewport.top, rect.top),
        bottom: Math.min(viewport.bottom, rect.bottom),
        width:
          Math.min(viewport.right, rect.right) -
          Math.max(viewport.left, rect.left),
        height:
          Math.min(viewport.bottom, rect.bottom) -
          Math.max(viewport.top, rect.top)
      }
      const text = capturePageText(
        selectionContextsRef.current.get(pageNumber),
        canonicalCacheRef.current.get(pageNumber),
        failedTextPages.current.has(pageNumber),
        clip
      )
      if (text.status !== 'ready') return { status: text.status }
      const character = text.character
      if (character && (!first || character.top < first.top - 1))
        first = character
    }
    if (first) return { status: 'ready', position: first.anchor }
    return captureReadingPosition()
  }, [captureReadingPosition])
  const captureTextAnchor = useCallback((): ReaderTextAnchor | null => {
    const pending = pendingAnchor.current?.anchor
    if (pending && 'offset' in pending) return pending
    const result = captureModeSwitchPosition()
    return result.status === 'ready' && 'offset' in result.position
      ? result.position
      : null
  }, [captureModeSwitchPosition])
  /**
   * Public anchor navigation waits for attached positive layout before touching
   * PDF.js. Requests resolve after the destination rectangle is
   * applied (not after canvas rendering) and reject on timeout/supersession.
   */
  const beginNavigation = (
    anchor: ReaderBookmark,
    options: { preserveOnFailure?: boolean } | undefined,
    originalDocument: typeof documentRef.current
  ): Promise<void> => {
    pendingAnchor.current?.fail(
      new DOMException('PDF navigation superseded', 'AbortError')
    )
    restoredPosition.current = anchor
    restoredTextPosition.current = null
    const original = {
      top: containerRef.current?.scrollTop ?? 0,
      left: containerRef.current?.scrollLeft ?? 0
    }
    let stopLayout = () => {}
    const promise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stopLayout()
        const awaitingLayout =
          pendingAnchor.current?.anchor === anchor &&
          pendingAnchor.current.awaitingLayout
        if (pendingAnchor.current?.anchor === anchor)
          pendingAnchor.current = null
        if (documentRef.current === originalDocument && containerRef.current) {
          containerRef.current.scrollTop = original.top
          containerRef.current.scrollLeft = original.left
        }
        restoredPosition.current = null
        const error = new Error(
          awaitingLayout
            ? 'PDF 布局就绪超时（10 秒），原位置已保留'
            : 'PDF 定位超时，请重试'
        )
        if (awaitingLayout) error.name = 'PdfLayoutNotReadyError'
        reject(error)
      }, 10000)
      pendingAnchor.current = {
        anchor,
        preserveOnFailure: options?.preserveOnFailure,
        awaitingLayout: true,
        done: () => {
          stopLayout()
          clearTimeout(timeout)
          resolve()
        },
        fail: (error) => {
          stopLayout()
          clearTimeout(timeout)
          restoredPosition.current = null
          if (
            documentRef.current === originalDocument &&
            containerRef.current
          ) {
            containerRef.current.scrollTop = original.top
            containerRef.current.scrollLeft = original.left
          }
          reject(error)
        }
      }
    })
    const activeViewer = viewerRef.current
    if (!activeViewer || documentRef.current !== originalDocument) {
      pendingAnchor.current?.fail(
        new DOMException('PDF navigation superseded', 'AbortError')
      )
      pendingAnchor.current = null
      return Promise.reject(
        new DOMException('PDF navigation superseded', 'AbortError')
      )
    }
    const container = containerRef.current
    if (
      isPdfLayoutReady(
        container,
        activeViewer.getPageView(anchor.pageNumber - 1)?.div
      )
    ) {
      if (pendingAnchor.current?.anchor === anchor)
        pendingAnchor.current.awaitingLayout = false
      activeViewer.scrollPageIntoView({ pageNumber: anchor.pageNumber }) // pdf-scroll-guard: attached positive layout
      restoreAnchor()
      return promise
    }
    if (container)
      stopLayout = observePdfLayout(
        container,
        () => activeViewer.getPageView(anchor.pageNumber - 1)?.div,
        () => {
          const pending = pendingAnchor.current
          if (
            pending?.anchor !== anchor ||
            viewerRef.current !== activeViewer ||
            documentRef.current !== originalDocument
          )
            return
          if (pending.awaitingLayout) {
            pending.awaitingLayout = false
            activeViewer.scrollPageIntoView({ pageNumber: anchor.pageNumber }) // pdf-scroll-guard: observed attached positive layout
          }
          restoreAnchorRef.current()
        }
      )
    return promise
  }

  const navigateToAnchor = (
    stored: ReaderBookmark,
    options: { preserveOnFailure?: boolean } | undefined,
    waitForPage: boolean
  ): Promise<void> => {
    cancelLayoutRestore()
    cancelRestoreWait()
    const generation = navigationGeneration.current
    const anchor = normalizeBookmark(stored)
    if (!anchor) {
      progressOptions.current.onRestoreError?.(
        '无法精确恢复阅读位置，原进度已保留'
      )
      return Promise.resolve()
    }
    const originalDocument = documentRef.current
    const targetReady = () => {
      const viewer = viewerRef.current
      return (
        documentRef.current === originalDocument &&
        !!viewer &&
        visiblePagesRef.current.includes(anchor.pageNumber) &&
        !!viewer.getPageView(anchor.pageNumber - 1)
      )
    }
    if (!waitForPage) {
      if (!targetReady())
        return Promise.reject(new Error('目标页面不可用，原位置已保留'))
      return beginNavigation(anchor, options, originalDocument)
    }
    // A deleted page never becomes activatable; fail fast so the restore
    // fallback can land on the nearest existing page.
    const initialViewer = viewerRef.current
    if (initialViewer && anchor.pageNumber > initialViewer.pagesCount)
      return Promise.reject(new Error('目标页面不可用，原位置已保留'))
    // Restore runs before pagesinit/crop settles; wait for the real page
    // view instead of treating "not visible yet" as unavailable. The wait is
    // owned by this navigation generation, so a newer request aborts it.
    const controller = new AbortController()
    restoreWait.current = { generation, controller }
    const finishWait = () => {
      if (restoreWait.current?.controller === controller)
        restoreWait.current = null
    }
    return waitForPageActivation(targetReady, {
      timeoutMs: 10000,
      signal: controller.signal
    }).then(
      () => {
        finishWait()
        if (
          generation !== navigationGeneration.current ||
          controller.signal.aborted
        )
          throw new DOMException('PDF navigation superseded', 'AbortError')
        return beginNavigation(anchor, options, originalDocument)
      },
      (error) => {
        finishWait()
        throw error
      }
    )
  }

  const scrollToAnchor = (
    stored: ReaderBookmark,
    options?: { preserveOnFailure?: boolean }
  ): Promise<void> => navigateToAnchor(stored, options, false)

  const scrollToAnchorForRestore = (
    stored: ReaderBookmark,
    options?: { preserveOnFailure?: boolean }
  ): Promise<void> => navigateToAnchor(stored, options, true)

  useEffect(() => {
    const eventBus = eventBusRef.current
    if (!eventBus) return
    const emit = () => {
      if (isRestoringLayout()) return
      // PDF.js can finish its own scroll/scale adjustment after pagerendered.
      // Keep the restored source position until the first reader interaction.
      if (!pendingAnchor.current && restoredPosition.current)
        pendingAnchor.current = {
          anchor: restoredPosition.current,
          done: () => undefined,
          fail: () => undefined
        }
      restoreAnchorRef.current()
      if (restoredPosition.current) return
      onTextAnchorChange?.(captureTextAnchor())
      progressOptions.current.onReadingPositionChange?.(
        captureReadingPosition()
      )
    }
    const container = containerRef.current
    const releaseRestore = () => {
      restoredPosition.current = null
    }
    const inputEvents = ['pointerdown', 'wheel', 'keydown'] as const
    for (const event of inputEvents)
      container?.addEventListener(event, releaseRestore, {
        capture: true,
        passive: true
      })
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(emit)
    }
    container?.addEventListener('scroll', onScroll)
    eventBus.on('pagechanging', onScroll)
    onScroll()
    return () => {
      eventBus.off('pagechanging', onScroll)
      container?.removeEventListener('scroll', onScroll)
      for (const event of inputEvents)
        container?.removeEventListener(event, releaseRestore, true)
      cancelAnimationFrame(frame)
    }
  }, [
    onTextAnchorChange,
    captureTextAnchor,
    captureReadingPosition,
    status,
    geometryVersion
  ])

  useImperativeHandle(
    ref,
    () => ({
      releasePreviewPage: (document, page) => {
        if (document !== documentRef.current) return
        eventBusRef.current?.dispatch('thumbnailrendered', {
          source: viewerRef.current,
          pageNumber: page.pageNumber,
          pdfPage: page
        })
      },
      scrollToPage: (pageNumber) => {
        const viewer = viewerRef.current
        if (!viewer || !visiblePagesRef.current.includes(pageNumber)) return
        restoredPosition.current = null
        restoredTextPosition.current = null
        pendingAnchor.current?.done()
        pendingAnchor.current = null
        scrollToCroppedPage(pageNumber)
      },
      setScale: (nextScale) => {
        cancelLayoutRestore()
        restoredPosition.current = null
        restoredTextPosition.current = null
        pendingAnchor.current?.done()
        pendingAnchor.current = null
        const viewer = viewerRef.current
        if (viewer) {
          viewer.currentScale = nextScale
          restoredPosition.current = null
          restoredTextPosition.current = null
        }
      },
      captureTextAnchor,
      captureReadingPosition,
      captureModeSwitchPosition,
      isRendering: () => {
        const viewer = viewerRef.current
        return (
          isRestoringLayout() ||
          viewer?.getPageView(viewer.currentPageNumber - 1)?.renderingState ===
            1
        )
      },
      scrollToAnchor,
      scrollToAnchorForRestore,
      scrollToRange: (rangeId) => {
        restoredPosition.current = null
        restoredTextPosition.current = null
        const range = ranges.find((candidate) => candidate.id === rangeId)
        if (!range) return
        const pageNumber = Number(range.start.selectionId.slice(5))
        scrollToAnchor(
          {
            pageNumber,
            offset: range.start.offset,
            textId: '',
            text: range.text
          },
          { preserveOnFailure: true }
        ).catch((error: Error) => {
          if (error.name !== 'AbortError')
            props.onError?.({ kind: 'unknown', message: error.message })
        })
      },
      getCanonicalPageText: (pageNumber) =>
        selectionContextsRef.current.get(pageNumber)?.canonical.text ??
        canonicalCacheRef.current.get(pageNumber)?.text,
      confirmSelection: () => {
        const detail = serializeCurrentSelection()
        if (!detail || !onHighlight) return
        onHighlight({
          id: nextHighlightId(),
          text: detail.text,
          start: detail.start,
          end: detail.end,
          createdAt: Date.now(),
          overlayRectType,
          rectsBySelectionId: { ...detail.rectsBySelectionId }
        })
      },
      clearSelection: () => {
        touchSelection.setRange(null)
        groupPreview.current = null
        setPreviewVersion((value) => value + 1)
        restoredSelectionGroup.current = null
        containerRef.current?.ownerDocument.defaultView
          ?.getSelection()
          ?.removeAllRanges()
      },
      getSelectionRange: currentRange,
      serializeRangeEndpoint: (id, range, end) => {
        const stored = ranges.find((item) => item.id === id)
        return stored ? serializeEndpoint(stored, range, end) : null
      },
      setSelectionRange: (range, touch) => {
        if (touch) touchSelection.activate()
        const restored = restoredSelectionGroup.current
        if (
          restored &&
          range &&
          containerRef.current?.dataset.pdfTouchSelection
        ) {
          const changedStart =
            range.compareBoundaryPoints(
              Range.START_TO_START,
              restored.native
            ) !== 0
          const changedEnd =
            range.compareBoundaryPoints(Range.END_TO_END, restored.native) !== 0
          const oldEnd = restored.native.cloneRange()
          oldEnd.collapse(false)
          const movedEnd =
            changedEnd &&
            range.compareBoundaryPoints(Range.START_TO_START, oldEnd) < 0
          const member = movedEnd
            ? restored.members.at(-1)!
            : restored.members[0]!
          const detail =
            changedStart || changedEnd
              ? serializeEndpoint(member, range, movedEnd)
              : null
          groupPreview.current = detail
            ? restored.members.map((item) =>
                item.id === member.id
                  ? {
                      ...item,
                      ...detail,
                      rectsBySelectionId: { ...detail.rectsBySelectionId }
                    }
                  : item
              )
            : null
          setPreviewVersion((value) => value + 1)
        }
        if (containerRef.current?.dataset.pdfTouchSelection)
          touchSelection.setRange(range)
        else {
          const selection = containerRef.current?.ownerDocument.getSelection()
          selection?.removeAllRanges()
          if (range) selection?.addRange(range)
        }
      },
      hitTestSelection: (x, y) => {
        const root = containerRef.current
        if (!root) return null
        const caret = pdfCaretAtPoint(root, x, y, true)
        if (!caret) return null
        // Validate the caret through the same canonical mapping as persistence.
        const probe = caret.cloneRange()
        const length = probe.startContainer.textContent?.length ?? 0
        if (!length) return null
        probe.setStart(
          caret.startContainer,
          Math.min(caret.startOffset, length - 1)
        )
        probe.setEnd(
          caret.startContainer,
          Math.min(caret.startOffset + 1, length)
        )
        return serializePdfTextSelection(
          probe,
          selectionContextsRef.current,
          overlayRectType
        )
          ? caret
          : null
      },
      serializeSelection: serializeCurrentSelection,
      selectRange: (id) => {
        restoredSelectionGroup.current = null
        groupPreview.current = null
        const members = getSelectionGroup(ranges, id)
        const stored = members[0]
        if (!stored) return null
        const first = selectionContextsRef.current.get(
          Number(stored.start.selectionId.slice(5))
        )
        const last = selectionContextsRef.current.get(
          Number(stored.end.selectionId.slice(5))
        )
        if (!first || !last) return null
        const start = canonicalRangeToDomRange(
          first.canonical,
          stored.start.offset,
          first.canonical.text.length,
          first.textLayerDiv
        )
        const end = canonicalRangeToDomRange(
          last.canonical,
          0,
          stored.end.offset,
          last.textLayerDiv
        )
        if (!start || !end) return null
        start.setEnd(end.endContainer, end.endOffset)
        if (
          containerRef.current?.dataset.pdfTouchSelection &&
          members.length > 1
        ) {
          const final = rangeFromEndpoints(members.at(-1)!)
          if (final) start.setEnd(final.endContainer, final.endOffset)
        }
        const selection = first.textLayerDiv.ownerDocument.getSelection()
        selection?.removeAllRanges()
        if (containerRef.current?.dataset.pdfTouchSelection)
          touchSelection.setRange(start)
        else selection?.addRange(start)
        if (members.length > 1)
          restoredSelectionGroup.current = {
            native: start.cloneRange(),
            members
          }
        return start
      }
    }),
    [
      captureTextAnchor,
      ranges,
      overlayRectType,
      onHighlight,
      serializeCurrentSelection,
      props.readingInsets,
      effectiveEdgeCrop,
      scrollToCroppedPage,
      cancelLayoutRestore,
      isRestoringLayout,
      touchSelection.touch
    ]
  )

  const overlayElements = useMemo(() => {
    // 不用 status 门控：open 失败（error）时旧文档与已渲染标注必须保持。
    if (overlayPages.length === 0) return null
    const viewer = viewerRef.current
    if (!viewer) return null

    const previews = new Map(
      groupPreview.current?.map((range) => [range.id, range])
    )
    const overlayRanges = ranges.map((range) => previews.get(range.id) ?? range)
    const hidden = normalizeHiddenPageNumbers(hiddenPages)
    return overlayPages.flatMap((pageNumber) => {
      if (!allowedPages.includes(pageNumber) || hidden.has(pageNumber))
        return []
      const pageView = viewer.getPageView(pageNumber - 1)
      if (!pageView) return []
      const geometry = getPageGeometry(pageNumber)
      if (!geometry) return []
      const pageId = `page-${pageNumber}`
      return [
        <PdfOverlayPortal key={pageId} pageDiv={pageView.div}>
          {ocrTexts.has(pageNumber) && (
            <PdfOcrTextLayer
              texts={ocrTexts.get(pageNumber)!}
              pageNumber={pageNumber}
              offset={
                canonicalCacheRef.current.get(pageNumber)?.text.length ?? 0
              }
              viewport={geometry.viewport}
              scaleOneViewport={geometry.scaleOneViewport}
              debug={props.ocrDebug}
            />
          )}
          {edgeCropEditing && (
            <EdgeCropOverlay
              pageNumber={pageNumber}
              edgeCrop={edgeCrop}
              onApply={onEdgeCropApply}
              onHidePage={onEdgeCropHidePage}
            />
          )}
          <PdfPageOverlayLayer
            pageNumber={pageNumber}
            pageDiv={pageView.div}
            geometry={geometry}
            tool={tool}
            overlayRectType={overlayRectType}
            ranges={overlayRanges}
            rects={rects}
            painting={pagePaintings[pageId]}
            selectedRangeId={selectedRangeId}
            selectedRectId={selectedRectId}
            highlightColor={highlightColor}
            selectionContexts={selectionContextsRef.current}
            paintingSettings={resolvedPaintingSettings}
            onPaintingSettingsChange={
              onPaintingSettingsChange ?? ignoreControllerDataChange
            }
            pagePaintings={pagePaintings}
            onPaintingChange={(id, nextValue) => {
              const nextPaintings = {
                ...paintingsState.current.current,
                [id]: nextValue
              }
              paintingsState.current.current = nextPaintings
              onPagePaintingChange?.(id, nextValue, nextPaintings)
              onPagePaintingsChange?.(nextPaintings)
            }}
            onSelectRange={onSelectRange}
            onSelectRect={onSelectRect}
            onCreateRect={onCreateRect}
            onDraftRect={onDraftRect}
            draftRectangle={draftRectangle}
            onUpdateRect={onUpdateRect}
          />
        </PdfOverlayPortal>
      ]
    })
    // geometryVersion 驱动 viewport 变化后的重投影。
  }, [
    status,
    overlayPages,
    previewVersion,
    geometryVersion,
    tool,
    overlayRectType,
    ranges,
    rects,
    pagePaintings,
    selectedRangeId,
    selectedRectId,
    highlightColor,
    resolvedPaintingSettings,
    onPaintingSettingsChange,
    onPagePaintingChange,
    onPagePaintingsChange,
    onSelectRange,
    onSelectRect,
    onCreateRect,
    onDraftRect,
    draftRectangle,
    onUpdateRect,
    getPageGeometry,
    edgeCropEditing,
    edgeCrop,
    hiddenPages,
    onEdgeCropApply,
    onEdgeCropHidePage,
    ocrTexts,
    props.ocrDebug,
    pageRange
  ])

  const rootClassName = className
    ? `hamster-reader__pdf-viewer ${className}`
    : 'hamster-reader__pdf-viewer'
  return (
    <div
      className={rootClassName}
      style={
        {
          '--pdf-selection-color': pdfHighlightFill(
            ranges.find((range) => range.id === selectedRangeId)?.markerStyle
              ?.backgroundColor ?? highlightColor
          )
        } as React.CSSProperties
      }
      data-status={status}
      data-testid='pdf-document-viewer'
    >
      <div
        ref={containerRef}
        className='hamster-reader__pdf-viewer-container'
        data-pdf-touch-selection={touchSelection.touch ? 'true' : undefined}
        data-pdf-selection-enabled={
          tool === 'text-selection' && !edgeCropEditing ? 'true' : undefined
        }
        style={
          {
            position: 'absolute',
            inset: 0,
            overflow: 'auto',
            // The PDF.js page box must consume the host's effective top/bottom
            // inset; viewport math alone does not move the real page element.
            '--pdf-top-inset': `${props.readingInsets?.top ?? 0}px`,
            '--pdf-bottom-inset': `${props.readingInsets?.bottom ?? 0}px`
          } as React.CSSProperties
        }
      >
        <div ref={viewerElementRef} className='pdfViewer' />
        {edgeCropEditing && props.onHiddenPagesRestore && (
          <PdfHiddenPageGroupControls
            groups={hiddenGroups}
            readablePages={readablePages}
            container={containerRef.current}
            viewer={viewerElementRef.current}
            getPageView={(pageNumber) =>
              viewerRef.current?.getPageView(pageNumber - 1)
            }
            onOpen={(groupStart, trigger) => {
              restoreTriggerRef.current = trigger
              setRestoreGroupStart(groupStart)
            }}
          />
        )}
      </div>
      {overlayElements}
      {restoreGroupStart !== null && hiddenGroups.length > 0 && (
        <PdfHiddenPageRestoreModal
          groups={hiddenGroups}
          initialGroupStart={restoreGroupStart}
          document={ocrDocument}
          bodyBusy={() => {
            const viewer = viewerRef.current
            return Boolean(
              isRestoringLayout() ||
              viewer?.getPageView(viewer.currentPageNumber - 1)
                ?.renderingState === 1
            )
          }}
          releasePage={(document, page) => {
            if (document !== documentRef.current) return
            eventBusRef.current?.dispatch('thumbnailrendered', {
              source: viewerRef.current,
              pageNumber: page.pageNumber,
              pdfPage: page
            })
          }}
          onClose={() => setRestoreGroupStart(null)}
          onConfirm={(pageNumbers) => {
            setRestoreGroupStart(null)
            props.onHiddenPagesRestore?.(pageNumbers)
          }}
        />
      )}
      {props.canUndoHiddenPagesRestore &&
        createPortal(
          <div className='hamster-reader__pdf-hidden-undo' role='status'>
            <span>已恢复所选页面</span>
            <button type='button' onClick={props.onHiddenPagesRestoreUndo}>
              撤销
            </button>
          </div>,
          window.document.body
        )}
    </div>
  )
})
