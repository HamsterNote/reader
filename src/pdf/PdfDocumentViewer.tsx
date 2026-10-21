// HAM-89 / tasks.md 3.1–3.5：PDF 主展示切换到 pdfjs-dist 官方 viewer。
// 官方 PDFViewer/PDFLinkService/EventBus 负责页面、文本层、链接、缩放与
// 渲染队列（懒加载）；reader 叠加层负责高亮/矩形/绘图。本组件不修改公共
// Reader 路由与 demo 入口，接线由集成任务（HAM-91）完成。

import type {
  DrawingTool,
  DrawingValue,
  PaintingControllerData
} from '@hamster-note/painting'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { EventBus, PDFLinkService, PDFViewer } from './pdfViewerLib'

import type { ReaderTextAnchor } from '../types/readerData'
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
  type TextItem
} from './pdfjsRuntime'
import type { PdfPageOverlayGeometry } from './PdfPageOverlayLayer'
import { PdfPageOverlayLayer } from './PdfPageOverlayLayer'
import { edgeCropToClipPath } from './pdfOverlayGeometry'
import type { OverlayRectUnit } from './pdfOverlayGeometry'
import type { ReaderEdgeCrop } from '../types/readerData'
import type { PdfPageSelectionContext } from './pdfSelectionSerializer'
import { serializePdfTextSelection } from './pdfSelectionSerializer'
import type { SerializedPdfSelection } from './pdfSelectionSerializer'
import type { CanonicalPageText } from './pdfTextMapping'
import { buildCanonicalPageText, enhanceTextLayer } from './pdfTextMapping'

export type PdfViewerTool = 'text-selection' | 'rect-selection' | 'drawing'

export type PdfViewerStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PdfViewerError = {
  readonly kind: PdfOpenErrorKind
  readonly message: string
}

export type PdfDocumentViewerProps = {
  readonly source: PdfDocumentSource | null
  /** pdfjs worker 资产 URL（宿主提供；不设置时沿用全局配置）。 */
  readonly workerSrc?: string
  /** cMapUrl/standardFontDataUrl 等 getDocument 透传参数。 */
  readonly documentOptions?: Readonly<Record<string, unknown>>
  readonly className?: string
  readonly scale?: number
  readonly defaultScale?: number
  readonly onScaleChange?: (scale: number) => void
  readonly currentPageNumber?: number
  readonly onPageChange?: (pageNumber: number) => void
  readonly onPagesLoaded?: (pageCount: number) => void
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
  readonly pagePaintings?: Record<string, DrawingValue>
  readonly selectedRangeId?: string | null
  readonly selectedRectId?: string | null
  readonly onHighlight?: (range: ReaderSelectionRange) => void
  readonly onSelectRange?: (id: string | null) => void
  readonly onCreateRect?: (rect: ReaderSelectionRectangle) => void
  readonly onSelectRect?: (id: string | null) => void
  readonly onPagePaintingChange?: (
    pageId: string,
    nextValue: DrawingValue,
    nextPaintings: Record<string, DrawingValue>
  ) => void
  readonly onPagePaintingsChange?: (next: Record<string, DrawingValue>) => void
  readonly paintingControllerData?: PaintingControllerData
  readonly onPaintingControllerDataChange?: (
    data: PaintingControllerData
  ) => void
  /** 未受控 controllerData 时的默认绘图工具（默认 'pen'）。 */
  readonly paintingTool?: DrawingTool
  /** 未受控 controllerData 时的默认笔触颜色（默认 '#2563eb'）。 */
  readonly drawingStrokeColor?: string
  /** 原生选区变化（text 为拼接文本，detail 含公开端点与矩形）。 */
  readonly onTextSelectionChange?: (
    text: string,
    detail: SerializedPdfSelection | null
  ) => void
  /** 阅读锚点变化（书签/进度用；textId 失效时宿主按 offset 兜底）。 */
  readonly onTextAnchorChange?: (anchor: ReaderTextAnchor | null) => void
  /** 隐藏页（数字或 'page-N'，与 ReaderData.hiddenPages 同契约）。 */
  readonly hiddenPages?: readonly (number | string)[]
  /** 裁切（0..1 分数；页级覆盖由宿主合并后传入单页值亦可）。 */
  readonly edgeCrop?: ReaderEdgeCrop
}

export type PdfDocumentViewerRef = {
  readonly scrollToPage: (pageNumber: number) => void
  readonly setScale: (scale: number) => void
  readonly captureTextAnchor: () => ReaderTextAnchor | null
  readonly scrollToAnchor: (anchor: ReaderTextAnchor) => void
  readonly scrollToRange: (rangeId: string) => void
  readonly getCanonicalPageText: (pageNumber: number) => string | undefined
  /** 把当前原生选区转为公开 range 并触发 onHighlight。 */
  readonly confirmSelection: () => void
  readonly clearSelection: () => void
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

const normalizeHiddenPageNumbers = (
  hiddenPages: readonly (number | string)[] | undefined
): ReadonlySet<number> => {
  const result = new Set<number>()
  for (const entry of hiddenPages ?? []) {
    if (typeof entry === 'number') {
      result.add(entry)
      continue
    }
    const match = /^page-([1-9]\d*)$/.exec(entry)
    if (match) result.add(Number(match[1]))
  }
  return result
}

type OverlayPortalProps = {
  readonly pageDiv: HTMLElement
  readonly children: ReactNode
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
    onScaleChange,
    currentPageNumber,
    onPageChange,
    onPagesLoaded,
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
    onSelectRect,
    onPagePaintingChange,
    onPagePaintingsChange,
    paintingControllerData,
    paintingTool,
    drawingStrokeColor,
    onPaintingControllerDataChange,
    onTextSelectionChange,
    onTextAnchorChange,
    hiddenPages,
    edgeCrop
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElementRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const eventBusRef = useRef<EventBus | null>(null)
  const linkServiceRef = useRef<PDFLinkService | null>(null)
  const sessionManagerRef = useRef(new PdfSessionManager())
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const canonicalCacheRef = useRef(new Map<number, CanonicalPageText>())
  const selectionContextsRef = useRef(
    new Map<number, PdfPageSelectionContext>()
  )
  const [status, setStatus] = useState<PdfViewerStatus>('idle')
  const [geometryVersion, setGeometryVersion] = useState(0)
  const [overlayPages, setOverlayPages] = useState<readonly number[]>([])
  // 事件回调经 ref 读取，避免 init effect 闭包过期。
  const callbacksRef = useRef({ onPageChange, onScaleChange, onPagesLoaded })
  callbacksRef.current = { onPageChange, onScaleChange, onPagesLoaded }
  // pagesinit 时的初始缩放：受控 scale 优先于 defaultScale。
  const initialScaleRef = useRef(scale ?? defaultScale)
  initialScaleRef.current = scale ?? defaultScale

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
    if (!viewer) return
    // eslint-disable-next-line sonarjs/void-use -- text layer 增强为后台任务，无需等待
    void getCanonical(pageNumber).then((canonical) => {
      if (!canonical || viewerRef.current !== viewer) return
      const matched = enhanceTextLayer(textLayerDiv, canonical)
      onResult?.(matched)
      const pageView = viewer.getPageView(pageNumber - 1)
      const geometry = getPageGeometry(pageNumber)
      if (matched && pageView && geometry) {
        selectionContextsRef.current.set(pageNumber, {
          pageNumber,
          textLayerDiv,
          pageDiv: pageView.div,
          canonical,
          viewport: geometry.viewport,
          scaleOneViewport: geometry.scaleOneViewport,
          visual: geometry.visual
        })
      } else if (!matched) {
        // 瞬态重组中不匹配：摘除上下文，等下一次 DOM 变化重试。
        selectionContextsRef.current.delete(pageNumber)
      }
      bumpGeometry()
    })
  }

  // 与 IntermediateDocumentViewer 同一约定：未受控时使用静态默认控制面，
  // 变更被忽略（宿主不受控即不关心工具状态）。
  const resolvedPaintingControllerData = useMemo<PaintingControllerData>(
    () =>
      paintingControllerData ?? {
        tool: paintingTool ?? 'pen',
        minimap: false,
        strokeColor: drawingStrokeColor ?? '#2563eb',
        strokeWidth: 3
      },
    [drawingStrokeColor, paintingControllerData, paintingTool]
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
    (pageNumber: number): PdfPageOverlayGeometry | null => {
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
    if (workerSrc) configurePdfJsWorker(workerSrc)
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const viewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      // TextLayerMode.ENABLE
      textLayerMode: 1,
      annotationMode: AnnotationMode.ENABLE,
      annotationEditorMode: 0,
      removePageBorders: true
    })
    linkService.setViewer(viewer)
    viewerRef.current = viewer
    eventBusRef.current = eventBus
    linkServiceRef.current = linkService

    const handleTextLayerRendered = (event: TextLayerRenderedEvent) => {
      enhancePageTextLayerRef.current?.(event.pageNumber, event.source.div)
    }

    // pdf.js 5.x text layer 在 textlayerrendered 之后仍会重组 DOM（可能整体
    // 替换 .textLayer 节点）。对每个 page 的 textLayer 做幂等增强；用签名
    // （子节点数 + 文本长度）避免叠加层 portal 变化触发的观察回调死循环。
    const enhancedSignatures = new WeakMap<HTMLElement, string>()
    const textLayerObserver = new MutationObserver(() => {
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
      callbacksRef.current.onPageChange?.(event.pageNumber)
    }
    const handleScaleChanging = (event: { scale: number }) => {
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
      viewer.currentScaleValue = String(initialScaleRef.current)
      setOverlayPages(
        Array.from({ length: viewer.pagesCount }, (_, index) => index + 1)
      )
    }
    const handlePageRendered = () => bumpGeometry()
    const handleRotation = () => bumpGeometry()

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
      setViewerDocument(viewer, null)
      viewerRef.current = null
      eventBusRef.current = null
      linkServiceRef.current = null
    }
  }, [])

  // 打开/切换文档：PdfSessionManager 保证旧加载结果不更新后续文档。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (!source) {
      documentRef.current = null
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
    setStatus('loading')
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
        setStatus('ready')
        viewerRef.current?.setDocument(session.document)
        linkServiceRef.current?.setDocument(session.document)
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
    }
  }, [source])

  // 卸载/切文件：取消加载、销毁 worker、清空页面（tasks.md 3.5）。
  useEffect(() => {
    const manager = sessionManagerRef.current
    return () => {
      documentRef.current = null
      canonicalCacheRef.current.clear()
      selectionContextsRef.current.clear()
      const viewer = viewerRef.current
      if (viewer) setViewerDocument(viewer, null)
      // eslint-disable-next-line sonarjs/void-use -- unmount 清理无需等待销毁完成
      void manager.dispose()
    }
  }, [])

  // 受控 scale。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || scale === undefined) return
    if (Math.abs(viewer.currentScale - scale) > 0.001) {
      viewer.currentScale = scale
    }
  }, [scale, geometryVersion])

  // 受控页码。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || currentPageNumber === undefined) return
    if (viewer.currentPageNumber !== currentPageNumber) {
      viewer.currentPageNumber = currentPageNumber
    }
  }, [currentPageNumber, geometryVersion])

  // 隐藏页：display:none 占位（矩阵 §9：阅读时省略隐藏页）。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const hidden = normalizeHiddenPageNumbers(hiddenPages)
    for (let pageNumber = 1; pageNumber <= viewer.pagesCount; pageNumber++) {
      const pageView = viewer.getPageView(pageNumber - 1)
      if (!pageView) continue
      pageView.div.style.display = hidden.has(pageNumber) ? 'none' : ''
    }
  }, [hiddenPages, geometryVersion, status])

  // 裁切：clip-path 只裁可视区域，叠加层坐标不受影响（3.3 裁切对齐）。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const clipPath = edgeCropToClipPath(edgeCrop)
    for (let pageNumber = 1; pageNumber <= viewer.pagesCount; pageNumber++) {
      const pageView = viewer.getPageView(pageNumber - 1)
      if (!pageView) continue
      pageView.div.style.clipPath = clipPath ?? ''
    }
  }, [edgeCrop, geometryVersion, status])

  const serializeCurrentSelection =
    useCallback((): SerializedPdfSelection | null => {
      const view = containerRef.current?.ownerDocument.defaultView
      const selection = view?.getSelection?.() ?? null
      if (!selection) return null
      return serializePdfTextSelection(
        selection,
        selectionContextsRef.current,
        overlayRectType
      )
    }, [overlayRectType])

  // 选区变化 → onTextSelectionChange（text + 公开端点 detail）。
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onTextSelectionChange) return
    const ownerDocument = container.ownerDocument

    let scheduled = false
    const emitSelection = () => {
      scheduled = false
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

  // 阅读锚点：当前页第一个已增强文本 span（书签/进度，矩阵 §6/§7）。
  const captureTextAnchor = useCallback((): ReaderTextAnchor | null => {
    const viewer = viewerRef.current
    if (!viewer || viewer.pagesCount === 0) return null
    const pageNumber = viewer.currentPageNumber
    const context = selectionContextsRef.current.get(pageNumber)
    if (!context) return null
    const firstSpan = context.textLayerDiv.querySelector<HTMLElement>(
      '[data-selection-start-offset]'
    )
    if (!firstSpan) return null
    return {
      pageNumber,
      textId: firstSpan.getAttribute('data-text-id') ?? '',
      text: firstSpan.textContent ?? '',
      offset: Number(firstSpan.getAttribute('data-selection-start-offset') ?? 0)
    }
  }, [])

  useEffect(() => {
    const eventBus = eventBusRef.current
    if (!eventBus || !onTextAnchorChange) return
    const emit = () => onTextAnchorChange(captureTextAnchor())
    eventBus.on('pagechanging', emit)
    return () => eventBus.off('pagechanging', emit)
  }, [onTextAnchorChange, captureTextAnchor, status])

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage: (pageNumber) => {
        const viewer = viewerRef.current
        if (!viewer) return
        viewer.currentPageNumber = pageNumber
      },
      setScale: (nextScale) => {
        const viewer = viewerRef.current
        if (viewer) viewer.currentScale = nextScale
      },
      captureTextAnchor,
      scrollToAnchor: (anchor) => {
        const viewer = viewerRef.current
        if (!viewer) return
        viewer.currentPageNumber = anchor.pageNumber
        const context = selectionContextsRef.current.get(anchor.pageNumber)
        const target = context?.textLayerDiv.querySelector<HTMLElement>(
          `[data-text-id="${anchor.textId}"]`
        )
        target?.scrollIntoView({ block: 'start' })
      },
      scrollToRange: (rangeId) => {
        const viewer = viewerRef.current
        const range = ranges.find((candidate) => candidate.id === rangeId)
        if (!viewer || !range) return
        const match = /^page-([1-9]\d*)$/.exec(range.start.selectionId)
        if (!match) return
        viewer.currentPageNumber = Number(match[1])
      },
      getCanonicalPageText: (pageNumber) =>
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
        containerRef.current?.ownerDocument.defaultView
          ?.getSelection()
          ?.removeAllRanges()
      }
    }),
    [
      captureTextAnchor,
      ranges,
      overlayRectType,
      onHighlight,
      serializeCurrentSelection
    ]
  )

  const overlayElements = useMemo(() => {
    // 不用 status 门控：open 失败（error）时旧文档与已渲染标注必须保持。
    if (overlayPages.length === 0) return null
    const viewer = viewerRef.current
    if (!viewer) return null

    return overlayPages.flatMap((pageNumber) => {
      const pageView = viewer.getPageView(pageNumber - 1)
      if (!pageView) return []
      const geometry = getPageGeometry(pageNumber)
      if (!geometry) return []
      const pageId = `page-${pageNumber}`
      return [
        <PdfOverlayPortal key={pageId} pageDiv={pageView.div}>
          <PdfPageOverlayLayer
            pageNumber={pageNumber}
            pageDiv={pageView.div}
            geometry={geometry}
            tool={tool}
            overlayRectType={overlayRectType}
            ranges={ranges}
            rects={rects}
            painting={pagePaintings[pageId]}
            selectedRangeId={selectedRangeId}
            selectedRectId={selectedRectId}
            highlightColor={highlightColor}
            selectionContexts={selectionContextsRef.current}
            paintingControllerData={resolvedPaintingControllerData}
            onPaintingControllerDataChange={
              onPaintingControllerDataChange ?? ignoreControllerDataChange
            }
            pagePaintings={pagePaintings}
            onPaintingChange={(id, nextValue, nextPaintings) => {
              onPagePaintingChange?.(id, nextValue, nextPaintings)
              onPagePaintingsChange?.(nextPaintings)
            }}
            onSelectRange={onSelectRange}
            onSelectRect={onSelectRect}
            onCreateRect={onCreateRect}
          />
        </PdfOverlayPortal>
      ]
    })
    // geometryVersion 驱动 viewport 变化后的重投影。
  }, [
    status,
    overlayPages,
    geometryVersion,
    tool,
    overlayRectType,
    ranges,
    rects,
    pagePaintings,
    selectedRangeId,
    selectedRectId,
    highlightColor,
    resolvedPaintingControllerData,
    onPaintingControllerDataChange,
    onPagePaintingChange,
    onPagePaintingsChange,
    onSelectRange,
    onSelectRect,
    onCreateRect,
    getPageGeometry
  ])

  const rootClassName = className
    ? `hamster-reader__pdf-viewer ${className}`
    : 'hamster-reader__pdf-viewer'
  return (
    <div
      className={rootClassName}
      data-status={status}
      data-testid='pdf-document-viewer'
    >
      <div
        ref={containerRef}
        className='hamster-reader__pdf-viewer-container'
        style={{ position: 'absolute', inset: 0, overflow: 'auto' }}
      >
        <div ref={viewerElementRef} className='pdfViewer' />
      </div>
      {overlayElements}
    </div>
  )
})
