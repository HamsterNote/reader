import type {
  LinkedSelectionData,
  LinkedSelectionRange,
  SelectionRange,
  SelectionRef
} from '@hamster-note/selection'
import { Selection as HamsterSelection } from '@hamster-note/selection'
import type {
  IntermediateContent,
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react'

import type {
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderMousePosition,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../../types/selection'

import { PopoverPortal } from '../PopoverPortal'
import {
  buildSelectionPayload,
  type ReaderSelectedTextSegment,
  textElementRecords
} from '../selection/selectionPayloadSerializer'
import { IntermediateDocumentTextPageContent } from './IntermediateDocumentTextPageContent'
import { RangeHandle } from './RangeHandle'
import { RangeMagnifierProvider } from './RangeMagnifier'
import { parsePublicPageId } from './rangeJumpHelpers'
import { TextSelectionMagnifier } from './TextSelectionMagnifier'
import type {
  ReaderPageRange,
  ReaderTextSelectionDetail
} from './IntermediateDocumentViewer'
import {
  getPageContentEntries,
  getRuntimeDocument,
  getVisiblePageNumbers,
  isIntermediateText
} from './IntermediateDocumentViewer'
import type { IntermediateDocumentRenderTimingCallback } from './renderTiming'
import {
  areRuntimeLinkedTransientsEqual,
  buildRuntimeLinkedSelectionData,
  extractRuntimeLinkedTransient,
  mapRuntimeLinkedDataToPublic,
  mapRuntimeRangeToPublic,
  runtimePageSelectionId,
  type RuntimeLinkedSelectionTransient
} from './selectionAdapter'
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

const EMPTY_SELECTION_RANGES: SelectionRange[] = []

const DISABLED_ANNOTATION_HISTORY_STATUS = {
  enabled: false,
  canUndo: false,
  canRedo: false,
  pastCount: 0,
  futureCount: 0
} as const

type PendingLinkedHighlightOperation = ReadonlySet<string>

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

const getElementFromSelectionNode = (node: Node | null): Element | null => {
  if (!node) return null
  return node instanceof Element ? node : node.parentElement
}

const getRuntimeSelectionIdFromSelectionNode = (
  node: Node | null,
  runtimePageSelectionId: (pageNumber: number) => string
): string | null => {
  const element = getElementFromSelectionNode(node)
  if (!element) return null

  const selectionContainer = element.closest('.hsn-selection-container')
  if (selectionContainer instanceof HTMLElement) {
    const selectionId = selectionContainer.dataset.selectionId
    if (selectionId) return selectionId
  }

  const pageContainer = element.closest(
    '.hamster-reader__intermediate-text-page'
  )
  if (!(pageContainer instanceof HTMLElement)) return null

  const pageSelectionId = pageContainer.dataset.selectionId
  if (pageSelectionId) return pageSelectionId

  const pageNumber = Number(pageContainer.dataset.pageNumber)
  return Number.isFinite(pageNumber) ? runtimePageSelectionId(pageNumber) : null
}

function findTouchedRangeIdByPoint(
  linkedData: LinkedSelectionData,
  clientX: number,
  clientY: number,
  selectionContainers: HTMLElement[]
): string | null {
  for (const range of linkedData.items) {
    const rectType =
      range.overlayRectType ?? linkedData.overlayRectType ?? 'percent'
    const touchedRange = Object.entries(range.rectsBySelectionId).some(
      ([selectionId, rects]) => {
        const container = selectionContainers.find(
          (element) => element.dataset.selectionId === selectionId
        )
        if (!container) return false

        const bounds = container.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) return false

        const localX =
          rectType === 'percent'
            ? ((clientX - bounds.left) / bounds.width) * 100
            : ((clientX - bounds.left) / bounds.width) *
              (container.clientWidth || bounds.width)
        const localY =
          rectType === 'percent'
            ? ((clientY - bounds.top) / bounds.height) * 100
            : ((clientY - bounds.top) / bounds.height) *
              (container.clientHeight || bounds.height)
        return rects.some(
          (rect) =>
            localX >= rect.x &&
            localX <= rect.x + rect.width &&
            localY >= rect.y &&
            localY <= rect.y + rect.height
        )
      }
    )
    if (touchedRange) return range.id
  }

  return null
}

function isPointOnHighlightElement(
  rootElement: Element,
  clientX: number,
  clientY: number
): boolean {
  return Array.from(
    rootElement.querySelectorAll(
      '.hsn-selection-rect--highlight, .hsn-selection-rect--selected, .hsn-selection-percent-rect-highlight'
    )
  ).some((element) => {
    const rect = element.getBoundingClientRect()
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
  })
}

interface TouchTapStart {
  pointerId: number
  clientX: number
  clientY: number
  moved: boolean
}

function shouldIgnoreTouchPointerUp(
  touchStart: TouchTapStart | null,
  event: ReactPointerEvent<HTMLDivElement>,
  linkedData: LinkedSelectionData
): boolean {
  return (
    !touchStart ||
    touchStart.moved ||
    event.pointerType !== 'touch' ||
    event.pointerId !== touchStart.pointerId ||
    Math.abs(event.clientX - touchStart.clientX) > 4 ||
    Math.abs(event.clientY - touchStart.clientY) > 4 ||
    linkedData.selectedRangeId === null ||
    Boolean(linkedData.activeRange) ||
    Boolean(linkedData.draggingRange) ||
    Boolean(linkedData.selectingText)
  )
}

function shouldIgnoreTouchPointerDown(
  event: ReactPointerEvent<HTMLDivElement>
): boolean {
  return event.pointerType !== 'touch' || !event.isPrimary
}

function resolveTextRangeTargetPageNumber(
  range: ReaderSelectionRange
): number | null {
  const startPageNumber = parsePublicPageId(range.start.selectionId)
  if (startPageNumber !== null) return startPageNumber

  for (const selectionId of Object.keys(range.rectsBySelectionId)) {
    const rectPageNumber = parsePublicPageId(selectionId)
    if (rectPageNumber !== null) return rectPageNumber
  }

  return parsePublicPageId(range.end.selectionId)
}

function useTouchTapSelection(
  runtimeLinkedDataRef: React.MutableRefObject<LinkedSelectionData>,
  handlePageLinkedSelectRange: (id: string | null) => void
) {
  const touchTapStartRef = useRef<TouchTapStart | null>(null)

  const handleTouchPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (shouldIgnoreTouchPointerDown(event)) {
        touchTapStartRef.current = null
        return
      }

      touchTapStartRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false
      }
    },
    []
  )

  const handleTouchPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const touchStart = touchTapStartRef.current
      if (
        touchStart &&
        event.pointerId === touchStart.pointerId &&
        (Math.abs(event.clientX - touchStart.clientX) > 4 ||
          Math.abs(event.clientY - touchStart.clientY) > 4)
      ) {
        touchStart.moved = true
      }
    },
    []
  )

  const handleTouchPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const touchStart = touchTapStartRef.current
      touchTapStartRef.current = null
      if (
        shouldIgnoreTouchPointerUp(
          touchStart,
          event,
          runtimeLinkedDataRef.current
        )
      ) {
        return
      }

      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          '.hsn-selection-popover, .hsn-selection-handle, button, a, input, textarea, select, option, label, summary, details, [role="button"], [contenteditable="true"]'
        )
      ) {
        return
      }

      const linkedData = runtimeLinkedDataRef.current
      const selectionContainers = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          '.hamster-reader__intermediate-text-page[data-selection-id], .hsn-selection-container[data-selection-id]'
        )
      )
      const touchedRangeId = findTouchedRangeIdByPoint(
        linkedData,
        event.clientX,
        event.clientY,
        selectionContainers
      )
      if (touchedRangeId) {
        if (touchedRangeId !== linkedData.selectedRangeId) {
          handlePageLinkedSelectRange(touchedRangeId)
        }
        return
      }

      const touchedHighlight = isPointOnHighlightElement(
        event.currentTarget,
        event.clientX,
        event.clientY
      )
      if (!touchedHighlight) {
        handlePageLinkedSelectRange(null)
      }
    },
    [handlePageLinkedSelectRange, runtimeLinkedDataRef]
  )

  const handleTouchPointerCancel = useCallback(() => {
    touchTapStartRef.current = null
  }, [])

  return {
    handleTouchPointerDown,
    handleTouchPointerMove,
    handleTouchPointerUp,
    handleTouchPointerCancel
  }
}

function useSelectionHighlight(
  pageNumbers: number[],
  runtimePageSelectionId: (pageNumber: number) => string,
  selectionRefsByRuntimeIdRef: React.MutableRefObject<Map<string, SelectionRef>>,
  runtimeLinkedDataRef: React.MutableRefObject<LinkedSelectionData>,
  lastActiveRangeRef: React.MutableRefObject<LinkedSelectionRange | null>,
  beginLinkedHighlightOperation: () => PendingLinkedHighlightOperation,
  handleLinkedDataChange: (data: LinkedSelectionData) => void,
  handleLinkedSelect: (range: LinkedSelectionRange) => void,
  handleLinkedSelectRange: (id: string | null) => void,
  schedulePendingLinkedHighlightCleanup: (
    operation: PendingLinkedHighlightOperation
  ) => void
) {
  const getFirstVisibleSelectionRef = useCallback(() => {
    for (const pageNumber of pageNumbers) {
      const selectionId = runtimePageSelectionId(pageNumber)
      const selectionRef = selectionRefsByRuntimeIdRef.current.get(selectionId)
      if (selectionRef) return selectionRef
    }

    return undefined
  }, [pageNumbers, runtimePageSelectionId, selectionRefsByRuntimeIdRef])

  const getActiveSelectionOwnerRef = useCallback(() => {
    const activeSelection = window.getSelection()
    if (!activeSelection || activeSelection.isCollapsed) return undefined

    const ownerSelectionIds = [
      getRuntimeSelectionIdFromSelectionNode(
        activeSelection.anchorNode,
        runtimePageSelectionId
      ),
      getRuntimeSelectionIdFromSelectionNode(
        activeSelection.focusNode,
        runtimePageSelectionId
      )
    ]

    for (const selectionId of ownerSelectionIds) {
      if (!selectionId) continue

      const selectionRef = selectionRefsByRuntimeIdRef.current.get(selectionId)
      if (selectionRef) return selectionRef
    }

    return ownerSelectionIds.some(Boolean) ? null : undefined
  }, [runtimePageSelectionId, selectionRefsByRuntimeIdRef])

  const getActiveLinkedRangeOwnerRef = useCallback(() => {
    const activeRange = runtimeLinkedDataRef.current.activeRange
    if (!activeRange) return undefined

    const ownerSelectionIds = [
      activeRange.start.selectionId,
      activeRange.end.selectionId
    ]

    for (const selectionId of ownerSelectionIds) {
      const selectionRef = selectionRefsByRuntimeIdRef.current.get(selectionId)
      if (selectionRef) return selectionRef
    }

    return null
  }, [runtimeLinkedDataRef, selectionRefsByRuntimeIdRef])

  const getActiveSelectionRef = useCallback(() => {
    const ownerSelectionRef = getActiveSelectionOwnerRef()
    const linkedRangeOwnerSelectionRef =
      ownerSelectionRef === undefined
        ? getActiveLinkedRangeOwnerRef()
        : ownerSelectionRef
    return linkedRangeOwnerSelectionRef === undefined
      ? getFirstVisibleSelectionRef()
      : linkedRangeOwnerSelectionRef
  }, [
    getActiveLinkedRangeOwnerRef,
    getActiveSelectionOwnerRef,
    getFirstVisibleSelectionRef
  ])

  const highlightSelection = useCallback(() => {
    const operation = beginLinkedHighlightOperation()
    const currentActiveRange = runtimeLinkedDataRef.current.activeRange ?? null
    const activeRange = currentActiveRange ?? lastActiveRangeRef.current
    const activeSelectionRef = getActiveSelectionRef()
    const nativeSelectionText = window.getSelection()?.toString() ?? ''
    const directActiveRange = nativeSelectionText.length === 0 && Boolean(activeRange)

    try {
      if (directActiveRange && activeRange) {
        if (
          runtimeLinkedDataRef.current.items.some(
            (item) => item.id === activeRange.id
          )
        ) {
          lastActiveRangeRef.current = null
          if (currentActiveRange) {
            const nextLinkedData = {
              ...runtimeLinkedDataRef.current,
              selectedRangeId: activeRange.id,
              activeRange: null
            }
            runtimeLinkedDataRef.current = nextLinkedData
            handleLinkedDataChange(nextLinkedData)
          }
          return
        }

        const nextLinkedData = {
          ...runtimeLinkedDataRef.current,
          items: [...runtimeLinkedDataRef.current.items, activeRange],
          selectedRangeId: activeRange.id,
          activeRange: null
        }
        lastActiveRangeRef.current = null
        runtimeLinkedDataRef.current = nextLinkedData
        handleLinkedDataChange(nextLinkedData)
        handleLinkedSelect(activeRange)
        handleLinkedSelectRange(activeRange.id)
        return
      }

      if (nativeSelectionText.length > 0) {
        lastActiveRangeRef.current = null
      }
      activeSelectionRef?.highlight()
    } finally {
      schedulePendingLinkedHighlightCleanup(operation)
    }
  }, [
    beginLinkedHighlightOperation,
    getActiveSelectionRef,
    handleLinkedDataChange,
    handleLinkedSelect,
    handleLinkedSelectRange,
    lastActiveRangeRef,
    runtimeLinkedDataRef,
    schedulePendingLinkedHighlightCleanup
  ])

  return { highlightSelection }
}

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
 * - linked selection 公开 props：当前由 Reader text branch 透传到此边界，
 *   后续文本 viewer 的 linked selection 状态机接入时会消费这些值。
 *
 * 文本模式不经过 `VirtualPaper`，因此不接受任何缩放、交互模式、矩形框选、
 * 绘制或 PageBrowser 相关 props。
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
  /** 受控 linked selection ranges；文本模式状态机接入后用于渲染已有高亮。 */
  ranges?: ReaderSelectionRange[]
  /** 非受控 linked selection 初始 ranges；文本模式状态机接入后用于初始化内部高亮。 */
  defaultRanges?: ReaderSelectionRange[]
  /** 受控选中 range id；文本模式状态机接入后用于高亮选中态与 popover ownership。 */
  selectedRangeId?: string | null
  /** 非受控初始选中 range id；文本模式状态机接入后用于初始化选中态。 */
  defaultSelectedRangeId?: string | null
  /** 用户确认新文本 range 时触发；文本模式状态机接入后会发送公开 page-N range。 */
  onSelect?: (range: ReaderSelectionRange) => void
  /** linked selection 数据变化时触发；文本模式状态机接入后会发送公开 page-N 数据。 */
  onLinkedDataChange?: (next: ReaderLinkedSelectionData) => void
  /** linked selection 选中新 range 时触发；文本模式状态机接入后会发送公开 page-N range。 */
  onLinkedSelect?: (range: ReaderSelectionRange) => void
  /** linked range 被拖拽更新时触发；文本模式状态机接入后会发送公开 page-N range。 */
  onLinkedUpdateRange?: (range: ReaderSelectionRange) => void
  /** linked selected range id 变化时触发；文本模式状态机接入后会发送公开 range id。 */
  onLinkedSelectRange?: (id: string | null) => void
  /** 公开 selected range id 变化回调；文本模式状态机接入后与 linked 选择同步触发。 */
  onSelectRange?: (id: string | null) => void
  /** 公开 range 更新回调；文本模式状态机接入后与 linked 更新同步触发。 */
  onUpdateRange?: (range: ReaderSelectionRange) => void
  /** linked selection 手势开始回调；文本模式状态机接入后由 Selection 包装层触发。 */
  onSelectionStart?: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  /** linked selection 手势结束回调；文本模式状态机接入后由 Selection 包装层触发。 */
  onSelectionEnd?: (mousePos: ReaderMousePosition, selection: Selection) => void
  /** 高亮确认回调；文本模式状态机接入后由 highlight/autoHighlight 触发。 */
  onHighlight?: (range: ReaderSelectionRange) => void
  /** linked selection 高亮颜色；文本模式状态机接入后传给 Selection 包装层。 */
  highlightColor?: string
  /** linked selection 活跃选区颜色；文本模式状态机接入后传给 Selection 包装层。 */
  selectionColor?: string
  /** 活跃选区 popover；文本模式状态机接入后传给 Selection 包装层。 */
  selectionPopover?: ReactNode
  /** 已存在高亮 popover；文本模式状态机接入后按当前高亮解析。 */
  highlightPopover?: ReaderHighlightPopover
  /** 默认高亮 popover 的评论入口；文本模式状态机接入后由 popover 按需调用。 */
  onCommentHighlight?: (highlight: ReaderSelectionRange) => Promise<ReaderSelectionRange>
  /** 自动确认高亮开关；文本模式状态机接入后在 selection end 时消费。 */
  autoHighlight?: boolean
  /** Reader 公开 selection ref；文本模式状态机接入后暴露 highlight/clear/scrollToRange。 */
  selectionRef?: Ref<ReaderSelectionRef>
  /** overlay 矩形坐标类型；文本模式状态机接入后传给 Selection 包装层。 */
  overlayRectType?: ReaderSelectionOverlayRectType
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
    maxLoadedPages,
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
    highlightColor,
    selectionColor,
    selectionPopover,
    highlightPopover,
    onCommentHighlight,
    autoHighlight,
    selectionRef,
    overlayRectType = 'percent'
  } = props

  // 原生滚动容器 ref —— useVirtualizer 通过 getScrollElement 读取其几何尺寸。
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [viewerRootElement, setViewerRootElement] =
    useState<HTMLDivElement | null>(null)
  const popoverContainerRef = useRef<HTMLElement | null>(null)
  const activeDocumentRef = useRef<IntermediateDocument | null>(null)
  const activePageNumbersKeyRef = useRef('')
  const isMountedRef = useRef(false)
  const loadingPagesRef = useRef(new Set<number>())
  const unloadTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>()
  )
  const previousVisiblePageNumbersRef = useRef(new Set<number>())
  const textsByPageNumberRef = useRef(new Map<number, IntermediateText[]>())

  // 选择追踪：镜像 layout 模式 — scrollContainer 既做滚动又做 viewer root
  const viewerRootRef = scrollContainerRef

  const setScrollRootRef = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element
    setViewerRootElement(element)
  }, [])

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

  const selectionScopeRef = useRef({
    runtimeDocument,
    pageNumbersKey,
    value: Symbol('intermediate-document-text-selection-scope')
  })
  if (
    selectionScopeRef.current.runtimeDocument !== runtimeDocument ||
    selectionScopeRef.current.pageNumbersKey !== pageNumbersKey
  ) {
    selectionScopeRef.current = {
      runtimeDocument,
      pageNumbersKey,
      value: Symbol('intermediate-document-text-selection-scope')
    }
  }
  const selectionScope = selectionScopeRef.current.value

  const isRangesControlled = ranges !== undefined
  const [internalRanges, setInternalRanges] = useState<ReaderSelectionRange[]>(
    () => defaultRanges ?? []
  )
  const effectiveRanges = isRangesControlled ? ranges : internalRanges
  const effectiveRangesRef = useRef<ReaderSelectionRange[]>(effectiveRanges)
  effectiveRangesRef.current = effectiveRanges

  const pendingLinkedHighlightOperationRef =
    useRef<PendingLinkedHighlightOperation | null>(null)
  const emittedLinkedSelectRangeIdsRef = useRef(new Set<string>())
  const emittedLinkedHighlightRangeIdsRef = useRef(new Set<string>())
  const pendingLinkedHighlightScopeRef = useRef(selectionScope)
  if (pendingLinkedHighlightScopeRef.current !== selectionScope) {
    pendingLinkedHighlightScopeRef.current = selectionScope
    pendingLinkedHighlightOperationRef.current = null
    emittedLinkedSelectRangeIdsRef.current.clear()
    emittedLinkedHighlightRangeIdsRef.current.clear()
  }

  const isSelectedRangeIdControlled = selectedRangeId !== undefined
  const [internalSelectedRangeId, setInternalSelectedRangeId] = useState<
    string | null
  >(defaultSelectedRangeId ?? null)
  const effectiveSelectedRangeId = isSelectedRangeIdControlled
    ? selectedRangeId
    : internalSelectedRangeId
  const selectedHighlight = useMemo(
    () =>
      effectiveSelectedRangeId
        ? (effectiveRanges.find(
            (range) => range.id === effectiveSelectedRangeId
          ) ?? null)
        : null,
    [effectiveRanges, effectiveSelectedRangeId]
  )
  const [commentingRangeId, setCommentingRangeId] = useState<string | null>(
    null
  )

  const [runtimeLinkedTransientState, setRuntimeLinkedTransientState] =
    useState<{
      readonly scope: symbol
      readonly transient: RuntimeLinkedSelectionTransient
    }>(() => ({ scope: selectionScope, transient: {} }))
  const runtimeLinkedTransient =
    runtimeLinkedTransientState.scope === selectionScope
      ? runtimeLinkedTransientState.transient
      : {}
  const runtimeLinkedData = useMemo(
    () =>
      buildRuntimeLinkedSelectionData({
        scopeId,
        ranges: effectiveRanges,
        selectedRangeId: effectiveSelectedRangeId,
        pageNumbers,
        overlayRectType,
        transient: runtimeLinkedTransient
      }),
    [
      effectiveRanges,
      effectiveSelectedRangeId,
      overlayRectType,
      pageNumbers,
      runtimeLinkedTransient,
      scopeId
    ]
  )
  const runtimeLinkedDataRef = useRef(runtimeLinkedData)
  runtimeLinkedDataRef.current = runtimeLinkedData
  const lastActiveRangeRef = useRef<LinkedSelectionRange | null>(
    runtimeLinkedData.activeRange ?? null
  )
  const lastActiveRangeScopeRef = useRef(selectionScope)
  if (lastActiveRangeScopeRef.current !== selectionScope) {
    lastActiveRangeScopeRef.current = selectionScope
    lastActiveRangeRef.current = runtimeLinkedData.activeRange ?? null
  } else if (runtimeLinkedData.activeRange) {
    lastActiveRangeRef.current = runtimeLinkedData.activeRange
  }
  const popoverOwnerRuntimeId = useMemo(() => {
    if (!selectedHighlight || !runtimeLinkedData.selectedRangeId) {
      return null
    }

    const selectedRuntimeRange = runtimeLinkedData.items.find(
      (range) => range.id === selectedHighlight.id
    )
    return selectedRuntimeRange ? selectedRuntimeRange.start.selectionId : null
  }, [runtimeLinkedData.items, runtimeLinkedData.selectedRangeId, selectedHighlight])

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
    }
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

  const selectionRefsByRuntimeIdRef = useRef(new Map<string, SelectionRef>())
  const selectionRefSettersByRuntimeIdRef = useRef(
    new Map<string, (node: SelectionRef | null) => void>()
  )
  const syncForwardedSelectionRefRef = useRef<() => void>(() => {})

  const selectionRefForRuntimeId = useCallback((selectionId: string) => {
    let setSelectionRef =
      selectionRefSettersByRuntimeIdRef.current.get(selectionId)
    if (!setSelectionRef) {
      setSelectionRef = (node: SelectionRef | null) => {
        if (node) {
          selectionRefsByRuntimeIdRef.current.set(selectionId, node)
        } else {
          selectionRefsByRuntimeIdRef.current.delete(selectionId)
        }

        syncForwardedSelectionRefRef.current()
      }
      selectionRefSettersByRuntimeIdRef.current.set(
        selectionId,
        setSelectionRef
      )
    }

    return setSelectionRef
  }, [])

  const beginLinkedHighlightOperation =
    useCallback((): PendingLinkedHighlightOperation => {
      const operation = new Set(
        effectiveRangesRef.current.map((range) => range.id)
      )
      pendingLinkedHighlightOperationRef.current = operation
      return operation
    }, [])

  const schedulePendingLinkedHighlightCleanup = useCallback(
    (operation: PendingLinkedHighlightOperation) => {
      const cleanup = () => {
        if (pendingLinkedHighlightOperationRef.current === operation) {
          pendingLinkedHighlightOperationRef.current = null
        }
      }

      const viewerWindow = viewerRootRef.current?.ownerDocument.defaultView
      if (viewerWindow) {
        viewerWindow.setTimeout(cleanup, 0)
        return
      }

      globalThis.setTimeout(cleanup, 0)
    },
    []
  )

  const emitLinkedSelectOnce = useCallback(
    (range: ReaderSelectionRange) => {
      if (emittedLinkedSelectRangeIdsRef.current.has(range.id)) {
        return
      }

      emittedLinkedSelectRangeIdsRef.current.add(range.id)
      onSelect?.(range)
    },
    [onSelect]
  )

  const emitPendingLinkedHighlight = useCallback(
    (range: ReaderSelectionRange) => {
      const pendingOperation = pendingLinkedHighlightOperationRef.current
      if (!pendingOperation || pendingOperation.has(range.id)) {
        return
      }

      pendingLinkedHighlightOperationRef.current = null
      if (emittedLinkedHighlightRangeIdsRef.current.has(range.id)) {
        return
      }

      emittedLinkedHighlightRangeIdsRef.current.add(range.id)
      onHighlight?.(range)
    },
    [onHighlight]
  )

  const handleLinkedDataChange = useCallback(
    (next: LinkedSelectionData) => {
      const publicLinkedData = mapRuntimeLinkedDataToPublic(next, scopeId)

      const nextTransient = extractRuntimeLinkedTransient(next)
      setRuntimeLinkedTransientState((currentState) => {
        if (
          currentState.scope === selectionScope &&
          areRuntimeLinkedTransientsEqual(currentState.transient, nextTransient)
        ) {
          return currentState
        }
        return { scope: selectionScope, transient: nextTransient }
      })
      onLinkedDataChange?.(publicLinkedData)

      if (!isRangesControlled) {
        setInternalRanges(publicLinkedData.items)
      }

      if (!isSelectedRangeIdControlled) {
        setInternalSelectedRangeId(publicLinkedData.selectedRangeId)
      }

      for (const range of publicLinkedData.items) {
        emitPendingLinkedHighlight(range)
        if (!pendingLinkedHighlightOperationRef.current) {
          break
        }
      }
    },
    [
      emitPendingLinkedHighlight,
      isRangesControlled,
      isSelectedRangeIdControlled,
      onLinkedDataChange,
      scopeId,
      selectionScope
    ]
  )

  const handleLinkedSelect = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, scopeId)

      if (publicRange) {
        onLinkedSelect?.(publicRange)
        emitLinkedSelectOnce(publicRange)
        emitPendingLinkedHighlight(publicRange)
      }
    },
    [emitLinkedSelectOnce, emitPendingLinkedHighlight, onLinkedSelect, scopeId]
  )

  const handleLinkedUpdateRange = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, scopeId)

      if (publicRange) {
        onLinkedUpdateRange?.(publicRange)
        onUpdateRange?.(publicRange)
      }
    },
    [onLinkedUpdateRange, onUpdateRange, scopeId]
  )

  const handleLinkedSelectRange = useCallback(
    (id: string | null) => {
      if (!isSelectedRangeIdControlled) {
        setInternalSelectedRangeId(id)
      }
      onLinkedSelectRange?.(id)
      onSelectRange?.(id)
    },
    [isSelectedRangeIdControlled, onLinkedSelectRange, onSelectRange]
  )

  const handlePageLinkedDataChange = useCallback(
    (next: LinkedSelectionData) => {
      runtimeLinkedDataRef.current = next
      if (next.activeRange) {
        lastActiveRangeRef.current = next.activeRange
      } else if (
        lastActiveRangeRef.current &&
        next.items.some((item) => item.id === lastActiveRangeRef.current?.id)
      ) {
        lastActiveRangeRef.current = null
      }
      handleLinkedDataChange(next)
    },
    [handleLinkedDataChange]
  )

  const handlePageLinkedSelectRange = useCallback(
    (id: string | null) => {
      const currentData = runtimeLinkedDataRef.current
      if (currentData.selectedRangeId !== id) {
        handlePageLinkedDataChange({
          ...currentData,
          selectedRangeId: id
        })
      }
      handleLinkedSelectRange(id)
    },
    [handleLinkedSelectRange, handlePageLinkedDataChange]
  )

  const {
    handleTouchPointerDown,
    handleTouchPointerMove,
    handleTouchPointerUp,
    handleTouchPointerCancel
  } = useTouchTapSelection(runtimeLinkedDataRef, handlePageLinkedSelectRange)

  const { highlightSelection } = useSelectionHighlight(
    pageNumbers,
    getRuntimePageSelectionId,
    selectionRefsByRuntimeIdRef,
    runtimeLinkedDataRef,
    lastActiveRangeRef,
    beginLinkedHighlightOperation,
    handlePageLinkedDataChange,
    handleLinkedSelect,
    handlePageLinkedSelectRange,
    schedulePendingLinkedHighlightCleanup
  )

  const scrollMountedTextPageIntoView = useCallback((pageNumber: number) => {
    const scrollIntoView = () => {
      const pageElement = scrollContainerRef.current?.querySelector<HTMLElement>(
        `[data-testid="intermediate-text-page-${pageNumber}"]`
      )
      pageElement?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
    }

    const viewerWindow = scrollContainerRef.current?.ownerDocument.defaultView
    if (viewerWindow) {
      viewerWindow.requestAnimationFrame(() => {
        viewerWindow.requestAnimationFrame(scrollIntoView)
        viewerWindow.setTimeout(scrollIntoView, 0)
      })
      return
    }

    globalThis.setTimeout(scrollIntoView, 0)
  }, [])

  const scrollToRange = useCallback(
    (rangeId: string) => {
      const range = effectiveRangesRef.current.find(
        (candidate) => candidate.id === rangeId
      )
      if (!range) return

      const pageNumber = resolveTextRangeTargetPageNumber(range)
      if (pageNumber === null) return

      const pageIndex = pageNumbers.indexOf(pageNumber)
      if (pageIndex === -1) return

      clearUnloadTimer(pageNumber)
      if (!textsByPageNumberRef.current.has(pageNumber)) {
        lazyPageQueueRef.current.enqueuePage(pageNumber)
      }

      virtualizer.scrollToIndex(pageIndex, { align: 'center' })
      scrollMountedTextPageIntoView(pageNumber)
    },
    [clearUnloadTimer, pageNumbers, scrollMountedTextPageIntoView, virtualizer]
  )

  const clearSelections = useCallback(() => {
    lastActiveRangeRef.current = null
    selectionRefsByRuntimeIdRef.current.forEach((selectionRefEntry) => {
      selectionRefEntry.clear()
    })

    if (!isRangesControlled) {
      setInternalRanges([])
    }

    if (!isSelectedRangeIdControlled) {
      setInternalSelectedRangeId(null)
    }

    const nextLinkedData: LinkedSelectionData = {
      ...runtimeLinkedDataRef.current,
      items: [],
      selectedRangeId: null,
      activeRange: null
    }
    runtimeLinkedDataRef.current = nextLinkedData
    handleLinkedDataChange(nextLinkedData)
  }, [handleLinkedDataChange, isRangesControlled, isSelectedRangeIdControlled])

  const publicSelectionRef = useMemo<ReaderSelectionRef>(
    () => ({
      highlight: highlightSelection,
      confirm: highlightSelection,
      confirmRect: () => {},
      clear: clearSelections,
      scrollToRange,
      scrollToRect: () => {},
      undo: () => false,
      redo: () => false,
      canUndo: () => false,
      canRedo: () => false,
      getAnnotationHistoryState: () => DISABLED_ANNOTATION_HISTORY_STATUS,
      scrollToPosition: ({ y }) => {
        scrollContainerRef.current?.scrollTo?.({ top: y, behavior: 'auto' })
      }
    }),
    [clearSelections, highlightSelection, scrollToRange]
  )

  const syncForwardedSelectionRef = useCallback(() => {
    const forwardedRef =
      selectionRefsByRuntimeIdRef.current.size > 0 ? publicSelectionRef : null

    if (typeof selectionRef === 'function') {
      selectionRef(forwardedRef)
    } else if (selectionRef) {
      selectionRef.current = forwardedRef
    }
  }, [publicSelectionRef, selectionRef])

  syncForwardedSelectionRefRef.current = syncForwardedSelectionRef

  useEffect(() => {
    syncForwardedSelectionRef()
    return () => {
      if (typeof selectionRef === 'function') {
        selectionRef(null)
      } else if (selectionRef) {
        selectionRef.current = null
      }
    }
  }, [selectionRef, syncForwardedSelectionRef])

  const handleSelectionStart = useCallback(
    (mousePos: ReaderMousePosition, selection: Selection) => {
      onSelectionStart?.(mousePos, selection)
    },
    [onSelectionStart]
  )

  const handleSelectionEnd = useCallback(
    (mousePos: ReaderMousePosition, selection: Selection) => {
      onSelectionEnd?.(mousePos, selection)
    },
    [onSelectionEnd]
  )

  const handleSelectionEndWrap = useCallback(
    (mousePos: ReaderMousePosition, selection: Selection) => {
      if (autoHighlight) {
        highlightSelection()
      }
      handleSelectionEnd(mousePos, selection)
    },
    [autoHighlight, handleSelectionEnd, highlightSelection]
  )

  const selectionStartHandler = onSelectionStart ? handleSelectionStart : undefined
  const selectionEndHandler =
    onSelectionEnd || autoHighlight ? handleSelectionEndWrap : undefined

  const handleViewerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      lastActiveRangeRef.current = null
      handleTouchPointerDown(event)
    },
    [handleTouchPointerDown]
  )

  const handleCommentHighlight = useCallback(() => {
    if (!selectedHighlight || !onCommentHighlight || commentingRangeId) return

    const highlight = selectedHighlight
    setCommentingRangeId(highlight.id)
    onCommentHighlight(highlight).then(
      () => {
        if (runtimeLinkedDataRef.current.selectedRangeId === highlight.id) {
          handlePageLinkedSelectRange(null)
        }
        setCommentingRangeId(null)
      },
      () => {
        setCommentingRangeId(null)
      }
    )
  }, [
    commentingRangeId,
    handlePageLinkedSelectRange,
    onCommentHighlight,
    selectedHighlight
  ])

  let resolvedHighlightPopover: ReactNode
  if (typeof highlightPopover === 'function') {
    resolvedHighlightPopover = selectedHighlight
      ? highlightPopover(selectedHighlight)
      : selectionPopover
  } else {
    resolvedHighlightPopover = highlightPopover ?? selectionPopover
  }
  const existingHighlightPopover =
    selectedHighlight && onCommentHighlight ? (
      <div className='hamster-reader__highlight-popover'>
        {resolvedHighlightPopover}
        <button
          type='button'
          className='hamster-reader__highlight-comment-button'
          disabled={commentingRangeId !== null}
          onClick={handleCommentHighlight}
        >
          评论
        </button>
      </div>
    ) : (
      resolvedHighlightPopover
    )

  useEffect(() => {
    popoverContainerRef.current = viewerRootElement
    return () => {
      popoverContainerRef.current = null
    }
  }, [viewerRootElement])

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
      ref={setScrollRootRef}
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
      onPointerDown={handleViewerPointerDown}
      onPointerMove={handleTouchPointerMove}
      onPointerUp={handleTouchPointerUp}
      onPointerCancel={handleTouchPointerCancel}
    >
      <RangeMagnifierProvider rootElement={viewerRootElement}>
        <TextSelectionMagnifier viewerRootElement={viewerRootElement} />
        {/* 内部 spacer：高度 = 虚拟化器累计总高度（inline），CSS 提供 position:relative */}
        <div
          className='hamster-reader__intermediate-text-spacer'
          style={{ height: virtualizer.getTotalSize() }}
        >
          {/* 仅渲染虚拟范围内的页面，不渲染任何非可见页占位 DOM */}
          {virtualItems.map((virtualItem) => {
            const pageNumber = pageNumbers[virtualItem.index]
            if (typeof pageNumber !== 'number') {
              return null
            }

            const texts = textsByPageNumber.get(pageNumber)
            const pageSelectionId = getRuntimePageSelectionId(pageNumber)
            const isPopoverOwner =
              popoverOwnerRuntimeId === null ||
              popoverOwnerRuntimeId === pageSelectionId
            const pagePopover = isPopoverOwner ? (
              <PopoverPortal
                containerRef={popoverContainerRef}
                selectionKind='selected'
                visible={true}
              >
                {existingHighlightPopover}
              </PopoverPortal>
            ) : undefined
            const pageSelectionPopover = isPopoverOwner ? (
              <PopoverPortal
                containerRef={popoverContainerRef}
                selectionKind='active'
                visible={true}
              >
                {selectionPopover}
              </PopoverPortal>
            ) : undefined
            return (
              <div
                key={pageNumber}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                data-page-number={pageNumber}
                data-selection-id={pageSelectionId}
                data-testid={`intermediate-text-page-${pageNumber}`}
                // SCSS .hamster-reader__intermediate-text-page 提供
                // position:absolute / top:0 / left:0 / width:100% / padding:5px，
                // 仅保留动态 transform（由 TanStack Virtual 计算）
                className='hamster-reader__intermediate-text-page'
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {texts ? (
                  <HamsterSelection
                    selectionId={pageSelectionId}
                    linkedMode
                    linkedData={runtimeLinkedData}
                    onLinkedDataChange={handlePageLinkedDataChange}
                    onLinkedSelect={handleLinkedSelect}
                    onLinkedUpdateRange={handleLinkedUpdateRange}
                    onLinkedSelectRange={handlePageLinkedSelectRange}
                    ranges={EMPTY_SELECTION_RANGES}
                    selectedRangeId={effectiveSelectedRangeId}
                    onSelect={undefined}
                    onSelectRange={undefined}
                    onUpdateRange={undefined}
                    onSelectionStart={selectionStartHandler}
                    onSelectionEnd={selectionEndHandler}
                    onHighlight={undefined}
                    highlightColor={highlightColor}
                    selectionColor={selectionColor}
                    popover={pagePopover}
                    selectionPopover={pageSelectionPopover}
                    overlayRectType={overlayRectType}
                    tool='text'
                    renderHandle={(handle) => (
                      <RangeHandle
                        handle={handle}
                        linkedData={runtimeLinkedData}
                        magnifierEnabled={handle.target === 'rect'}
                        scale={1}
                        selectionId={pageSelectionId}
                        viewerRoot={viewerRootElement}
                      />
                    )}
                    ref={selectionRefForRuntimeId(pageSelectionId)}
                  >
                    <IntermediateDocumentTextPageContent
                      key={pageNumber}
                      pageNumber={pageNumber}
                      texts={texts}
                      setTextRef={setTextRef}
                    />
                  </HamsterSelection>
                ) : (
                  <>Page {pageNumber}</>
                )}
              </div>
            )
          })}
        </div>
      </RangeMagnifierProvider>
    </div>
  )
}
