import type {
  IntermediateContent,
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  getPageContentEntries,
  getRuntimeDocument,
  getVisiblePageNumbers,
  isIntermediateText
} from './IntermediateDocumentViewer'
import type {
  ReaderPageRange,
  ReaderTextSelectionDetail
} from './IntermediateDocumentViewer'
import { IntermediateDocumentTextPageContent } from './IntermediateDocumentTextPageContent'
import {
  buildSelectionPayload,
  textElementRecords,
  type ReaderSelectedTextSegment
} from '../selection/selectionPayloadSerializer'
import { runtimePageSelectionId } from './selectionAdapter'
import type { IntermediateDocumentRenderTimingCallback } from './renderTiming'
import type { LazyPageQueueConfig } from './useLazyPageQueue'
import { useLazyPageQueue } from './useLazyPageQueue'

/**
 * 文本模式下每页的初始高度估计值（px）。
 *
 * 在真实测量前，`useVirtualizer` 用此值计算占位高度与可见范围。
 * 选用 800px：与常见 A4 文本页（约 1100px 物理高度，去 padding 后接近 800px）
 * 一致，且与 layout 模式默认页尺寸（595×842）的量级接近，保证首次渲染范围
 * 稳定。`measureElement` 挂载后会用实际 DOM 高度替换该估计值。
 */
const TEXT_PAGE_ESTIMATED_HEIGHT = 800

const DEFAULT_TEXT_PAGE_UNLOAD_DELAY_MS = 5000

const getEffectiveTextMaxLoadedPages = (
  configuredMaxLoadedPages: number | undefined,
  visibleCount: number
) => {
  if (configuredMaxLoadedPages === Infinity) return Infinity
  if (
    typeof configuredMaxLoadedPages === 'number' &&
    Number.isFinite(configuredMaxLoadedPages) &&
    configuredMaxLoadedPages > 0
  ) {
    return configuredMaxLoadedPages
  }

  return Math.max(5, visibleCount + 2)
}

const getTextContentEntries = async (
  page: unknown
): Promise<IntermediateContent[]> => getPageContentEntries(page)

/**
 * 文本渲染模式下 `IntermediateDocumentTextViewer` 的 props。
 *
 * 与 {@link IntermediateDocumentViewerProps} 相比，文本模式只接受以下子集：
 * - 文档输入：`document` / `serializedDocument` / `className`
 * - 页面范围与懒加载队列：`pageRange`、`initialLoadedPages`、
 *   `pageLoadConcurrency`、`pageLoadEnterDelayMs`、`pageUnloadDelayMs`、
 *   `maxLoadedPages`
 * - 旧版文本选择回调：`onTextSelectionChange`、`onTextSelectionEnd`、
 *   `onSelectText`
 * - 渲染计时回调：`onIntermediateDocumentRenderTiming`
 *
 * 文本模式不经过 `VirtualPaper`，因此不接受任何缩放、交互模式、
 * linked-range selection 或 overlay 相关 props。
 */
export type IntermediateDocumentTextViewerProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  /** 已序列化的中间文档；与 `document` 二选一，文本模式同样支持。 */
  serializedDocument?: IntermediateDocumentSerialized | null
  className?: string
  pageRange?: ReaderPageRange
  /** 初始立即加载的页数，默认 `1`。 */
  initialLoadedPages?: number
  /** 并发加载页数上限，默认 `3`。 */
  pageLoadConcurrency?: number
  /** 页面进入可加载窗口后、发起加载前的延迟（毫秒），默认 `500`。 */
  pageLoadEnterDelayMs?: number
  /** 页面离开可加载窗口后、卸载内容的延迟（毫秒），默认 `5000`。 */
  pageUnloadDelayMs?: number
  /** 最大并发已加载页数，超出后触发懒淘汰。 */
  maxLoadedPages?: number
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
  /** intermediate-document 渲染阶段计时回调。 */
  onIntermediateDocumentRenderTiming?: IntermediateDocumentRenderTimingCallback
}

/**
 * `intermediate-document` 文本渲染模式的查看器。
 *
 * 文本模式使用 `@tanstack/react-virtual` 的原生滚动虚拟化，只渲染当前
 * 可见视口内的页面 DOM（`overscan: 0`）。与 layout 模式（`VirtualPaper` +
 * 全量外壳）不同，文本模式：
 * - 不挂载 `VirtualPaper`，也不渲染 `.virtual-paper-wrapper`；
 * - 不为每个页码渲染占位 DOM，仅渲染虚拟范围命中页；
 * - 解析文档与过滤页码时复用 layout 模式的 {@link getRuntimeDocument} /
 *   {@link getVisiblePageNumbers} 纯函数，避免逻辑分叉。
 *
 * 当前页面内容由 {@link IntermediateDocumentTextPageContent} 渲染，以普通文档流
 * 绘制 `IntermediateText` 条目（含 `isEOL` 换行），不渲染图片 / OCR / 底图。
 *
 * @param props 文本模式 props（见 {@link IntermediateDocumentTextViewerProps}）
 */
export function IntermediateDocumentTextViewer(
  props: IntermediateDocumentTextViewerProps
) {
  const {
    document,
    serializedDocument,
    className,
    pageRange,
    initialLoadedPages = 1,
    pageLoadConcurrency = 3,
    pageLoadEnterDelayMs = 500,
    pageUnloadDelayMs = DEFAULT_TEXT_PAGE_UNLOAD_DELAY_MS,
    maxLoadedPages
  } = props

  // 原生滚动容器 ref —— useVirtualizer 通过 getScrollElement 读取其几何尺寸。
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const activeDocumentRef = useRef<IntermediateDocument | null>(null)
  const activePageNumbersKeyRef = useRef('')
  const isMountedRef = useRef(false)
  const loadingPagesRef = useRef(new Set<number>())
  const unloadTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>()
  )
  const previousVisiblePageNumbersRef = useRef(new Set<number>())
  const textsByPageNumberRef = useRef(new Map<number, IntermediateText[]>())
  const effectiveScaleRef = useRef(1)

  // 选择追踪：镜像 layout 模式 — scrollContainer 既做滚动又做 viewer root
  const viewerRootRef = scrollContainerRef

  // textElementsRef: key = text.id — 仅注册已挂载的可见文本 span
  const textElementsRef = useRef<
    Map<string, { text: IntermediateText; pageNumber: number }>
  >(new Map())

  // 选择作用域 id（useId 保证多实例不冲突），写入每页 data-selection-id
  const scopeId = useId()
  const getRuntimePageSelectionId = useCallback(
    (pageNumber: number) => runtimePageSelectionId(scopeId, pageNumber),
    [scopeId]
  )

  const lazyQueueConfigRef = useRef<LazyPageQueueConfig>({
    initialLoadedPages,
    pageLoadConcurrency,
    pageLoadEnterDelayMs,
    pageUnloadDelayMs
  })
  lazyQueueConfigRef.current = {
    initialLoadedPages,
    pageLoadConcurrency,
    pageLoadEnterDelayMs,
    pageUnloadDelayMs
  }

  const [textsByPageNumber, setTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  textsByPageNumberRef.current = textsByPageNumber

  // 解析 runtime document，复用 layout 模式的同一份纯函数。
  // 文档缺失（null/undefined）时返回 null。
  const runtimeDocument = useMemo(
    () => getRuntimeDocument(document ?? serializedDocument),
    [document, serializedDocument]
  )

  // 从 runtimeDocument.pageNumbers 经 pageRange 过滤得到可见页码列表。
  // getVisiblePageNumbers 对无效 range 返回 []，与 layout 模式语义一致。
  const pageNumbers = useMemo(() => {
    const allPageNumbers = runtimeDocument?.pageNumbers ?? []
    return getVisiblePageNumbers(allPageNumbers, pageRange)
  }, [runtimeDocument, pageRange])
  const pageNumbersKey = useMemo(() => pageNumbers.join(','), [pageNumbers])

  // TanStack Virtual 虚拟化器：count = pageNumbers.length，
  // estimateSize 用稳定的 800px 直到 measureElement 测得真实高度，
  // getItemKey 直接用真实页码（稳定 key，避免页码/索引错位），
  // overscan: 0 严格保证只渲染可见视口内的页面 DOM。
  // measureElement 选项：当 getBoundingClientRect().height 为 0（退化场景，
  // 如 jsdom 环境或空内容页）时回退到估计值，防止全部页面塌缩为 0 高度
  // 导致虚拟范围爆炸。
  const virtualizer = useVirtualizer({
    count: pageNumbers.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => TEXT_PAGE_ESTIMATED_HEIGHT,
    getItemKey: (index) => pageNumbers[index],
    overscan: 0,
    measureElement: (el) => {
      const measured = el.getBoundingClientRect().height
      return measured > 0 ? measured : TEXT_PAGE_ESTIMATED_HEIGHT
    }
  })

  const virtualItems = virtualizer.getVirtualItems()
  const visiblePageNumbers = useMemo(
    () =>
      virtualItems
        .map((item) => pageNumbers[item.index])
        .filter(
          (pageNumber): pageNumber is number => typeof pageNumber === 'number'
        ),
    [virtualItems, pageNumbers]
  )
  const visiblePageNumberSet = useMemo(
    () => new Set(visiblePageNumbers),
    [visiblePageNumbers]
  )

  const clearUnloadTimer = useCallback((pageNumber: number) => {
    const timer = unloadTimersRef.current.get(pageNumber)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    unloadTimersRef.current.delete(pageNumber)
  }, [])

  const clearAllUnloadTimers = useCallback(() => {
    unloadTimersRef.current.forEach((timer) => {
      clearTimeout(timer)
    })
    unloadTimersRef.current.clear()
  }, [])

  const applyLoadedPageLimit = useCallback(
    (loadedTexts: Map<number, IntermediateText[]>) => {
      const cap = getEffectiveTextMaxLoadedPages(
        maxLoadedPages,
        visiblePageNumberSet.size
      )
      if (!Number.isFinite(cap) || loadedTexts.size <= cap) {
        return loadedTexts
      }

      const nextTexts = new Map(loadedTexts)
      for (const pageNumber of nextTexts.keys()) {
        if (nextTexts.size <= cap) {
          break
        }
        if (!visiblePageNumberSet.has(pageNumber)) {
          nextTexts.delete(pageNumber)
          clearUnloadTimer(pageNumber)
        }
      }
      return nextTexts
    },
    [clearUnloadTimer, maxLoadedPages, visiblePageNumberSet]
  )

  const lazyPageQueue = useLazyPageQueue(lazyQueueConfigRef, runtimeDocument, {
    mode: 'text',
    activeDocumentRef,
    isMountedRef,
    loadingPagesRef,
    getPageContentEntries: getTextContentEntries,
    isIntermediateText,
    callbacks: {
      onPageLoaded: ({ pageNumber, texts }) => {
        clearUnloadTimer(pageNumber)
        setTextsByPageNumber((currentTexts) => {
          const nextTexts = new Map(currentTexts)
          nextTexts.set(pageNumber, texts)
          return applyLoadedPageLimit(nextTexts)
        })
      },
      onPageError: (pageNumber) => {
        clearUnloadTimer(pageNumber)
        setTextsByPageNumber((currentTexts) => {
          const nextTexts = new Map(currentTexts)
          nextTexts.set(pageNumber, [])
          return applyLoadedPageLimit(nextTexts)
        })
      },
      isPageLoaded: (pageNumber) => textsByPageNumberRef.current.has(pageNumber)
    },
    effectiveScaleRef
  })

  const lazyPageQueueRef = useRef(lazyPageQueue)
  lazyPageQueueRef.current = lazyPageQueue

  const { onTextSelectionChange, onTextSelectionEnd, onSelectText } = props

  // setTextRef: 柯里化回调 (text, pageNumber) => (element) => void
  // 与 layout 模式完全兼容。element 非 null 注册，null 卸载。
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

  const removeLoadedTextPage = useCallback((pageNumber: number) => {
    setTextsByPageNumber((currentTexts) => {
      if (!currentTexts.has(pageNumber)) {
        return currentTexts
      }
      const nextTexts = new Map(currentTexts)
      nextTexts.delete(pageNumber)
      return nextTexts
    })
  }, [])

  // getSelectionDetail: 镜像 layout 模式，但省略 over-broad 拒绝逻辑
  // （文本模式无页面背景图，不存在整页拖选误判）。
  // 仅聚焦已挂载可见文本。offscreen 页面卸载后 ref 自动删除，不会崩溃。
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
        if (
          element instanceof HTMLElement &&
          selection.containsNode(element, true)
        ) {
          selectedElements.push(element)
        }
      })

      if (selectedElements.length === 0) return null

      selectedElements.sort((a, b) => {
        const range = a.ownerDocument.createRange()
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
        if (!id) return []
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
    []
  )

  // emitSelectionEnd: 镜像 layout 模式 — mouseup/touchend 时触发
  const emitSelectionEnd = useCallback(() => {
    if (!onTextSelectionEnd && !onSelectText) return

    const selection =
      viewerRootRef.current?.ownerDocument.defaultView?.getSelection?.() ?? null
    if (!selection) return

    const detail = getSelectionDetail(selection)
    if (!detail) return

    if (onTextSelectionEnd) {
      onTextSelectionEnd(detail.text, detail)
    }

    if (onSelectText) {
      // buildSelectionPayload 依赖 .hamster-reader__intermediate-document-viewer
      // class 在 viewer root 上（见 render）。offscreen 页面卸载后其 text 元素
      // 不在 DOM 中，自然不含在 segments 里 — 返回 null 是可接受的。
      const payload = buildSelectionPayload(selection)
      if (payload) {
        onSelectText(payload.selection, payload.segments, payload.extractedText)
      }
    }
  }, [onTextSelectionEnd, onSelectText, getSelectionDetail])

  // selectionchange → onTextSelectionChange
  useEffect(() => {
    if (!onTextSelectionChange) return

    const handleSelectionChange = () => {
      const selection =
        viewerRootRef.current?.ownerDocument.defaultView?.getSelection?.() ??
        null
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

  // mouseup / touchend → emitSelectionEnd（与 layout 模式一致）
  useEffect(() => {
    const root = viewerRootRef.current
    if (!root) return

    root.addEventListener('mouseup', emitSelectionEnd)
    root.addEventListener('touchend', emitSelectionEnd)

    return () => {
      root.removeEventListener('mouseup', emitSelectionEnd)
      root.removeEventListener('touchend', emitSelectionEnd)
    }
  }, [emitSelectionEnd])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      clearAllUnloadTimers()
      lazyPageQueueRef.current.cancelAll()
    }
  }, [clearAllUnloadTimers])

  useEffect(() => {
    activeDocumentRef.current = runtimeDocument
    activePageNumbersKeyRef.current = pageNumbersKey
    previousVisiblePageNumbersRef.current = new Set()
    textsByPageNumberRef.current = new Map()
    textElementsRef.current.clear()
    setTextsByPageNumber(new Map())
    clearAllUnloadTimers()
    lazyPageQueueRef.current.cancelAll()
  }, [runtimeDocument, pageNumbersKey, clearAllUnloadTimers])

  useEffect(() => {
    if (!runtimeDocument || visiblePageNumbers.length === 0) {
      return
    }

    const previousVisiblePages = previousVisiblePageNumbersRef.current
    const currentVisiblePages = new Set(visiblePageNumbers)
    const isInitialVisibleSet = previousVisiblePages.size === 0

    currentVisiblePages.forEach((pageNumber) => {
      clearUnloadTimer(pageNumber)
    })

    if (isInitialVisibleSet) {
      lazyPageQueueRef.current.cancelAll()
      lazyPageQueueRef.current.enqueueInitialPages(visiblePageNumbers)
    } else {
      currentVisiblePages.forEach((pageNumber) => {
        if (!previousVisiblePages.has(pageNumber)) {
          lazyPageQueueRef.current.enqueuePage(pageNumber)
        }
      })
    }

    previousVisiblePages.forEach((pageNumber) => {
      if (currentVisiblePages.has(pageNumber)) {
        return
      }
      if (!textsByPageNumberRef.current.has(pageNumber)) {
        return
      }
      if (unloadTimersRef.current.has(pageNumber)) {
        return
      }
      const timer = setTimeout(() => {
        unloadTimersRef.current.delete(pageNumber)
        if (
          !isMountedRef.current ||
          activeDocumentRef.current !== runtimeDocument
        ) {
          return
        }
        removeLoadedTextPage(pageNumber)
      }, lazyQueueConfigRef.current.pageUnloadDelayMs)
      unloadTimersRef.current.set(pageNumber, timer)
    })

    previousVisiblePageNumbersRef.current = currentVisiblePages
  }, [
    clearUnloadTimer,
    removeLoadedTextPage,
    runtimeDocument,
    visiblePageNumbers
  ])

  useEffect(() => {
    setTextsByPageNumber((currentTexts) => applyLoadedPageLimit(currentTexts))
  }, [applyLoadedPageLimit])

  // 文档标题用于无障碍标签；缺失时回退到静态文案。
  const title = runtimeDocument?.title

  return (
    <div
      ref={scrollContainerRef}
      role='document'
      className={[
        // 文本模式 viewer 根：scoped class 提供原生滚动 + block 布局
        // （SCSS 中后于 layout 模式定义，覆盖 display:flex / overflow:hidden）
        'hamster-reader__intermediate-text-viewer',
        'hamster-reader__intermediate-text-scroll',
        // 添加 layout 模式的 viewer class，使 buildSelectionPayload 的
        // getSelectionViewerRoot 能在文本模式下找到 viewer root — 不影响布局
        // 因为 SCSS .hamster-reader__intermediate-text-viewer / -text-scroll
        // 的 display:block / overflow:auto 在源码顺序上后于该 class，覆盖其
        // display:flex / overflow:hidden
        'hamster-reader__intermediate-document-viewer',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid='intermediate-document-text-viewer'
      data-title={title}
    >
      {/* 内部 spacer：高度 = 虚拟化器累计总高度（inline），CSS 提供 position:relative */}
      <div
        className='hamster-reader__intermediate-text-spacer'
        style={{ height: virtualizer.getTotalSize() }}
      >
        {/* 仅渲染虚拟范围内的页面，不渲染任何非可见页占位 DOM */}
        {virtualItems.map((virtualItem) => {
          const pageNumber = pageNumbers[virtualItem.index]
          const texts =
            typeof pageNumber === 'number'
              ? textsByPageNumber.get(pageNumber)
              : undefined
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              data-page-number={pageNumber}
              data-selection-id={
                typeof pageNumber === 'number'
                  ? getRuntimePageSelectionId(pageNumber)
                  : undefined
              }
              data-testid={`intermediate-text-page-${pageNumber}`}
              // SCSS .hamster-reader__intermediate-text-page 提供
              // position:absolute / top:0 / left:0 / width:100% / padding:5px，
              // 仅保留动态 transform（由 TanStack Virtual 计算）
              className='hamster-reader__intermediate-text-page'
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              {texts ? (
                <IntermediateDocumentTextPageContent
                  pageNumber={pageNumber}
                  texts={texts}
                  setTextRef={setTextRef}
                />
              ) : (
                <>Page {pageNumber}</>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
