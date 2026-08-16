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
  IntermediateImage,
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'
import type {
  ReactNode,
  PointerEvent as ReactPointerEvent,
  Ref,
  RefObject
} from 'react'
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import type {
  ReaderBookmark,
  ReaderTextAnchor,
  ReaderTextReadingProgress
} from '../../types/readerData'
import type {
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderMousePosition,
  ReaderSelectionOverlayRectType,
  ReaderSelectionPopover,
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
  ReaderReadingPositionHandle,
  ReaderTextSelectionDetail
} from './IntermediateDocumentViewer'
import {
  getPageContentEntries,
  getRuntimeDocument,
  getVisiblePageNumbers,
  isIntermediateImage,
  isIntermediateText
} from './IntermediateDocumentViewer'
import { PageBrowser } from './PageBrowser'
import { resolveHiddenPageNumbers } from './pageDisplay'
import { canonicalizePdfSelectionRange } from './pdfSelectionOffsets'
import { ReadingProgress } from './ReadingProgress'
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
import {
  findTextAnchorAtOrBelow,
  findTopTextAnchor,
  getActiveBookmarkKey,
  getBookmarkKey,
  getTextAnchorKey,
  hasAnchorableText,
  isTextBookmark,
  resolveBookmarkNavigationHandler,
  resolveTextAnchorElement,
  type TextAnchorElementRecord
} from './textAnchor'
import { deriveDomSelectionPageRects } from './textHighlightAdapter'
import {
  getTextPagePreloadWindow,
  getTextPageWindow,
  getTextPageWindowSize
} from './textPageWindow'
import { useDerivedTextSelectionRanges } from './useDerivedTextSelectionRanges'
import { useHighlightDrag } from './useHighlightDrag'
import type { LazyPageQueueConfig } from './useLazyPageQueue'
import { useLazyPageQueue } from './useLazyPageQueue'
import { useReadingProgressActivity } from './useReadingProgressActivity'

const DEFAULT_TEXT_PAGE_UNLOAD_DELAY_MS = 5000

const EMPTY_SELECTION_RANGES: SelectionRange[] = []

const TEXT_PAGE_FALLBACK_SIZE = { width: 595, height: 842 } as const

const EMPTY_TEXT_PAGE_IMAGES = new Map<number, string>()

const handleTextPageBrowserVisibilityChange = () => {}

const textDocumentRenderKeys = new WeakMap<IntermediateDocument, number>()
let nextTextDocumentRenderKey = 1

const getTextDocumentRenderKey = (
  document: IntermediateDocument | null
): number => {
  if (document === null) return 0
  const existingKey = textDocumentRenderKeys.get(document)
  if (existingKey !== undefined) return existingKey
  const nextKey = nextTextDocumentRenderKey
  nextTextDocumentRenderKey += 1
  textDocumentRenderKeys.set(document, nextKey)
  return nextKey
}

type TextReadingProgressSnapshot = {
  readonly currentPageNumber: number
  readonly anchor?: ReaderTextAnchor
}

type TextAnchorRestoreRequest = {
  readonly token: number
  readonly documentGeneration: symbol
  readonly anchorKey: string
  readonly source: 'bookmark' | 'restore'
}

type PendingTextAnchorRestore = {
  readonly anchor: ReaderTextAnchor
  readonly request: TextAnchorRestoreRequest
}

type PendingTextRangeNavigation = {
  readonly rangeId: string
  readonly pageNumber: number
  readonly navigationGeneration: number
  readonly documentGeneration: symbol
  readonly windowPageNumbers: readonly number[]
}

type PendingTextWindowAlignment = {
  readonly pageNumber: number
  readonly alignment: 'start' | 'end'
  readonly navigationGeneration: number
  readonly documentGeneration: symbol
  readonly windowPageNumbers: readonly number[]
  readonly pageProgress: number
}

function getTextReadingProgressKey(
  progress: TextReadingProgressSnapshot
): string {
  return progress.anchor
    ? getTextAnchorKey(progress.anchor)
    : `${progress.currentPageNumber}:page`
}

function resolveSelectionPopover(
  selectionPopover: ReaderSelectionPopover | undefined,
  activeRange: LinkedSelectionRange | null | undefined,
  scopeId: string,
  toSelection: (range: ReaderSelectionRange) => ReaderSelectionRange | null
): ReactNode {
  if (typeof selectionPopover !== 'function') {
    return selectionPopover
  }

  if (!activeRange) {
    return undefined
  }

  const publicRange = mapRuntimeRangeToPublic(activeRange, scopeId)
  const selection = publicRange ? toSelection(publicRange) : null
  return selection ? selectionPopover(selection) : undefined
}

const useDocumentGeneration = (
  runtimeDocument: object | null,
  pageNumbersKey: string
): symbol =>
  useMemo(
    () =>
      Symbol(
        `${pageNumbersKey}:${runtimeDocument === null ? 'empty' : 'document'}`
      ),
    [pageNumbersKey, runtimeDocument]
  )

function useInvalidateRestoreRequest(
  controlledProgressIdentity: string,
  activeRestoreRequestRef: RefObject<TextAnchorRestoreRequest | null>,
  restoreRequestTokenRef: RefObject<number>
): void {
  const previousIdentityRef = useRef(controlledProgressIdentity)
  useLayoutEffect(() => {
    if (previousIdentityRef.current === controlledProgressIdentity) return

    previousIdentityRef.current = controlledProgressIdentity
    if (
      activeRestoreRequestRef.current?.anchorKey !== controlledProgressIdentity
    ) {
      restoreRequestTokenRef.current += 1
      activeRestoreRequestRef.current = null
    }
  }, [
    activeRestoreRequestRef,
    controlledProgressIdentity,
    restoreRequestTokenRef
  ])
}

function useDocumentGenerationChange(
  documentGeneration: symbol,
  onChange: () => void
): void {
  const appliedGenerationRef = useRef(documentGeneration)
  useLayoutEffect(() => {
    if (appliedGenerationRef.current === documentGeneration) return
    appliedGenerationRef.current = documentGeneration
    onChange()
  }, [documentGeneration, onChange])
}

function resolveRequestedTextReadingProgress(
  progress: ReaderTextReadingProgress | undefined,
  pageNumbers: readonly number[]
): ReaderTextReadingProgress | null {
  const pageNumber = progress?.currentPageNumber
  if (typeof pageNumber !== 'number' || !pageNumbers.includes(pageNumber)) {
    return null
  }
  const anchor =
    progress?.anchor?.pageNumber === pageNumber ? progress.anchor : undefined
  return anchor
    ? { currentPageNumber: pageNumber, anchor }
    : { currentPageNumber: pageNumber }
}

function getRequestedProgressIdentity(
  progress: ReaderTextReadingProgress | null
): string {
  return progress ? getTextReadingProgressKey(progress) : ''
}

function getInitialTextReadingProgress(
  persistedProgress: ReaderTextReadingProgress | undefined,
  pageNumbers: readonly number[]
): TextReadingProgressSnapshot {
  const currentPageNumber =
    persistedProgress &&
    pageNumbers.includes(persistedProgress.currentPageNumber)
      ? persistedProgress.currentPageNumber
      : (pageNumbers[0] ?? 0)
  const anchor = persistedProgress?.anchor
  if (anchor?.pageNumber === currentPageNumber) {
    return { currentPageNumber, anchor }
  }
  return { currentPageNumber }
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
  return useMemo(
    () =>
      Symbol(
        `${pageNumbersKey}:${runtimeDocument === null ? 'empty' : 'document'}:selection`
      ),
    [runtimeDocument, pageNumbersKey]
  )
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

        // Text page 负责公开 runtime selection id，而 Selection 内层容器负责
        // 百分比 overlay 的实际坐标系；二者在真实浏览器中边界并不相同。
        const overlayContainer = container.matches(
          '.hamster-reader__intermediate-text-page'
        )
          ? (container.querySelector<HTMLElement>('.hsn-selection-container') ??
            container)
          : container
        const bounds = overlayContainer.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) return false

        const localX =
          rectType === 'percent'
            ? ((clientX - bounds.left) / bounds.width) * 100
            : ((clientX - bounds.left) / bounds.width) *
              (overlayContainer.clientWidth || bounds.width)
        const localY =
          rectType === 'percent'
            ? ((clientY - bounds.top) / bounds.height) * 100
            : ((clientY - bounds.top) / bounds.height) *
              (overlayContainer.clientHeight || bounds.height)
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

function completeHighlightPointerUp(
  event: ReactPointerEvent<HTMLDivElement>,
  finishHighlightDrag: (event: ReactPointerEvent<HTMLDivElement>) => boolean,
  finishTouchTap: (event: ReactPointerEvent<HTMLDivElement>) => void
): void {
  if (!finishHighlightDrag(event)) finishTouchTap(event)
}

function getHighlightDragClassNames(
  suppressNativeSelection: boolean,
  activePointerType: string | null
): string[] {
  const classNames: string[] = []
  if (suppressNativeSelection) {
    classNames.push(
      'hamster-reader__intermediate-document-viewer--suppress-native-selection'
    )
  }
  if (activePointerType !== null) {
    classNames.push(
      'hamster-reader__intermediate-document-viewer--highlight-dragging'
    )
  }
  return classNames
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
 * 文本模式不经过 `VirtualPaper`，因此不接受任何缩放、交互模式、矩形框选或
 * 绘制相关 props；页面浏览侧栏则与布局模式共用书签和文本高亮数据。
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
  /** 文本滚动视口的水平内容安全边距。 */
  containMarginX?: number
  /** 文本滚动视口的顶部内容安全边距。 */
  containMarginTop?: number
  /** 文本滚动视口的底部内容安全边距。 */
  containMarginBottom?: number
  /** @deprecated 请分别使用 containMarginTop / containMarginBottom。 */
  containMarginY?: number
  /** 是否显示页面、文本高亮和书签侧栏。 */
  showPageBrowser?: boolean
  /** 页面浏览侧栏被左滑关闭时触发。 */
  onPageBrowserClose?: () => void
  /** 页面浏览侧栏主题色。 */
  themeColor?: string
  /** 每个文本高亮对应的评论数量。 */
  commentCountByRangeId?: Readonly<Record<string, number>>
  /** container 顶部文字对应的精确书签。 */
  bookmarks?: readonly ReaderBookmark[]
  /** 添加或删除指定文字锚点书签。 */
  onToggleBookmark?: (bookmark: ReaderBookmark) => void
  /** @deprecated 请使用 bookmarks。 */
  bookmarkedPageNumbers?: readonly number[]
  /** @deprecated 请使用 onToggleBookmark。 */
  onTogglePageBookmark?: (pageNumber: number) => void
  /** 受控的 Text Mode 当前阅读页。 */
  textReadingProgress?: ReaderTextReadingProgress
  /** 当前阅读页变化时触发。 */
  onTextReadingProgressChange?: (next: ReaderTextReadingProgress) => void
  onTextAnchorChange?: (anchor: ReaderTextAnchor | undefined) => void
  readingPositionRef?: Ref<ReaderReadingPositionHandle>
  pageRange?: ReaderPageRange
  /** 需要从文本阅读流中排除的 1-based 页码或公开 PageId。 */
  hiddenPages?: readonly (number | string)[]
  /** 初始立即加载的页数，默认 `1`。 */
  initialLoadedPages?: number
  /** 并发加载页数上限，默认 `3`。 */
  pageLoadConcurrency?: number
  /** 页面进入可加载窗口后、发起加载前的延迟（毫秒），默认 `500`。 */
  pageLoadEnterDelayMs?: number
  /** 当前段前后预加载的段数，默认前后各 `3` 段。 */
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
  onRemoveRange?: (id: string) => void
  onRemoveRect?: (id: string) => void
  /** linked selection 手势开始回调；文本模式状态机接入后由 Selection 包装层触发。 */
  onSelectionStart?: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  /** linked selection 手势结束回调；文本模式状态机接入后由 Selection 包装层触发。 */
  onSelectionEnd?: (mousePos: ReaderMousePosition, selection: Selection) => void
  /** 高亮确认回调；文本模式状态机接入后由 highlight/autoHighlight 触发。 */
  onHighlight?: (range: ReaderSelectionRange) => void
  /** 鼠标拖动高亮或触摸长按高亮进入拖动状态时触发，每次手势仅触发一次。 */
  onDragHighlight?: (highlight: ReaderSelectionRange) => void
  /** linked selection 高亮颜色；文本模式状态机接入后传给 Selection 包装层。 */
  highlightColor?: string
  /** linked selection 活跃选区颜色；文本模式状态机接入后传给 Selection 包装层。 */
  selectionColor?: string
  /** 是否启用选区端点放大镜，默认 false。 */
  showSelectionMagnifier?: boolean
  /** 活跃选区 popover；文本模式状态机接入后传给 Selection 包装层。 */
  selectionPopover?: ReaderSelectionPopover
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

type MountedTextPageProgress = {
  readonly pageNumber: number
  readonly pageProgress: number
}

const getMountedTextPageProgress = (
  viewerRootElement: HTMLElement
): MountedTextPageProgress | null => {
  const viewportRect = viewerRootElement.getBoundingClientRect()
  const mountedPages = Array.from(
    viewerRootElement.querySelectorAll<HTMLElement>(
      '[data-testid^="intermediate-text-page-"]'
    )
  )
  const currentPageElement =
    mountedPages.find(
      (pageElement) =>
        pageElement.getBoundingClientRect().bottom > viewportRect.top
    ) ?? mountedPages.at(-1)
  if (!currentPageElement) return null

  const pageRect = currentPageElement.getBoundingClientRect()
  const pageProgress =
    pageRect.height > 0
      ? Math.min(
          1,
          Math.max(0, (viewportRect.top - pageRect.top) / pageRect.height)
        )
      : 0
  return {
    pageNumber: Number(currentPageElement.dataset.pageNumber),
    pageProgress
  }
}

const areTextWindowImagesSettled = (
  viewport: HTMLElement,
  pageNumbers: readonly number[]
): boolean =>
  pageNumbers.every((pageNumber) => {
    const page = viewport.querySelector<HTMLElement>(
      `[data-testid="intermediate-text-page-${pageNumber}"]`
    )
    if (!page) return false
    return Array.from(page.querySelectorAll('img')).every(
      (image) => image.complete || image.dataset.imageSettled === 'true'
    )
  })

const getDocumentScopedMap = <Key, Value>(
  stateGeneration: symbol,
  documentGeneration: symbol,
  values: Map<Key, Value>
): Map<Key, Value> =>
  stateGeneration === documentGeneration ? values : new Map<Key, Value>()

const getDocumentScopedPageNumber = (
  stateGeneration: symbol,
  documentGeneration: symbol,
  activePageNumber: number,
  initialPageNumber: number
): number =>
  stateGeneration === documentGeneration ? activePageNumber : initialPageNumber

const getInitialObservedProgressKey = (
  controlledProgress: IntermediateDocumentTextViewerProps['textReadingProgress'],
  readingProgress: TextReadingProgressSnapshot
): string =>
  controlledProgress ? getTextReadingProgressKey(readingProgress) : ''

/**
 * `intermediate-document` 文本渲染模式的查看器。
 *
 * 文本模式使用浏览器原生滚动和固定页面窗口。PDF 每段挂载四页，其他文本格式
 * 每段挂载一页。与 layout 模式（`VirtualPaper` + 全量外壳）不同，文本模式：
 * - 不挂载 `VirtualPaper`，也不渲染 `.virtual-paper-wrapper`；
 * - 不为每个页码渲染占位 DOM，仅渲染当前页面窗口；
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
    containMarginX,
    containMarginTop,
    containMarginBottom,
    containMarginY,
    showPageBrowser = false,
    onPageBrowserClose,
    themeColor,
    commentCountByRangeId,
    bookmarks,
    onToggleBookmark,
    bookmarkedPageNumbers,
    onTogglePageBookmark,
    textReadingProgress,
    onTextReadingProgressChange,
    onTextAnchorChange,
    readingPositionRef,
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
    onRemoveRange,
    onRemoveRect,
    onSelectionStart,
    onSelectionEnd,
    onHighlight,
    onDragHighlight,
    highlightColor,
    selectionColor,
    showSelectionMagnifier = true,
    selectionPopover,
    highlightPopover,
    onCommentHighlight,
    autoHighlight,
    selectionRef,
    overlayRectType = 'percent',
    popoverRelative
  } = props

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
  const imagesByPageNumberRef = useRef(new Map<number, IntermediateImage[]>())
  const orderedContentByPageNumberRef = useRef(
    new Map<number, IntermediateContent[]>()
  )

  // 选择追踪：镜像 layout 模式 — scrollContainer 既做滚动又做 viewer root
  const viewerRootRef = scrollContainerRef

  const setScrollRootRef = useCallback((element: HTMLDivElement | null) => {
    scrollContainerRef.current = element
    setViewerRootElement(element)
  }, [])

  // textElementsRef: key = text.id — 仅注册已挂载的可见文本 span
  const textElementsRef = useRef<
    Map<string, TextAnchorElementRecord<IntermediateText>>
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
  useLayoutEffect(() => {
    lazyQueueConfigRef.current = {
      initialLoadedPages,
      pageLoadConcurrency,
      pageLoadEnterDelayMs,
      pageUnloadDelayMs
    }
  }, [
    initialLoadedPages,
    pageLoadConcurrency,
    pageLoadEnterDelayMs,
    pageUnloadDelayMs
  ])

  const [storedTextsByPageNumber, setTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [storedParagraphsByPageNumber, setParagraphsByPageNumber] = useState(
    () => new Map<number, IntermediateParagraph[]>()
  )
  const [storedImagesByPageNumber, setImagesByPageNumber] = useState(
    () => new Map<number, IntermediateImage[]>()
  )
  const [storedOrderedContentByPageNumber, setOrderedContentByPageNumber] =
    useState(() => new Map<number, IntermediateContent[]>())

  // 解析 runtime document，复用 layout 模式的同一份纯函数。
  // 文档缺失（null/undefined）时返回 null。
  const runtimeDocument = useMemo(
    () => getRuntimeDocument(document ?? serializedDocument),
    [document, serializedDocument]
  )
  const documentRenderKey = getTextDocumentRenderKey(runtimeDocument)

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
  const documentGeneration = useDocumentGeneration(
    runtimeDocument,
    pageNumbersKey
  )
  const contentDocumentGenerationRef = useRef(documentGeneration)
  const textsByPageNumber = getDocumentScopedMap(
    contentDocumentGenerationRef.current,
    documentGeneration,
    storedTextsByPageNumber
  )
  const paragraphsByPageNumber = getDocumentScopedMap(
    contentDocumentGenerationRef.current,
    documentGeneration,
    storedParagraphsByPageNumber
  )
  const imagesByPageNumber = getDocumentScopedMap(
    contentDocumentGenerationRef.current,
    documentGeneration,
    storedImagesByPageNumber
  )
  const orderedContentByPageNumber = getDocumentScopedMap(
    contentDocumentGenerationRef.current,
    documentGeneration,
    storedOrderedContentByPageNumber
  )
  useLayoutEffect(() => {
    textsByPageNumberRef.current = textsByPageNumber
    imagesByPageNumberRef.current = imagesByPageNumber
    orderedContentByPageNumberRef.current = orderedContentByPageNumber
  }, [imagesByPageNumber, orderedContentByPageNumber, textsByPageNumber])
  const selectionScope = useSelectionScope(runtimeDocument, pageNumbersKey)

  const isRangesControlled = ranges !== undefined
  const [internalRanges, setInternalRanges] = useState<ReaderSelectionRange[]>(
    () => defaultRanges ?? []
  )
  const [readingProgress, setReadingProgress] =
    useState<TextReadingProgressSnapshot>(() =>
      getInitialTextReadingProgress(textReadingProgress, pageNumbers)
    )
  const textPageWindowSize = getTextPageWindowSize(isPdf)
  const [activeWindowPageNumber, setActiveWindowPageNumber] = useState(
    () => readingProgress.currentPageNumber
  )
  const activeWindowDocumentGenerationRef = useRef(documentGeneration)
  const currentActiveWindowPageNumber = getDocumentScopedPageNumber(
    activeWindowDocumentGenerationRef.current,
    documentGeneration,
    activeWindowPageNumber,
    getInitialTextReadingProgress(textReadingProgress, pageNumbers)
      .currentPageNumber
  )
  const [currentPageProgress, setCurrentPageProgress] = useState(0)
  const [mediaLayoutRevision, setMediaLayoutRevision] = useState(0)
  const handleImageSettled = useCallback(() => {
    setMediaLayoutRevision((revision) => revision + 1)
  }, [])
  const [fallbackBookmarkKey, setFallbackBookmarkKey] = useState<string>()
  const readingProgressRef =
    useRef<TextReadingProgressSnapshot>(readingProgress)
  useLayoutEffect(() => {
    readingProgressRef.current = readingProgress
  }, [readingProgress])
  const readingProgressPageRef = useRef(readingProgress.currentPageNumber)
  const lastObservedProgressKeyRef = useRef(
    getInitialObservedProgressKey(textReadingProgress, readingProgress)
  )
  const lastLocallyEmittedProgressKeyRef = useRef('')
  const usesNativeScrollEndRef = useRef(false)
  const nativeScrollPendingRef = useRef(false)
  const suppressProgrammaticProgressRef = useRef(false)
  const isInitialProgressRestorePendingRef = useRef(
    textReadingProgress !== undefined
  )
  const restoredProgressPageRef = useRef<number | null>(null)
  const restoredProgressAnchorKeyRef = useRef<string | null>(null)
  const restoreRequestTokenRef = useRef(0)
  const committedBookmarkRequestTokenRef = useRef<number | null>(null)
  const activeRestoreRequestRef = useRef<TextAnchorRestoreRequest | null>(null)
  const requestedProgress = resolveRequestedTextReadingProgress(
    textReadingProgress,
    pageNumbers
  )
  const controlledProgressIdentity =
    getRequestedProgressIdentity(requestedProgress)
  useInvalidateRestoreRequest(
    controlledProgressIdentity,
    activeRestoreRequestRef,
    restoreRequestTokenRef
  )
  const pendingTextAnchorRef = useRef<PendingTextAnchorRestore | null>(null)
  const progressDocumentGenerationRef = useRef(documentGeneration)
  const restoreAttemptCleanupRef = useRef<(() => void) | null>(null)
  const alignTextAnchorRef = useRef<
    | ((anchor: ReaderTextAnchor, request: TextAnchorRestoreRequest) => boolean)
    | null
  >(null)
  const textNavigationGenerationRef = useRef(0)
  const pendingTextRangeNavigationRef =
    useRef<PendingTextRangeNavigation | null>(null)
  const pendingTextWindowAlignmentRef =
    useRef<PendingTextWindowAlignment | null>(null)
  useDocumentGenerationChange(documentGeneration, () => {
    progressDocumentGenerationRef.current = documentGeneration
    restoreAttemptCleanupRef.current?.()
    restoreAttemptCleanupRef.current = null
    textNavigationGenerationRef.current += 1
    pendingTextRangeNavigationRef.current = null
    pendingTextWindowAlignmentRef.current = null
    restoreRequestTokenRef.current += 1
    committedBookmarkRequestTokenRef.current = null
    activeRestoreRequestRef.current = null
    pendingTextAnchorRef.current = null
    textElementsRef.current.clear()
    restoredProgressPageRef.current = null
    restoredProgressAnchorKeyRef.current = null
    lastLocallyEmittedProgressKeyRef.current = ''
    suppressProgrammaticProgressRef.current = false
    setFallbackBookmarkKey(undefined)
    const nextProgress = getInitialTextReadingProgress(
      textReadingProgress,
      pageNumbers
    )
    readingProgressPageRef.current = nextProgress.currentPageNumber
    readingProgressRef.current = nextProgress
    lastObservedProgressKeyRef.current = textReadingProgress
      ? getTextReadingProgressKey(nextProgress)
      : ''
    isInitialProgressRestorePendingRef.current =
      textReadingProgress !== undefined
    setReadingProgress(nextProgress)
    activeWindowDocumentGenerationRef.current = documentGeneration
    setActiveWindowPageNumber(nextProgress.currentPageNumber)
    setCurrentPageProgress(0)
    onTextAnchorChange?.(undefined)
  })
  const {
    isActive: isReadingProgressMoving,
    signalActivity: signalReadingProgressActivity
  } = useReadingProgressActivity()
  const captureCurrentTextAnchor = useCallback(
    (scanBelow: boolean = false) => {
      const viewport = scrollContainerRef.current
      if (!viewport) return undefined

      return (
        (scanBelow ? findTextAnchorAtOrBelow : findTopTextAnchor)(
          viewport,
          textElementsRef.current,
          textsByPageNumberRef.current,
          { topInset: containMarginTop ?? containMarginY }
        ) ?? undefined
      )
    },
    [containMarginTop, containMarginY]
  )
  const captureReadingProgress = useCallback(() => {
    if (isInitialProgressRestorePendingRef.current) return undefined
    if (suppressProgrammaticProgressRef.current) return undefined
    const anchor = captureCurrentTextAnchor()
    if (!anchor) return undefined

    const nextProgress = {
      currentPageNumber: anchor.pageNumber,
      anchor
    } satisfies ReaderTextReadingProgress
    onTextAnchorChange?.(anchor)
    const nextKey = getTextReadingProgressKey(nextProgress)
    setFallbackBookmarkKey(undefined)
    readingProgressPageRef.current = anchor.pageNumber
    readingProgressRef.current = nextProgress
    setReadingProgress((current) =>
      getTextReadingProgressKey(current) === nextKey ? current : nextProgress
    )
    if (lastObservedProgressKeyRef.current === nextKey) return anchor

    lastObservedProgressKeyRef.current = nextKey
    lastLocallyEmittedProgressKeyRef.current = nextKey
    onTextReadingProgressChange?.(nextProgress)
    return anchor
  }, [
    captureCurrentTextAnchor,
    onTextAnchorChange,
    onTextReadingProgressChange
  ])
  useImperativeHandle(
    readingPositionRef,
    () => ({ captureTextAnchor: () => captureCurrentTextAnchor(true) }),
    [captureCurrentTextAnchor]
  )

  const cancelRestoreAttempt = useCallback(() => {
    restoreAttemptCleanupRef.current?.()
    restoreAttemptCleanupRef.current = null
  }, [])

  const cancelTextAnchorRestore = useCallback(() => {
    cancelRestoreAttempt()
    textNavigationGenerationRef.current += 1
    restoreRequestTokenRef.current += 1
    activeRestoreRequestRef.current = null
    pendingTextAnchorRef.current = null
    pendingTextRangeNavigationRef.current = null
    pendingTextWindowAlignmentRef.current = null
  }, [cancelRestoreAttempt])

  const releaseProgrammaticSuppression = useCallback(() => {
    cancelTextAnchorRestore()
    isInitialProgressRestorePendingRef.current = false
    suppressProgrammaticProgressRef.current = false
  }, [cancelTextAnchorRestore])

  useEffect(() => {
    if (!viewerRootElement) return
    const viewerWindow = viewerRootElement.ownerDocument.defaultView
    const usesNativeScrollEnd = 'onscrollend' in viewerRootElement
    usesNativeScrollEndRef.current = usesNativeScrollEnd
    let frameId: number | null = null
    const handleUserKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'PageDown' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === ' '
      ) {
        releaseProgrammaticSuppression()
      }
    }
    const handleUserWheel = () => {
      releaseProgrammaticSuppression()
    }
    const handleUserTouchStart = () => {
      releaseProgrammaticSuppression()
    }
    const handleScroll = () => {
      signalReadingProgressActivity()
      const mountedPageProgress = getMountedTextPageProgress(viewerRootElement)
      if (mountedPageProgress) {
        setCurrentPageProgress(mountedPageProgress.pageProgress)
        if (pageNumbers.includes(mountedPageProgress.pageNumber)) {
          readingProgressPageRef.current = mountedPageProgress.pageNumber
          setReadingProgress((current) =>
            current.currentPageNumber === mountedPageProgress.pageNumber
              ? current
              : { currentPageNumber: mountedPageProgress.pageNumber }
          )
        }
      }
      if (usesNativeScrollEnd) {
        nativeScrollPendingRef.current = true
        if (frameId !== null && viewerWindow) {
          viewerWindow.cancelAnimationFrame(frameId)
          frameId = null
        }
        return
      }
      if (!viewerWindow) {
        captureReadingProgress()
        return
      }
      if (frameId !== null) viewerWindow.cancelAnimationFrame(frameId)
      frameId = viewerWindow.requestAnimationFrame(captureReadingProgress)
    }
    const handleScrollEnd = () => {
      nativeScrollPendingRef.current = false
      captureReadingProgress()
      const fallbackProgress = readingProgressRef.current
      const fallbackKey = getTextReadingProgressKey(fallbackProgress)
      if (
        !suppressProgrammaticProgressRef.current &&
        lastObservedProgressKeyRef.current !== fallbackKey
      ) {
        lastObservedProgressKeyRef.current = fallbackKey
        lastLocallyEmittedProgressKeyRef.current = fallbackKey
        onTextReadingProgressChange?.(fallbackProgress)
      }
    }

    viewerRootElement.addEventListener('scroll', handleScroll, {
      passive: true
    })
    if (usesNativeScrollEnd) {
      viewerRootElement.addEventListener('scrollend', handleScrollEnd, {
        passive: true
      })
    }
    viewerRootElement.addEventListener('wheel', handleUserWheel, {
      passive: true
    })
    viewerRootElement.addEventListener('touchstart', handleUserTouchStart, {
      passive: true
    })
    viewerRootElement.addEventListener(
      'pointerdown',
      releaseProgrammaticSuppression
    )
    viewerRootElement.addEventListener('keydown', handleUserKeyDown)
    return () => {
      viewerRootElement.removeEventListener('scroll', handleScroll)
      if (usesNativeScrollEnd) {
        viewerRootElement.removeEventListener('scrollend', handleScrollEnd)
      }
      usesNativeScrollEndRef.current = false
      nativeScrollPendingRef.current = false
      viewerRootElement.removeEventListener('wheel', handleUserWheel)
      viewerRootElement.removeEventListener('touchstart', handleUserTouchStart)
      viewerRootElement.removeEventListener(
        'pointerdown',
        releaseProgrammaticSuppression
      )
      viewerRootElement.removeEventListener('keydown', handleUserKeyDown)
      if (frameId !== null && viewerWindow) {
        viewerWindow.cancelAnimationFrame(frameId)
      }
    }
  }, [
    captureReadingProgress,
    onTextReadingProgressChange,
    pageNumbers,
    releaseProgrammaticSuppression,
    signalReadingProgressActivity,
    viewerRootElement
  ])
  const visiblePageNumbers = useMemo(
    () =>
      getTextPageWindow(
        pageNumbers,
        currentActiveWindowPageNumber,
        textPageWindowSize
      ),
    [currentActiveWindowPageNumber, pageNumbers, textPageWindowSize]
  )
  const activeWindowStartIndex = Math.max(
    0,
    pageNumbers.indexOf(visiblePageNumbers[0] ?? currentActiveWindowPageNumber)
  )
  const previousWindowPageNumber = pageNumbers[activeWindowStartIndex - 1]
  const nextWindowPageNumber =
    pageNumbers[activeWindowStartIndex + textPageWindowSize]
  const tryPendingTextWindowAlignment = useCallback(() => {
    const pending = pendingTextWindowAlignmentRef.current
    if (
      !pending ||
      pending.documentGeneration !== progressDocumentGenerationRef.current ||
      pending.navigationGeneration !== textNavigationGenerationRef.current ||
      !pending.windowPageNumbers.every((pageNumber) =>
        textsByPageNumberRef.current.has(pageNumber)
      )
    ) {
      return false
    }
    const viewport = scrollContainerRef.current
    if (
      !viewport ||
      !areTextWindowImagesSettled(viewport, pending.windowPageNumbers)
    ) {
      return false
    }
    const pageElement = viewport?.querySelector<HTMLElement>(
      `[data-testid="intermediate-text-page-${pending.pageNumber}"]`
    )
    if (!viewport || !pageElement) return false

    const viewportRect = viewport.getBoundingClientRect()
    const pageRect = pageElement.getBoundingClientRect()
    const top =
      pending.alignment === 'end'
        ? Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        : viewport.scrollTop +
          pageRect.top -
          viewportRect.top +
          pageRect.height * pending.pageProgress
    viewport.scrollTo({ behavior: 'auto', top })
    pendingTextWindowAlignmentRef.current = null
    restoredProgressPageRef.current = pending.pageNumber
    isInitialProgressRestorePendingRef.current = false
    return true
  }, [])
  const handleReadingProgressSeekPage = useCallback(
    (
      pageNumber: number,
      source: 'restore' | 'user' = 'user',
      alignment: 'start' | 'end' = 'start',
      pageProgress = 0
    ) => {
      if (!pageNumbers.includes(pageNumber)) return
      if (source === 'user') releaseProgrammaticSuppression()
      const nextProgress = { currentPageNumber: pageNumber }
      const nextKey = getTextReadingProgressKey(nextProgress)
      readingProgressPageRef.current = pageNumber
      readingProgressRef.current = nextProgress
      setReadingProgress(nextProgress)
      setFallbackBookmarkKey(undefined)
      activeWindowDocumentGenerationRef.current = documentGeneration
      setActiveWindowPageNumber(pageNumber)
      setCurrentPageProgress(alignment === 'end' ? 1 : pageProgress)
      suppressProgrammaticProgressRef.current = true
      if (source === 'user' && lastObservedProgressKeyRef.current !== nextKey) {
        lastObservedProgressKeyRef.current = nextKey
        lastLocallyEmittedProgressKeyRef.current = nextKey
        onTextReadingProgressChange?.(nextProgress)
      }
      const navigationGeneration = textNavigationGenerationRef.current + 1
      textNavigationGenerationRef.current = navigationGeneration
      pendingTextRangeNavigationRef.current = null
      pendingTextWindowAlignmentRef.current = {
        pageNumber,
        alignment,
        navigationGeneration,
        documentGeneration: progressDocumentGenerationRef.current,
        pageProgress,
        windowPageNumbers: getTextPageWindow(
          pageNumbers,
          pageNumber,
          textPageWindowSize
        )
      }
      tryPendingTextWindowAlignment()
    },
    [
      onTextReadingProgressChange,
      documentGeneration,
      pageNumbers,
      releaseProgrammaticSuppression,
      textPageWindowSize,
      tryPendingTextWindowAlignment
    ]
  )
  const visiblePageNumberSet = useMemo(
    () => new Set(visiblePageNumbers),
    [visiblePageNumbers]
  )
  const pageSizesByPageNumber = useMemo(
    () =>
      new Map(
        pageNumbers.map((pageNumber) => [pageNumber, TEXT_PAGE_FALLBACK_SIZE])
      ),
    [pageNumbers]
  )
  const textLayoutKey = `${fontScale ?? 'default'}:${mediaLayoutRevision}:${Array.from(
    textsByPageNumber.keys()
  ).join(',')}:${Array.from(imagesByPageNumber.keys()).join(
    ','
  )}:${visiblePageNumbers.join(',')}`
  const storedRanges = isRangesControlled ? ranges : internalRanges
  const effectiveRanges = useDerivedTextSelectionRanges({
    ranges: storedRanges,
    root: viewerRootElement,
    pageNumbers,
    overlayRectType,
    layoutKey: textLayoutKey
  })
  const effectiveRangesRef = useRef<ReaderSelectionRange[]>(effectiveRanges)
  useLayoutEffect(() => {
    effectiveRangesRef.current = effectiveRanges
  }, [effectiveRanges])
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
  useLayoutEffect(() => {
    if (pendingLinkedHighlightScopeRef.current === selectionScope) return
    pendingLinkedHighlightScopeRef.current = selectionScope
    pendingLinkedHighlightOperationRef.current = null
    emittedLinkedSelectRangeIdsRef.current.clear()
    emittedLinkedHighlightRangeIdsRef.current.clear()
  }, [selectionScope])

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
  const commentOperationTokenRef = useRef(0)
  const commentOperationDocumentGenerationRef = useRef(documentGeneration)
  useLayoutEffect(() => {
    if (commentOperationDocumentGenerationRef.current === documentGeneration) {
      return
    }
    commentOperationDocumentGenerationRef.current = documentGeneration
    commentOperationTokenRef.current += 1
    setCommentingRangeId(null)
  }, [documentGeneration])

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
  const lastActiveRangeRef = useRef<LinkedSelectionRange | null>(
    runtimeLinkedData.activeRange ?? null
  )
  const lastActiveRangeScopeRef = useRef(selectionScope)
  useLayoutEffect(() => {
    runtimeLinkedDataRef.current = runtimeLinkedData
    if (lastActiveRangeScopeRef.current !== selectionScope) {
      lastActiveRangeScopeRef.current = selectionScope
      lastActiveRangeRef.current = runtimeLinkedData.activeRange ?? null
    } else if (runtimeLinkedData.activeRange) {
      lastActiveRangeRef.current = runtimeLinkedData.activeRange
    }
  }, [runtimeLinkedData, selectionScope])
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
      getTextPagePreloadWindow(
        pageNumbers,
        currentActiveWindowPageNumber,
        textPageWindowSize,
        pagePreloadRadius
      ),
    [
      currentActiveWindowPageNumber,
      pageNumbers,
      pagePreloadRadius,
      textPageWindowSize
    ]
  )
  const preloadPageNumberSet = useMemo(
    () => new Set(preloadPageNumbers),
    [preloadPageNumbers]
  )
  const preloadPageNumberSetRef = useRef(preloadPageNumberSet)
  const maxLoadedPagesRef = useRef(maxLoadedPages)
  useLayoutEffect(() => {
    preloadPageNumberSetRef.current = preloadPageNumberSet
    maxLoadedPagesRef.current = maxLoadedPages
  }, [maxLoadedPages, preloadPageNumberSet])

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
      const currentPreloadPageNumberSet = preloadPageNumberSetRef.current
      const cap = getEffectiveTextMaxLoadedPages(
        maxLoadedPagesRef.current,
        currentPreloadPageNumberSet.size
      )
      if (!Number.isFinite(cap) || loadedTexts.size <= cap) {
        return loadedTexts
      }

      const nextTexts = new Map(loadedTexts)
      for (const pageNumber of nextTexts.keys()) {
        if (nextTexts.size <= cap) {
          break
        }
        if (!currentPreloadPageNumberSet.has(pageNumber)) {
          nextTexts.delete(pageNumber)
          clearUnloadTimer(pageNumber)
        }
      }
      return nextTexts
    },
    [clearUnloadTimer]
  )

  const lazyPageQueue = useLazyPageQueue(lazyQueueConfigRef, runtimeDocument, {
    mode: 'text',
    activeDocumentRef,
    isMountedRef,
    loadingPagesRef,
    getPageContentEntries: getTextContentEntries,
    isIntermediateText,
    isIntermediateImage,
    callbacks: {
      onPageLoaded: ({ pageNumber, texts, images, paragraphs, content }) => {
        clearUnloadTimer(pageNumber)
        setParagraphsByPageNumber((currentParagraphs) => {
          const nextParagraphs = new Map(currentParagraphs)
          nextParagraphs.set(pageNumber, paragraphs)
          return nextParagraphs
        })
        setImagesByPageNumber((currentImages) => {
          const nextImages = new Map(currentImages)
          nextImages.set(pageNumber, images)
          return nextImages
        })
        setOrderedContentByPageNumber((currentContent) => {
          const nextContent = new Map(currentContent)
          nextContent.set(pageNumber, content)
          return nextContent
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
        setImagesByPageNumber((currentImages) => {
          const nextImages = new Map(currentImages)
          nextImages.set(pageNumber, [])
          return nextImages
        })
        setOrderedContentByPageNumber((currentContent) => {
          const nextContent = new Map(currentContent)
          nextContent.set(pageNumber, [])
          return nextContent
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
  useLayoutEffect(() => {
    lazyPageQueueRef.current = lazyPageQueue
  }, [lazyPageQueue])

  const alignTextAnchor = useCallback(
    (anchor: ReaderTextAnchor, request: TextAnchorRestoreRequest): boolean => {
      const activeRequest = activeRestoreRequestRef.current
      if (
        activeRequest?.token !== request.token ||
        request.documentGeneration !== progressDocumentGenerationRef.current ||
        request.anchorKey !== getTextAnchorKey(anchor)
      ) {
        return false
      }
      const viewport = scrollContainerRef.current
      if (!viewport) return false
      const windowPageNumbers = getTextPageWindow(
        pageNumbers,
        anchor.pageNumber,
        textPageWindowSize
      )
      if (
        !windowPageNumbers.every((pageNumber) =>
          textsByPageNumberRef.current.has(pageNumber)
        ) ||
        !areTextWindowImagesSettled(viewport, windowPageNumbers)
      ) {
        return false
      }
      const element = resolveTextAnchorElement(
        anchor,
        textElementsRef.current,
        textsByPageNumberRef.current
      )
      if (!element) return false

      const viewportRect = viewport.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()
      viewport.scrollTo({
        behavior: 'auto',
        top: viewport.scrollTop + elementRect.top - viewportRect.top
      })
      restoreAttemptCleanupRef.current?.()
      restoreAttemptCleanupRef.current = null
      pendingTextAnchorRef.current = null
      isInitialProgressRestorePendingRef.current = false
      restoredProgressAnchorKeyRef.current = getTextAnchorKey(anchor)
      const nextProgress = {
        currentPageNumber: anchor.pageNumber,
        anchor
      } satisfies ReaderTextReadingProgress
      readingProgressPageRef.current = anchor.pageNumber
      readingProgressRef.current = nextProgress
      setReadingProgress(nextProgress)
      setFallbackBookmarkKey(undefined)
      if (
        request.source === 'bookmark' &&
        committedBookmarkRequestTokenRef.current !== request.token
      ) {
        committedBookmarkRequestTokenRef.current = request.token
        const nextKey = getTextReadingProgressKey(nextProgress)
        lastObservedProgressKeyRef.current = nextKey
        lastLocallyEmittedProgressKeyRef.current = nextKey
        onTextReadingProgressChange?.(nextProgress)
      }
      return true
    },
    [onTextReadingProgressChange, pageNumbers, textPageWindowSize]
  )
  alignTextAnchorRef.current = alignTextAnchor

  const scrollToTextAnchor = useCallback(
    (anchor: ReaderTextAnchor, source: 'bookmark' | 'restore' = 'bookmark') => {
      const pageIndex = pageNumbers.indexOf(anchor.pageNumber)
      if (pageIndex < 0) return

      cancelTextAnchorRestore()
      const documentGeneration = progressDocumentGenerationRef.current
      const request = {
        token: restoreRequestTokenRef.current + 1,
        documentGeneration,
        anchorKey: getTextAnchorKey(anchor),
        source
      } satisfies TextAnchorRestoreRequest
      restoreRequestTokenRef.current = request.token
      activeRestoreRequestRef.current = request
      isInitialProgressRestorePendingRef.current = true
      suppressProgrammaticProgressRef.current = true
      setFallbackBookmarkKey(
        source === 'bookmark' ? getTextAnchorKey(anchor) : undefined
      )
      clearUnloadTimer(anchor.pageNumber)
      pendingTextAnchorRef.current = { anchor, request }
      lazyPageQueueRef.current.replaceRequiredPages(
        getTextPagePreloadWindow(
          pageNumbers,
          anchor.pageNumber,
          textPageWindowSize,
          pagePreloadRadius
        )
      )
      if (!textsByPageNumberRef.current.has(anchor.pageNumber)) {
        lazyPageQueueRef.current.enqueuePage(anchor.pageNumber)
      }
      setActiveWindowPageNumber(anchor.pageNumber)
      const loadedTexts = textsByPageNumberRef.current.get(anchor.pageNumber)
      if (loadedTexts && !hasAnchorableText(loadedTexts)) {
        cancelTextAnchorRestore()
        isInitialProgressRestorePendingRef.current = false
        restoredProgressAnchorKeyRef.current = null
        restoredProgressPageRef.current = anchor.pageNumber
        const fallbackProgress = { currentPageNumber: anchor.pageNumber }
        readingProgressPageRef.current = anchor.pageNumber
        readingProgressRef.current = fallbackProgress
        setReadingProgress(fallbackProgress)
        setFallbackBookmarkKey(getTextAnchorKey(anchor))
        if (source === 'bookmark') {
          const persistedProgress = {
            currentPageNumber: anchor.pageNumber,
            anchor
          }
          const nextKey = getTextReadingProgressKey(persistedProgress)
          lastObservedProgressKeyRef.current = nextKey
          lastLocallyEmittedProgressKeyRef.current = nextKey
          onTextReadingProgressChange?.(persistedProgress)
        }
        return
      }
      if (alignTextAnchor(anchor, request)) return

      const viewerWindow = scrollContainerRef.current?.ownerDocument.defaultView
      if (!viewerWindow) {
        const timerId = globalThis.setTimeout(() => {
          alignTextAnchor(anchor, request)
        }, 0)
        restoreAttemptCleanupRef.current = () =>
          globalThis.clearTimeout(timerId)
        return
      }
      let secondFrameId: number | null = null
      let timerId: number | null = null
      const firstFrameId = viewerWindow.requestAnimationFrame(() => {
        if (
          documentGeneration !== progressDocumentGenerationRef.current ||
          alignTextAnchor(anchor, request)
        ) {
          return
        }
        secondFrameId = viewerWindow.requestAnimationFrame(() => {
          alignTextAnchor(anchor, request)
        })
        timerId = viewerWindow.setTimeout(() => {
          alignTextAnchor(anchor, request)
        }, 0)
      })
      restoreAttemptCleanupRef.current = () => {
        viewerWindow.cancelAnimationFrame(firstFrameId)
        if (secondFrameId !== null) {
          viewerWindow.cancelAnimationFrame(secondFrameId)
        }
        if (timerId !== null) viewerWindow.clearTimeout(timerId)
      }
    },
    [
      alignTextAnchor,
      cancelTextAnchorRestore,
      clearUnloadTimer,
      onTextReadingProgressChange,
      pageNumbers,
      pagePreloadRadius,
      textPageWindowSize
    ]
  )

  const scrollToBookmark = useCallback(
    (bookmark: ReaderBookmark) => {
      if (isTextBookmark(bookmark)) {
        scrollToTextAnchor(bookmark)
        return
      }

      const pageIndex = pageNumbers.indexOf(bookmark.pageNumber)
      if (pageIndex < 0) return
      const verticalRatio =
        Math.min(100, Math.max(0, bookmark.verticalPercentage)) / 100
      handleReadingProgressSeekPage(
        bookmark.pageNumber,
        'user',
        'start',
        verticalRatio
      )
      setFallbackBookmarkKey(getBookmarkKey(bookmark))
    },
    [handleReadingProgressSeekPage, pageNumbers, scrollToTextAnchor]
  )

  const { onTextSelectionChange, onTextSelectionEnd, onSelectText } = props

  // setTextRef: 柯里化回调 (text, pageNumber) => (element) => void
  // 与 layout 模式完全兼容。element 非 null 注册，null 卸载。
  const setTextRef = useCallback(
    (text: IntermediateText, pageNumber: number) =>
      (element: HTMLSpanElement | null) => {
        if (element) {
          textElementsRef.current.set(text.id, { text, pageNumber, element })
          textElementRecords.set(element, { text, pageNumber })
        } else {
          textElementsRef.current.delete(text.id)
        }
      },
    []
  )

  useEffect(() => {
    if (textLayoutKey.length === 0) return
    const pendingRestore = pendingTextAnchorRef.current
    if (
      pendingRestore &&
      textsByPageNumber.has(pendingRestore.anchor.pageNumber)
    ) {
      const { anchor, request } = pendingRestore
      const loadedTexts = textsByPageNumber.get(anchor.pageNumber)
      if (loadedTexts && !hasAnchorableText(loadedTexts)) {
        const source = request.source
        cancelTextAnchorRestore()
        isInitialProgressRestorePendingRef.current = false
        restoredProgressAnchorKeyRef.current = null
        restoredProgressPageRef.current = anchor.pageNumber
        const fallbackProgress = {
          currentPageNumber: anchor.pageNumber
        }
        readingProgressPageRef.current = anchor.pageNumber
        readingProgressRef.current = fallbackProgress
        setReadingProgress(fallbackProgress)
        setFallbackBookmarkKey(getTextAnchorKey(anchor))
        if (source === 'bookmark') {
          const nextKey = getTextReadingProgressKey({
            currentPageNumber: anchor.pageNumber,
            anchor
          })
          lastObservedProgressKeyRef.current = nextKey
          lastLocallyEmittedProgressKeyRef.current = nextKey
          onTextReadingProgressChange?.({
            currentPageNumber: anchor.pageNumber,
            anchor
          })
        }
        return
      }
      alignTextAnchor(anchor, request)
    }
  }, [
    alignTextAnchor,
    cancelTextAnchorRestore,
    onTextReadingProgressChange,
    textLayoutKey,
    textsByPageNumber
  ])

  useEffect(() => {
    const requestedProgress = resolveRequestedTextReadingProgress(
      textReadingProgress,
      pageNumbers
    )
    if (!requestedProgress) {
      cancelTextAnchorRestore()
      isInitialProgressRestorePendingRef.current = false
      restoredProgressPageRef.current = null
      restoredProgressAnchorKeyRef.current = null
      pendingTextAnchorRef.current = null
      return
    }
    const requestedPageNumber = requestedProgress.currentPageNumber
    const requestedAnchor = requestedProgress.anchor
    const requestedKey = getTextReadingProgressKey(requestedProgress)
    lastObservedProgressKeyRef.current = requestedKey
    if (!requestedAnchor) {
      cancelTextAnchorRestore()
      restoredProgressAnchorKeyRef.current = null
      setFallbackBookmarkKey(undefined)
    } else {
      const pendingAnchor = pendingTextAnchorRef.current?.anchor
      if (
        pendingAnchor &&
        getTextAnchorKey(pendingAnchor) !== getTextAnchorKey(requestedAnchor)
      ) {
        cancelTextAnchorRestore()
      }
    }
    if (lastLocallyEmittedProgressKeyRef.current === requestedKey) {
      lastLocallyEmittedProgressKeyRef.current = ''
      isInitialProgressRestorePendingRef.current = false
      restoredProgressPageRef.current = requestedPageNumber
      restoredProgressAnchorKeyRef.current = requestedAnchor
        ? requestedKey
        : null
      return
    }

    if (requestedAnchor) {
      if (restoredProgressAnchorKeyRef.current === requestedKey) return
      readingProgressPageRef.current = requestedPageNumber
      readingProgressRef.current = requestedProgress
      setReadingProgress(requestedProgress)
      isInitialProgressRestorePendingRef.current = true
      restoredProgressPageRef.current = requestedPageNumber
      scrollToTextAnchor(requestedAnchor, 'restore')
      return
    }

    if (
      restoredProgressPageRef.current === requestedPageNumber &&
      pendingTextWindowAlignmentRef.current === null
    ) {
      return
    }
    readingProgressPageRef.current = requestedPageNumber
    readingProgressRef.current = requestedProgress
    setReadingProgress(requestedProgress)
    suppressProgrammaticProgressRef.current = true
    isInitialProgressRestorePendingRef.current = true
    handleReadingProgressSeekPage(requestedPageNumber, 'restore')
  }, [
    cancelTextAnchorRestore,
    handleReadingProgressSeekPage,
    pageNumbers,
    scrollToTextAnchor,
    textReadingProgress
  ])

  useEffect(() => {
    if (textsByPageNumber.size === 0) return
    const viewerWindow = scrollContainerRef.current?.ownerDocument.defaultView
    if (!viewerWindow) {
      captureReadingProgress()
      return
    }
    const frameId = viewerWindow.requestAnimationFrame(captureReadingProgress)
    return () => viewerWindow.cancelAnimationFrame(frameId)
  }, [captureReadingProgress, textsByPageNumber])

  useEffect(() => {
    if (textLayoutKey.length === 0) return
    tryPendingTextWindowAlignment()
  }, [textLayoutKey, tryPendingTextWindowAlignment])

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
    setImagesByPageNumber((currentImages) => {
      if (!currentImages.has(pageNumber)) {
        return currentImages
      }
      const nextImages = new Map(currentImages)
      nextImages.delete(pageNumber)
      return nextImages
    })
    setOrderedContentByPageNumber((currentContent) => {
      if (!currentContent.has(pageNumber)) {
        return currentContent
      }
      const nextContent = new Map(currentContent)
      nextContent.delete(pageNumber)
      return nextContent
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
    (range: ReaderSelectionRange): ReaderSelectionRange | null => {
      const canonicalRange = isPdf
        ? canonicalizePdfSelectionRange(range, viewerRootRef.current)
        : range
      if (!canonicalRange) return null
      return {
        ...canonicalRange,
        rectsBySelectionId: {}
      }
    },
    [isPdf]
  )

  const resolvedSelectionPopover = resolveSelectionPopover(
    selectionPopover,
    runtimeLinkedData.activeRange,
    scopeId,
    toTextRange
  )

  const handleLinkedDataChange = useCallback(
    (next: LinkedSelectionData) => {
      const runtimePublicLinkedData = mapRuntimeLinkedDataToPublic(
        next,
        scopeId
      )
      const existingRanges = new Map(
        effectiveRangesRef.current.map((range) => [range.id, range])
      )
      const activeRangeId = runtimePublicLinkedData.activeRange?.id
      const items = runtimePublicLinkedData.items.flatMap((range) => {
        const existingRange = existingRanges.get(range.id)
        if (existingRange && range.id !== activeRangeId) return [existingRange]
        const textRange = toTextRange(range)
        return textRange ? [textRange] : []
      })
      const activeRange = runtimePublicLinkedData.activeRange
        ? toTextRange(runtimePublicLinkedData.activeRange)
        : runtimePublicLinkedData.activeRange
      const publicLinkedData: ReaderLinkedSelectionData = {
        ...runtimePublicLinkedData,
        items,
        activeRange
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
        if (!textRange) return
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
        if (!textRange) return
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

  const tryPendingTextRangeNavigation = useCallback(() => {
    const pending = pendingTextRangeNavigationRef.current
    if (
      !pending ||
      pending.documentGeneration !== progressDocumentGenerationRef.current ||
      pending.navigationGeneration !== textNavigationGenerationRef.current
    ) {
      return false
    }
    if (
      !pending.windowPageNumbers.every((pageNumber) =>
        textsByPageNumberRef.current.has(pageNumber)
      )
    ) {
      return false
    }
    const range = effectiveRangesRef.current.find(
      (candidate) => candidate.id === pending.rangeId
    )
    const viewport = scrollContainerRef.current
    if (!range) {
      pendingTextRangeNavigationRef.current = null
      return false
    }
    if (
      !viewport ||
      !areTextWindowImagesSettled(viewport, pending.windowPageNumbers)
    ) {
      return false
    }

    const pageId = `page-${pending.pageNumber}`
    const pageSelector = `[data-testid="intermediate-text-page-${pending.pageNumber}"]`
    const selectionContainer = viewport
      .querySelector<HTMLElement>(pageSelector)
      ?.querySelector<HTMLElement>('.hsn-selection-container')
    if (!selectionContainer) return false
    const targetRects = deriveDomSelectionPageRects({
      root: viewport,
      pageSelector,
      startOffset: range.start.selectionId === pageId ? range.start.offset : 0,
      endOffset:
        range.end.selectionId === pageId ? range.end.offset : undefined,
      overlayRectType: 'px'
    })
    if (!targetRects || targetRects.length === 0) return false

    const viewportRect = viewport.getBoundingClientRect()
    const selectionRect = selectionContainer.getBoundingClientRect()
    // 多行高亮以整段文字的垂直中心为锚点，避免只把第一行滚到中央。
    const targetTop = Math.min(...targetRects.map((rect) => rect.y))
    const targetBottom = Math.max(
      ...targetRects.map((rect) => rect.y + rect.height)
    )
    const targetPageCenter = (targetTop + targetBottom) / 2
    const targetCenter =
      selectionRect.top -
      viewportRect.top +
      targetPageCenter
    const top = Math.min(
      Math.max(0, viewport.scrollHeight - viewport.clientHeight),
      Math.max(0, viewport.scrollTop + targetCenter - viewport.clientHeight / 2)
    )
    viewport.scrollTo({ behavior: 'auto', top })
    const pageProgress = Math.min(
      1,
      Math.max(0, targetPageCenter / selectionRect.height)
    )
    const nextProgress = { currentPageNumber: pending.pageNumber }
    const nextKey = getTextReadingProgressKey(nextProgress)
    readingProgressPageRef.current = pending.pageNumber
    readingProgressRef.current = nextProgress
    setReadingProgress(nextProgress)
    setCurrentPageProgress(pageProgress)
    suppressProgrammaticProgressRef.current = true
    if (lastObservedProgressKeyRef.current !== nextKey) {
      lastObservedProgressKeyRef.current = nextKey
      lastLocallyEmittedProgressKeyRef.current = nextKey
      onTextReadingProgressChange?.(nextProgress)
    }
    pendingTextRangeNavigationRef.current = null
    return true
  }, [onTextReadingProgressChange])

  useEffect(() => {
    if (textLayoutKey.length === 0) return
    tryPendingTextRangeNavigation()
  }, [textLayoutKey, tryPendingTextRangeNavigation])

  const scrollToRange = useCallback(
    (rangeId: string) => {
      const range = effectiveRangesRef.current.find(
        (candidate) => candidate.id === rangeId
      )
      if (!range) return

      const pageNumber = resolveTextRangeTargetPageNumber(range)
      if (pageNumber === null) return

      releaseProgrammaticSuppression()
      const pageIndex = pageNumbers.indexOf(pageNumber)
      if (pageIndex === -1) return

      clearUnloadTimer(pageNumber)
      lazyPageQueueRef.current.replaceRequiredPages(
        getTextPagePreloadWindow(
          pageNumbers,
          pageNumber,
          textPageWindowSize,
          pagePreloadRadius
        )
      )
      if (!textsByPageNumberRef.current.has(pageNumber)) {
        lazyPageQueueRef.current.enqueuePage(pageNumber)
      }

      setActiveWindowPageNumber(pageNumber)
      const navigationGeneration = textNavigationGenerationRef.current + 1
      textNavigationGenerationRef.current = navigationGeneration
      pendingTextRangeNavigationRef.current = {
        rangeId: range.id,
        pageNumber,
        navigationGeneration,
        documentGeneration: progressDocumentGenerationRef.current,
        windowPageNumbers: getTextPageWindow(
          pageNumbers,
          pageNumber,
          textPageWindowSize
        )
      }
      pendingTextWindowAlignmentRef.current = null
      tryPendingTextRangeNavigation()
    },
    [
      clearUnloadTimer,
      pagePreloadRadius,
      pageNumbers,
      releaseProgrammaticSuppression,
      textPageWindowSize,
      tryPendingTextRangeNavigation
    ]
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

  useLayoutEffect(() => {
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

  const resolveHighlightDragTarget = useCallback(
    (clientX: number, clientY: number) => {
      const linkedData = runtimeLinkedDataRef.current
      if (
        [
          linkedData.activeRange,
          linkedData.draggingRange,
          linkedData.selectingText
        ].some(Boolean)
      ) {
        return null
      }
      const touchedRangeId = findTouchedRangeIdByPoint(
        linkedData,
        clientX,
        clientY,
        Array.from(
          viewerRootElement?.querySelectorAll<HTMLElement>(
            '.hamster-reader__intermediate-text-page[data-selection-id], .hsn-selection-container[data-selection-id]'
          ) ?? []
        )
      )
      return storedRanges.find((range) => range.id === touchedRangeId) ?? null
    },
    [storedRanges, viewerRootElement]
  )
  const {
    activePointerType: highlightDragPointerType,
    suppressNativeSelection,
    handleHighlightPointerDown,
    handleHighlightPointerMove,
    handleHighlightPointerUp,
    handleHighlightPointerCancel
  } = useHighlightDrag({
    viewerRootElement,
    resolveItem: resolveHighlightDragTarget,
    onDragItem: onDragHighlight
  })

  const handleViewerPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      lastActiveRangeRef.current = null
      handleHighlightPointerDown(event)
      handleTouchPointerDown(event)
    },
    [handleHighlightPointerDown, handleTouchPointerDown]
  )

  const handleViewerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      handleHighlightPointerMove(event)
      handleTouchPointerMove(event)
    },
    [handleHighlightPointerMove, handleTouchPointerMove]
  )

  const handleViewerPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      completeHighlightPointerUp(
        event,
        handleHighlightPointerUp,
        handleTouchPointerUp
      )
    },
    [handleHighlightPointerUp, handleTouchPointerUp]
  )

  const handleViewerPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      handleHighlightPointerCancel(event)
      handleTouchPointerCancel()
    },
    [handleHighlightPointerCancel, handleTouchPointerCancel]
  )

  const handleCommentHighlight = useCallback(() => {
    if (!selectedHighlight || !onCommentHighlight || commentingRangeId) return

    const highlight = selectedHighlight
    const operationDocumentGeneration = documentGeneration
    const operationToken = commentOperationTokenRef.current + 1
    commentOperationTokenRef.current = operationToken
    setCommentingRangeId(highlight.id)
    let commentResult: Promise<unknown>
    try {
      commentResult = onCommentHighlight(highlight)
    } catch {
      if (
        commentOperationDocumentGenerationRef.current ===
          operationDocumentGeneration &&
        commentOperationTokenRef.current === operationToken
      ) {
        setCommentingRangeId(null)
      }
      return
    }
    commentResult.then(
      () => {
        if (
          commentOperationDocumentGenerationRef.current !==
            operationDocumentGeneration ||
          commentOperationTokenRef.current !== operationToken
        ) {
          return
        }
        if (runtimeLinkedDataRef.current.selectedRangeId === highlight.id) {
          handlePageLinkedSelectRange(null)
        }
        setCommentingRangeId(null)
      },
      () => {
        if (
          commentOperationDocumentGenerationRef.current !==
            operationDocumentGeneration ||
          commentOperationTokenRef.current !== operationToken
        ) {
          return
        }
        setCommentingRangeId(null)
      }
    )
  }, [
    commentingRangeId,
    documentGeneration,
    handlePageLinkedSelectRange,
    onCommentHighlight,
    selectedHighlight
  ])

  let resolvedHighlightPopover: ReactNode
  if (typeof highlightPopover === 'function') {
    resolvedHighlightPopover = selectedHighlight
      ? highlightPopover(selectedHighlight)
      : resolvedSelectionPopover
  } else {
    resolvedHighlightPopover = highlightPopover ?? resolvedSelectionPopover
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
      commentOperationTokenRef.current += 1
      pendingTextRangeNavigationRef.current = null
      pendingTextWindowAlignmentRef.current = null
      cancelRestoreAttempt()
      clearAllPreloadEnterTimers()
      clearAllUnloadTimers()
      lazyPageQueueRef.current.cancelAll()
    }
  }, [cancelRestoreAttempt, clearAllPreloadEnterTimers, clearAllUnloadTimers])

  useLayoutEffect(() => {
    activeDocumentRef.current = runtimeDocument
    activePageNumbersKeyRef.current = pageNumbersKey
    contentDocumentGenerationRef.current = documentGeneration
    previousPreloadPageNumbersRef.current = new Set()
    textsByPageNumberRef.current = new Map()
    imagesByPageNumberRef.current = new Map()
    orderedContentByPageNumberRef.current = new Map()
    textElementsRef.current.clear()
    setTextsByPageNumber(new Map())
    setParagraphsByPageNumber(new Map())
    setImagesByPageNumber(new Map())
    setOrderedContentByPageNumber(new Map())
    clearAllPreloadEnterTimers()
    clearAllUnloadTimers()
    lazyPageQueueRef.current.cancelAll()
  }, [
    runtimeDocument,
    documentGeneration,
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

    lazyPageQueueRef.current.replaceRequiredPages(preloadPageNumbers)

    currentPreloadPages.forEach((pageNumber) => {
      clearUnloadTimer(pageNumber)
    })

    if (isInitialPreloadSet) {
      lazyPageQueueRef.current.cancelAll()
      lazyPageQueueRef.current.enqueueInitialPages([...preloadPageNumbers])
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

  useEffect(() => {
    setImagesByPageNumber((currentImages) => {
      const hasEvictedPage = Array.from(currentImages.keys()).some(
        (pageNumber) => !textsByPageNumber.has(pageNumber)
      )
      if (!hasEvictedPage) {
        return currentImages
      }

      return new Map(
        Array.from(currentImages.entries()).filter(([pageNumber]) =>
          textsByPageNumber.has(pageNumber)
        )
      )
    })
  }, [textsByPageNumber])

  useEffect(() => {
    setOrderedContentByPageNumber((currentContent) => {
      const hasEvictedPage = Array.from(currentContent.keys()).some(
        (pageNumber) => !textsByPageNumber.has(pageNumber)
      )
      if (!hasEvictedPage) {
        return currentContent
      }

      return new Map(
        Array.from(currentContent.entries()).filter(([pageNumber]) =>
          textsByPageNumber.has(pageNumber)
        )
      )
    })
  }, [textsByPageNumber])

  // 文档标题用于无障碍标签；缺失时回退到静态文案。
  const title = runtimeDocument?.title

  return (
    <div className='hamster-reader__intermediate-text-shell'>
      <PageBrowser
        isOpen={showPageBrowser}
        pageNumbers={pageNumbers}
        pageSizesByPageNumber={pageSizesByPageNumber}
        baseImagesByPageNumber={EMPTY_TEXT_PAGE_IMAGES}
        onPageVisibilityChange={handleTextPageBrowserVisibilityChange}
        onNavigateToPage={handleReadingProgressSeekPage}
        themeColor={themeColor}
        visiblePageNumbers={visiblePageNumberSet}
        containMarginTop={containMarginTop ?? containMarginY}
        containMarginBottom={containMarginBottom ?? containMarginY}
        ranges={effectiveRanges}
        selectedRangeId={effectiveSelectedRangeId}
        onSelectRange={handlePageLinkedSelectRange}
        onNavigateToRange={scrollToRange}
        onDeleteRange={onRemoveRange}
        commentCountByRangeId={commentCountByRangeId}
        onDeleteRect={onRemoveRect}
        showPagesTab={false}
        bookmarks={bookmarks}
        currentBookmark={readingProgress.anchor}
        activeBookmarkKey={getActiveBookmarkKey(
          readingProgress.anchor,
          fallbackBookmarkKey,
          bookmarks
        )}
        onNavigateToBookmark={resolveBookmarkNavigationHandler(
          bookmarks,
          onToggleBookmark,
          scrollToBookmark
        )}
        isBookmarkNavigationEnabled={isTextBookmark}
        onToggleBookmark={onToggleBookmark}
        bookmarkedPageNumbers={bookmarkedPageNumbers}
        onTogglePageBookmark={onTogglePageBookmark}
        onClose={onPageBrowserClose}
      />
      {pageNumbers.length > 0 ? (
        <ReadingProgress
          mode='text'
          pageProgress={currentPageProgress}
          pageNumbers={pageNumbers}
          currentPageNumber={
            readingProgress.anchor?.pageNumber ??
            readingProgress.currentPageNumber
          }
          isMoving={isReadingProgressMoving}
          ranges={effectiveRanges}
          highlightColor={highlightColor}
          insetTop={containMarginTop ?? containMarginY}
          insetBottom={containMarginBottom ?? containMarginY}
          onSeekPage={handleReadingProgressSeekPage}
          onUserScrollIntent={releaseProgrammaticSuppression}
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
          ...getHighlightDragClassNames(
            suppressNativeSelection,
            highlightDragPointerType
          ),
          className
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid='intermediate-document-text-viewer'
        data-title={title}
        style={{
          paddingLeft: containMarginX,
          paddingRight: containMarginX,
          paddingTop: containMarginTop ?? containMarginY,
          paddingBottom: containMarginBottom ?? containMarginY
        }}
        onPointerDownCapture={handleViewerPointerDown}
        onPointerMoveCapture={handleViewerPointerMove}
        onPointerUpCapture={handleViewerPointerUp}
        onPointerCancelCapture={handleViewerPointerCancel}
      >
        <div className='hamster-reader__intermediate-text-spacer'>
          {previousWindowPageNumber !== undefined ? (
            <button
              className='hamster-reader__intermediate-text-window-button'
              type='button'
              onClick={() =>
                handleReadingProgressSeekPage(
                  previousWindowPageNumber,
                  'user',
                  'end'
                )
              }
            >
              加载上一段
            </button>
          ) : null}
          {visiblePageNumbers.map((pageNumber, windowIndex) => {
            const texts = textsByPageNumber.get(pageNumber)
            const paragraphs = paragraphsByPageNumber.get(pageNumber) ?? []
            const images = imagesByPageNumber.get(pageNumber) ?? []
            const orderedContent = orderedContentByPageNumber.get(pageNumber)
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
                {resolvedSelectionPopover}
              </PopoverPortal>
            ) : undefined
            return (
              <div
                key={`${documentRenderKey}:${pageNumbersKey}:${pageNumber}`}
                data-page-number={pageNumber}
                data-selection-id={pageSelectionId}
                data-testid={`intermediate-text-page-${pageNumber}`}
                className={`hamster-reader__intermediate-text-page${
                  windowIndex > 0
                    ? ' hamster-reader__intermediate-text-page--following'
                    : ''
                }`}
              >
                {isPdf ? (
                  <div
                    aria-hidden='true'
                    className='hamster-reader__intermediate-text-page-marker'
                    data-testid={`pdf-text-page-marker-${pageNumber}`}
                  >
                    第 {pageNumber} 页
                  </div>
                ) : null}
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
                    showSelectionMagnifier={showSelectionMagnifier}
                    ref={selectionRefForRuntimeId(pageSelectionId)}
                  >
                    <IntermediateDocumentTextPageContent
                      pageNumber={pageNumber}
                      texts={texts}
                      paragraphs={paragraphs}
                      images={images}
                      orderedContent={orderedContent}
                      isPdf={isPdf}
                      setTextRef={setTextRef}
                      fontScale={fontScale}
                      onImageSettled={handleImageSettled}
                    />
                  </HamsterSelection>
                ) : (
                  <>Page {pageNumber}</>
                )}
              </div>
            )
          })}
          {nextWindowPageNumber !== undefined ? (
            <button
              className='hamster-reader__intermediate-text-window-button'
              type='button'
              onClick={() =>
                handleReadingProgressSeekPage(nextWindowPageNumber)
              }
            >
              加载下一段
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
