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
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'
import type { Virtualizer } from '@tanstack/react-virtual'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReactNode, PointerEvent as ReactPointerEvent, Ref } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
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
import { summarizeHighlightRanges, traceHighlight } from './highlightDebug'
import { IntermediateDocumentTextPageContent } from './IntermediateDocumentTextPageContent'
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
import { resolveHiddenPageNumbers } from './pageDisplay'
import { getPagePreloadWindow } from './pagePreloadWindow'
import { RangeHandle } from './RangeHandle'
import { RangeMagnifierProvider } from './RangeMagnifier'
import { parsePublicPageId } from './rangeJumpHelpers'
import type { IntermediateDocumentRenderTimingCallback } from './renderTiming'
import {
  areRuntimeLinkedTransientsEqual,
  buildRuntimeLinkedSelectionData,
  extractRuntimeLinkedTransient,
  mapRuntimeLinkedDataToPublic,
  mapRuntimeRangeToPublic,
  type RuntimeLinkedSelectionTransient,
  runtimePageSelectionId
} from './selectionAdapter'
import { TextReadingProgress } from './TextReadingProgress'
import { TextSelectionMagnifier } from './TextSelectionMagnifier'
import { useDerivedTextSelectionRanges } from './useDerivedTextSelectionRanges'
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

type TextReadingProgressSnapshot = {
  readonly currentPageNumber: number
  readonly isScrolling: boolean
  readonly progress: number
}

const DISABLED_ANNOTATION_HISTORY_STATUS = {
  enabled: false,
  canUndo: false,
  canRedo: false,
  pastCount: 0,
  futureCount: 0
} as const

type PendingLinkedHighlightOperation = ReadonlySet<string>

function useSelectionScope(
  runtimeDocument: IntermediateDocument | null,
  pageNumbersKey: string
): symbol {
  const scopeRef = useRef({
    runtimeDocument,
    pageNumbersKey,
    value: Symbol('intermediate-document-text-selection-scope')
  })
  if (
    scopeRef.current.runtimeDocument !== runtimeDocument ||
    scopeRef.current.pageNumbersKey !== pageNumbersKey
  ) {
    scopeRef.current = {
      runtimeDocument,
      pageNumbersKey,
      value: Symbol('intermediate-document-text-selection-scope')
    }
  }
  return scopeRef.current.value
}

function syncLastActiveRange(
  lastActiveRangeRef: React.MutableRefObject<LinkedSelectionRange | null>,
  scopeRef: React.MutableRefObject<symbol>,
  selectionScope: symbol,
  activeRange: LinkedSelectionRange | null | undefined
): void {
  if (scopeRef.current !== selectionScope) {
    scopeRef.current = selectionScope
    lastActiveRangeRef.current = activeRange ?? null
  } else if (activeRange) {
    lastActiveRangeRef.current = activeRange
  }
}

const getEffectiveTextMaxLoadedPages = (
  configuredMaxLoadedPages: number | undefined,
  protectedPageCount: number
) => {
  if (configuredMaxLoadedPages === Infinity) return Infinity
  if (
    typeof configuredMaxLoadedPages === 'number' &&
    Number.isFinite(configuredMaxLoadedPages) &&
    configuredMaxLoadedPages > 0
  ) {
    return Math.max(configuredMaxLoadedPages, protectedPageCount)
  }

  return Math.max(5, protectedPageCount)
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
  selectionRefsByRuntimeIdRef: React.MutableRefObject<
    Map<string, SelectionRef>
  >,
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
    const directActiveRange =
      nativeSelectionText.length === 0 && Boolean(activeRange)

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
 *   `pageLoadConcurrency`、`pageLoadEnterDelayMs`、`pagePreloadRadius`、`pageUnloadDelayMs`、
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
  isEpub?: boolean
  /** 当前文档是否为 PDF；文本模式据此启用基于 box 的段落重建。 */
  isPdf?: boolean
  /** 已序列化的中间文档；与 `document` 二选一，文本模式同样支持。 */
  serializedDocument?: IntermediateDocumentSerialized | null
  className?: string
  fontScale?: ReaderFontScale
  pageRange?: ReaderPageRange
  /** 需要从文本阅读流中排除的 1-based 页码或公开 PageId。 */
  hiddenPages?: readonly (number | string)[]
  /** 初始立即加载的页数，默认 `1`。 */
  initialLoadedPages?: number
  /** 并发加载页数上限，默认 `3`。 */
  pageLoadConcurrency?: number
  /** 页面进入可加载窗口后、发起加载前的延迟（毫秒），默认 `500`。 */
  pageLoadEnterDelayMs?: number
  /** 可见页前后预加载的页数，默认前后各 `3` 页。 */
  pagePreloadRadius?: number
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
  /** 是否启用选区端点放大镜，默认 false。 */
  showSelectionMagnifier?: boolean
  /** 活跃选区 popover；文本模式状态机接入后传给 Selection 包装层。 */
  selectionPopover?: ReactNode
  /** 已存在高亮 popover；文本模式状态机接入后按当前高亮解析。 */
  highlightPopover?: ReaderHighlightPopover
  /** 默认高亮 popover 的评论入口；文本模式状态机接入后由 popover 按需调用。 */
  onCommentHighlight?: (
    highlight: ReaderSelectionRange
  ) => Promise<ReaderSelectionRange>
  /** 自动确认高亮开关；文本模式状态机接入后在 selection end 时消费。 */
  autoHighlight?: boolean
  /** Reader 公开 selection ref；文本模式状态机接入后暴露 highlight/clear/scrollToRange。 */
  selectionRef?: Ref<ReaderSelectionRef>
  /** overlay 矩形坐标类型；文本模式状态机接入后传给 Selection 包装层。 */
  overlayRectType?: ReaderSelectionOverlayRectType
  /** Popover 使用相对定位（absolute）相对于容器，而非 fixed 相对于 window */
  popoverRelative?: boolean
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
    isEpub = false,
    isPdf = false,
    serializedDocument,
    className,
    fontScale,
    pageRange,
    hiddenPages,
    initialLoadedPages = 1,
    pageLoadConcurrency = 3,
    pageLoadEnterDelayMs = 500,
    pagePreloadRadius = 3,
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
    showSelectionMagnifier = false,
    selectionPopover,
    highlightPopover,
    onCommentHighlight,
    autoHighlight,
    selectionRef,
    overlayRectType = 'percent',
    popoverRelative
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
  const preloadEnterTimersRef = useRef(
    new Map<number, ReturnType<typeof setTimeout>>()
  )
  const previousPreloadPageNumbersRef = useRef(new Set<number>())
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
  const [paragraphsByPageNumber, setParagraphsByPageNumber] = useState(
    () => new Map<number, IntermediateParagraph[]>()
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
    const hiddenPageNumbers = resolveHiddenPageNumbers(hiddenPages)
    return getVisiblePageNumbers(allPageNumbers, pageRange).filter(
      (pageNumber) => !hiddenPageNumbers.has(pageNumber)
    )
  }, [hiddenPages, runtimeDocument, pageRange])
  const pageNumbersKey = useMemo(() => pageNumbers.join(','), [pageNumbers])

  const selectionScope = useSelectionScope(runtimeDocument, pageNumbersKey)

  const isRangesControlled = ranges !== undefined
  const [internalRanges, setInternalRanges] = useState<ReaderSelectionRange[]>(
    () => defaultRanges ?? []
  )
  const [readingProgress, setReadingProgress] =
    useState<TextReadingProgressSnapshot>(() => ({
      currentPageNumber: pageNumbers[0] ?? 0,
      isScrolling: false,
      progress: 0
    }))
  const handleVirtualizerChange = useCallback(
    (instance: Virtualizer<HTMLDivElement, HTMLElement>, sync: boolean) => {
      const scrollOffset = instance.scrollOffset ?? 0
      const viewportHeight =
        instance.scrollRect?.height ?? instance.scrollElement?.clientHeight ?? 0
      const maximumScrollOffset = Math.max(
        0,
        instance.getTotalSize() - viewportHeight
      )
      const currentItem = instance.getVirtualItemForOffset(scrollOffset)
      const currentPageNumber =
        pageNumbers[currentItem?.index ?? 0] ?? pageNumbers[0] ?? 0
      const progress =
        maximumScrollOffset > 0 ? scrollOffset / maximumScrollOffset : 0

      setReadingProgress((current) => {
        if (
          current.currentPageNumber === currentPageNumber &&
          current.isScrolling === sync &&
          current.progress === progress
        ) {
          return current
        }
        return { currentPageNumber, isScrolling: sync, progress }
      })
    },
    [pageNumbers]
  )
  // TanStack Virtual 虚拟化器：count = pageNumbers.length，
  // estimateSize 用稳定的 800px 直到 measureElement 测得真实高度，
  // getItemKey 直接用真实页码（稳定 key，避免页码/索引错位），
  // overscan: 0 严格保证只渲染可见视口内的页面 DOM。
  // measureElement 选项：无文本页只渲染很矮的 "Page N" 占位内容，不能把
  // 这个临时高度写回虚拟化器，否则累计总高度会持续塌缩并把全部页面拉进
  // 可视范围。有文本内容后 ResizeObserver 会再次测量并写入真实高度。
  const virtualizer = useVirtualizer({
    count: pageNumbers.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => TEXT_PAGE_ESTIMATED_HEIGHT,
    getItemKey: (index) => pageNumbers[index],
    overscan: 0,
    onChange: handleVirtualizerChange,
    measureElement: (el) => {
      if (el.getAttribute('data-page-measurable') !== 'true') {
        return TEXT_PAGE_ESTIMATED_HEIGHT
      }
      const measured = el.getBoundingClientRect().height
      return measured > 0 ? measured : TEXT_PAGE_ESTIMATED_HEIGHT
    }
  })

  const virtualItems = virtualizer.getVirtualItems()
  const handleReadingProgressSeek = useCallback(
    (progress: number) => {
      const viewportHeight =
        virtualizer.scrollRect?.height ??
        scrollContainerRef.current?.clientHeight ??
        0
      const maximumScrollOffset = Math.max(
        0,
        virtualizer.getTotalSize() - viewportHeight
      )
      virtualizer.scrollToOffset(progress * maximumScrollOffset, {
        align: 'start',
        behavior: 'auto'
      })
    },
    [virtualizer]
  )
  const visiblePageNumbers = useMemo(
    () =>
      virtualItems
        .map((item) => pageNumbers[item.index])
        .filter(
          (pageNumber): pageNumber is number => typeof pageNumber === 'number'
        ),
    [virtualItems, pageNumbers]
  )
  const textLayoutKey = `${fontScale ?? 'default'}:${Array.from(
    textsByPageNumber.keys()
  ).join(',')}:${visiblePageNumbers.join(',')}`
  const storedRanges = isRangesControlled ? ranges : internalRanges
  const effectiveRanges = useDerivedTextSelectionRanges({
    ranges: storedRanges,
    root: viewerRootElement,
    pageNumbers,
    overlayRectType,
    layoutKey: textLayoutKey
  })
  const effectiveRangesRef = useRef<ReaderSelectionRange[]>(effectiveRanges)
  effectiveRangesRef.current = effectiveRanges
  const lastTextGeometryTraceRef = useRef('')
  useEffect(() => {
    const detail = {
      mode: 'text',
      isEpub,
      layoutKey: textLayoutKey,
      hasRoot: viewerRootElement !== null,
      pageNumbers,
      visiblePageNumbers,
      storedRanges: summarizeHighlightRanges(storedRanges),
      effectiveRanges: summarizeHighlightRanges(effectiveRanges)
    }
    const signature = JSON.stringify(detail)
    if (lastTextGeometryTraceRef.current === signature) return
    lastTextGeometryTraceRef.current = signature
    traceHighlight('text.geometry', detail)
  }, [
    effectiveRanges,
    isEpub,
    pageNumbers,
    storedRanges,
    textLayoutKey,
    viewerRootElement,
    visiblePageNumbers
  ])
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
    ? (selectedRangeId ?? null)
    : internalSelectedRangeId
  const selectedHighlight = useMemo(
    () =>
      effectiveSelectedRangeId
        ? (storedRanges.find(
            (range) => range.id === effectiveSelectedRangeId
          ) ?? null)
        : null,
    [effectiveSelectedRangeId, storedRanges]
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
  syncLastActiveRange(
    lastActiveRangeRef,
    lastActiveRangeScopeRef,
    selectionScope,
    runtimeLinkedData.activeRange
  )
  const popoverOwnerRuntimeId = useMemo(() => {
    if (!selectedHighlight || !runtimeLinkedData.selectedRangeId) {
      return null
    }

    const selectedRuntimeRange = runtimeLinkedData.items.find(
      (range) => range.id === selectedHighlight.id
    )
    return selectedRuntimeRange ? selectedRuntimeRange.start.selectionId : null
  }, [
    runtimeLinkedData.items,
    runtimeLinkedData.selectedRangeId,
    selectedHighlight
  ])

  const preloadPageNumbers = useMemo(
    () =>
      getPagePreloadWindow(pageNumbers, visiblePageNumbers, pagePreloadRadius),
    [pageNumbers, pagePreloadRadius, visiblePageNumbers]
  )
  const preloadPageNumberSet = useMemo(
    () => new Set(preloadPageNumbers),
    [preloadPageNumbers]
  )

  const cancelPreloadEnter = useCallback((pageNumber: number) => {
    const timer = preloadEnterTimersRef.current.get(pageNumber)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    preloadEnterTimersRef.current.delete(pageNumber)
  }, [])

  const clearAllPreloadEnterTimers = useCallback(() => {
    preloadEnterTimersRef.current.forEach((timer) => {
      clearTimeout(timer)
    })
    preloadEnterTimersRef.current.clear()
  }, [])

  const schedulePreloadEnter = useCallback((pageNumber: number) => {
    if (preloadEnterTimersRef.current.has(pageNumber)) {
      return
    }
    const timer = setTimeout(() => {
      preloadEnterTimersRef.current.delete(pageNumber)
      if (!isMountedRef.current) {
        return
      }
      lazyPageQueueRef.current.enqueuePage(pageNumber)
    }, lazyQueueConfigRef.current.pageLoadEnterDelayMs)
    preloadEnterTimersRef.current.set(pageNumber, timer)
  }, [])

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
        preloadPageNumberSet.size
      )
      if (!Number.isFinite(cap) || loadedTexts.size <= cap) {
        return loadedTexts
      }

      const nextTexts = new Map(loadedTexts)
      for (const pageNumber of nextTexts.keys()) {
        if (nextTexts.size <= cap) {
          break
        }
        if (!preloadPageNumberSet.has(pageNumber)) {
          nextTexts.delete(pageNumber)
          clearUnloadTimer(pageNumber)
        }
      }
      return nextTexts
    },
    [clearUnloadTimer, maxLoadedPages, preloadPageNumberSet]
  )

  const lazyPageQueue = useLazyPageQueue(lazyQueueConfigRef, runtimeDocument, {
    mode: 'text',
    activeDocumentRef,
    isMountedRef,
    loadingPagesRef,
    getPageContentEntries: getTextContentEntries,
    isIntermediateText,
    callbacks: {
      onPageLoaded: ({ pageNumber, texts, paragraphs }) => {
        clearUnloadTimer(pageNumber)
        setParagraphsByPageNumber((currentParagraphs) => {
          const nextParagraphs = new Map(currentParagraphs)
          nextParagraphs.set(pageNumber, paragraphs)
          return nextParagraphs
        })
        setTextsByPageNumber((currentTexts) => {
          const nextTexts = new Map(currentTexts)
          nextTexts.set(pageNumber, texts)
          return applyLoadedPageLimit(nextTexts)
        })
      },
      onPageError: (pageNumber) => {
        clearUnloadTimer(pageNumber)
        setParagraphsByPageNumber((currentParagraphs) => {
          const nextParagraphs = new Map(currentParagraphs)
          nextParagraphs.set(pageNumber, [])
          return nextParagraphs
        })
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
    setParagraphsByPageNumber((currentParagraphs) => {
      if (!currentParagraphs.has(pageNumber)) {
        return currentParagraphs
      }
      const nextParagraphs = new Map(currentParagraphs)
      nextParagraphs.delete(pageNumber)
      return nextParagraphs
    })
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

  const toTextRange = useCallback(
    (range: ReaderSelectionRange): ReaderSelectionRange => ({
      ...range,
      rectsBySelectionId: {}
    }),
    []
  )

  const handleLinkedDataChange = useCallback(
    (next: LinkedSelectionData) => {
      const runtimePublicLinkedData = mapRuntimeLinkedDataToPublic(
        next,
        scopeId
      )
      const publicLinkedData: ReaderLinkedSelectionData = {
        ...runtimePublicLinkedData,
        items: runtimePublicLinkedData.items.map(toTextRange),
        activeRange: runtimePublicLinkedData.activeRange
          ? toTextRange(runtimePublicLinkedData.activeRange)
          : runtimePublicLinkedData.activeRange
      }
      traceHighlight('text.callback.linked-data', {
        mode: 'text',
        isEpub,
        selectedRangeId: publicLinkedData.selectedRangeId,
        ranges: summarizeHighlightRanges(publicLinkedData.items)
      })

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
      isEpub,
      scopeId,
      selectionScope,
      toTextRange
    ]
  )

  const handleLinkedSelect = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, scopeId)

      if (publicRange) {
        const textRange = toTextRange(publicRange)
        traceHighlight('text.callback.select', {
          mode: 'text',
          isEpub,
          ranges: summarizeHighlightRanges([textRange])
        })
        onLinkedSelect?.(textRange)
        emitLinkedSelectOnce(textRange)
        emitPendingLinkedHighlight(textRange)
      }
    },
    [
      emitLinkedSelectOnce,
      emitPendingLinkedHighlight,
      onLinkedSelect,
      isEpub,
      scopeId,
      toTextRange
    ]
  )

  const handleLinkedUpdateRange = useCallback(
    (range: LinkedSelectionRange) => {
      const publicRange = mapRuntimeRangeToPublic(range, scopeId)

      if (publicRange) {
        const textRange = toTextRange(publicRange)
        traceHighlight('text.callback.update', {
          mode: 'text',
          isEpub,
          ranges: summarizeHighlightRanges([textRange])
        })
        if (!isRangesControlled) {
          setInternalRanges((currentRanges) =>
            currentRanges.map((currentRange) =>
              currentRange.id === textRange.id ? textRange : currentRange
            )
          )
        }
        onLinkedUpdateRange?.(textRange)
        onUpdateRange?.(textRange)
      }
    },
    [
      isRangesControlled,
      isEpub,
      onLinkedUpdateRange,
      onUpdateRange,
      scopeId,
      toTextRange
    ]
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
      const pageElement =
        scrollContainerRef.current?.querySelector<HTMLElement>(
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
    if (typeof selectionRef === 'function') {
      selectionRef(publicSelectionRef)
    } else if (selectionRef) {
      selectionRef.current = publicSelectionRef
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

  const selectionStartHandler = onSelectionStart
    ? handleSelectionStart
    : undefined
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
      clearAllPreloadEnterTimers()
      clearAllUnloadTimers()
      lazyPageQueueRef.current.cancelAll()
    }
  }, [clearAllPreloadEnterTimers, clearAllUnloadTimers])

  useEffect(() => {
    activeDocumentRef.current = runtimeDocument
    activePageNumbersKeyRef.current = pageNumbersKey
    previousPreloadPageNumbersRef.current = new Set()
    textsByPageNumberRef.current = new Map()
    textElementsRef.current.clear()
    setTextsByPageNumber(new Map())
    setParagraphsByPageNumber(new Map())
    clearAllPreloadEnterTimers()
    clearAllUnloadTimers()
    lazyPageQueueRef.current.cancelAll()
  }, [
    runtimeDocument,
    pageNumbersKey,
    clearAllPreloadEnterTimers,
    clearAllUnloadTimers
  ])

  useEffect(() => {
    if (!runtimeDocument || preloadPageNumbers.length === 0) {
      return
    }

    const previousPreloadPages = previousPreloadPageNumbersRef.current
    const currentPreloadPages = new Set(preloadPageNumbers)
    const isInitialPreloadSet = previousPreloadPages.size === 0

    currentPreloadPages.forEach((pageNumber) => {
      clearUnloadTimer(pageNumber)
    })

    if (isInitialPreloadSet) {
      lazyPageQueueRef.current.cancelAll()
      lazyPageQueueRef.current.enqueueInitialPages(preloadPageNumbers)
      preloadPageNumbers.forEach((pageNumber) => {
        lazyPageQueueRef.current.enqueuePage(pageNumber)
      })
    } else {
      currentPreloadPages.forEach((pageNumber) => {
        if (!previousPreloadPages.has(pageNumber)) {
          schedulePreloadEnter(pageNumber)
        }
      })
    }

    previousPreloadPages.forEach((pageNumber) => {
      if (currentPreloadPages.has(pageNumber)) {
        return
      }
      cancelPreloadEnter(pageNumber)
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

    previousPreloadPageNumbersRef.current = currentPreloadPages
  }, [
    clearUnloadTimer,
    cancelPreloadEnter,
    removeLoadedTextPage,
    runtimeDocument,
    preloadPageNumbers,
    schedulePreloadEnter
  ])

  useEffect(() => {
    setTextsByPageNumber((currentTexts) => applyLoadedPageLimit(currentTexts))
  }, [applyLoadedPageLimit])

  useEffect(() => {
    setParagraphsByPageNumber((currentParagraphs) => {
      const hasEvictedPage = Array.from(currentParagraphs.keys()).some(
        (pageNumber) => !textsByPageNumber.has(pageNumber)
      )
      if (!hasEvictedPage) {
        return currentParagraphs
      }

      return new Map(
        Array.from(currentParagraphs.entries()).filter(([pageNumber]) =>
          textsByPageNumber.has(pageNumber)
        )
      )
    })
  }, [textsByPageNumber])

  // 文档标题用于无障碍标签；缺失时回退到静态文案。
  const title = runtimeDocument?.title

  return (
    <div className='hamster-reader__intermediate-text-shell'>
      {pageNumbers.length > 0 ? (
        <TextReadingProgress
          currentPageNumber={readingProgress.currentPageNumber}
          isScrolling={readingProgress.isScrolling}
          maximumPageNumber={pageNumbers.at(-1) ?? 0}
          minimumPageNumber={pageNumbers[0] ?? 0}
          pageCount={pageNumbers.length}
          progress={readingProgress.progress}
          onSeek={handleReadingProgressSeek}
        />
      ) : null}
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
        <RangeMagnifierProvider
          enabled={showSelectionMagnifier}
          rootElement={viewerRootElement}
        >
          {showSelectionMagnifier ? (
            <TextSelectionMagnifier viewerRootElement={viewerRootElement} />
          ) : null}
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
              const paragraphs = paragraphsByPageNumber.get(pageNumber) ?? []
              const pageSelectionId = getRuntimePageSelectionId(pageNumber)
              const isPopoverOwner =
                popoverOwnerRuntimeId === null ||
                popoverOwnerRuntimeId === pageSelectionId
              const pagePopover = isPopoverOwner ? (
                <PopoverPortal
                  containerRef={popoverContainerRef}
                  selectionKind='selected'
                  visible={true}
                  relative={popoverRelative}
                >
                  {existingHighlightPopover}
                </PopoverPortal>
              ) : undefined
              const pageSelectionPopover = isPopoverOwner ? (
                <PopoverPortal
                  containerRef={popoverContainerRef}
                  selectionKind='active'
                  visible={true}
                  relative={popoverRelative}
                >
                  {selectionPopover}
                </PopoverPortal>
              ) : undefined
              return (
                <div
                  key={pageNumber}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  data-page-measurable={texts !== undefined && texts.length > 0}
                  data-page-number={pageNumber}
                  data-selection-id={pageSelectionId}
                  data-testid={`intermediate-text-page-${pageNumber}`}
                  // SCSS .hamster-reader__intermediate-text-page 提供
                  // position:absolute / top:0 / left:0 / width:100% / padding:5px，
                  // 仅保留动态 transform（由 TanStack Virtual 计算）
                  className={`hamster-reader__intermediate-text-page${
                    virtualItem.index > 0
                      ? ' hamster-reader__intermediate-text-page--following'
                      : ''
                  }`}
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
                          magnifierEnabled={
                            showSelectionMagnifier && handle.target === 'rect'
                          }
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
                        paragraphs={paragraphs}
                        isPdf={isPdf}
                        setTextRef={setTextRef}
                        fontScale={fontScale}
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
    </div>
  )
}
