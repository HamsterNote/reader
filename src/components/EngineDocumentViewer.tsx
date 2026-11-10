import { getSelectionGroup } from './selection/selectionGroups'
import {
  resolveReadingProgress,
  type ReadingPosition
} from '../readingProgress'
import { usePdfPreviews } from '../pdf/usePdfPreviews'
import type { PDFDocumentProxy } from '../pdf/pdfjsRuntime'
import { ViewportPaginationControls } from './reading/ViewportPaginationControls'
import { useReadingViewport } from './reading/useReadingViewport'
import {
  type ReactNode,
  type CSSProperties,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { buttonOnlyInput } from './reading/buttonOnlyInput'
import {
  resolveReaderTheme,
  usePrefersColorScheme
} from './Reader/useDefaultBottomBar'
import type { ReaderEngineSource } from '../types/engineSource'
import type { ReaderRenderMode } from '../types/readerOptions'
import type {
  ReaderBookmark,
  ReaderTextReadingProgress
} from '../types/readerData'
import type { SerializedPdfSelection } from '../pdf/pdfSelectionSerializer'
import type {
  ReaderAnnotationHistoryChangeSource,
  ReaderAnnotationHistoryValue,
  ReaderSelectionRange,
  ReaderSelectionRef,
  ReaderSelectionRectangle
} from '../types/selection'
import {
  createEpubEngine,
  type EpubEngine,
  type EpubEngineBookInfo,
  type EpubNavigationState
} from '../epub/foliateEpubEngine'
import {
  PdfDocumentViewer,
  type PdfDocumentViewerRef
} from '../pdf/PdfDocumentViewer'
import type { IntermediateDocumentViewerProps } from './IntermediateDocumentViewer'
import { engineSelectionSegments } from './selection/engineSelectionSegments'
import type { IntermediateText } from '@hamster-note/types'
import {
  AnnotationHistoryContext,
  type AnnotationHistoryController,
  useAnnotationHistory
} from './Reader/useAnnotationHistory'
import { PageBrowser } from './IntermediateDocumentViewer/PageBrowser'
import { ReadingProgress } from './IntermediateDocumentViewer/ReadingProgress'
import {
  isTextBookmark,
  getBookmarkKey
} from './IntermediateDocumentViewer/textAnchor'
import { getCommentCountByHighlightId } from '../comments'
import {
  DefaultSelectionPopover,
  DefaultHighlightPopover,
  type DefaultPopoverContext
} from './DefaultPopover'
import { EngineSelectionControls } from './EngineSelectionControls'
import { EngineHighlightInteractions } from './EngineHighlightInteractions'
import { PopoverPortal } from './PopoverPortal'
import { EpubOutline } from './EpubOutline'
import { getVisiblePageNumbers } from './IntermediateDocumentViewer/pageDisplay'
import { EngineEpubLayoutLayer } from './EngineEpubLayoutLayer'
import { RangeMagnifierProvider } from './IntermediateDocumentViewer/RangeMagnifier'

type Props = IntermediateDocumentViewerProps & {
  readonly enginePopoverContext?: Pick<
    DefaultPopoverContext,
    'onHighlightColorChange' | 'onCommentHighlight'
  >
  readonly engineDarkMode?: boolean
  readonly engineSource?: ReaderEngineSource
  readonly engineRenderMode?: ReaderRenderMode
  readonly textReadingProgress?: ReaderTextReadingProgress
  readonly onTextReadingProgressChange?: (
    progress: ReaderTextReadingProgress
  ) => void
}

type ActiveSelection =
  | { kind: 'text'; range: Range; rangeId: string | null }
  | { kind: 'rectangle'; id: string }
  | null

const pageNumberOf = (id: string) => Number(id.slice(5))

let fallbackRangeIdCounter = 0
function nextRangeId() {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return `range-${globalThis.crypto.randomUUID()}`
  // LAN HTTP previews do not expose randomUUID (a secure-context API).
  return `range-${Date.now().toString(36)}-${++fallbackRangeIdCounter}`
}

function endpointVisible(
  range: ReaderSelectionRange | undefined,
  format: string | undefined,
  page: number,
  end: boolean
) {
  return (
    !range ||
    format !== 'epub' ||
    range[end ? 'end' : 'start'].selectionId === `page-${page}`
  )
}

function prependedCoverVisible(book: EpubEngineBookInfo | null, page: number) {
  return Boolean(book?.cover && page === 1 && book.coverPrepended)
}

function EpubSurface({
  book,
  page,
  mode,
  bindCover,
  allowedPages,
  ...layout
}: Omit<ComponentProps<typeof EngineEpubLayoutLayer>, 'doc'> & {
  book: EpubEngineBookInfo | null
  page: number
  mode: ReaderRenderMode
  doc: Document | null
  bindCover: (element: HTMLDivElement | null) => void
  allowedPages: readonly number[]
}) {
  if (!allowedPages.includes(page)) return null
  const cover = prependedCoverVisible(book, page)
  return (
    <>
      {book?.cover && cover && (
        <div ref={bindCover} className='hamster-reader__epub-cover'>
          <img
            className='hamster-reader__epub-cover'
            src={book.cover.url}
            alt={book.cover.alt ?? '封面'}
          />
        </div>
      )}
      {layout.doc && mode === 'layout' && (
        <EngineEpubLayoutLayer
          {...layout}
          doc={layout.doc}
          pageElement={cover ? layout.pageElement : null}
          pageNumber={cover ? 1 : layout.pageNumber}
        />
      )}
    </>
  )
}

function emptyPageDisplay(count: number, pages: readonly number[]) {
  return count > 0 && pages.length === 0 ? 'none' : undefined
}

function controlledSelection(
  value: string | null | undefined,
  fallback: string | null
) {
  return value === undefined ? fallback : value
}

function firstSelectionRange(selection: Selection | null | undefined) {
  return selection?.rangeCount ? selection.getRangeAt(0) : null
}

function sameNativeRange(left: Range | undefined, right: Range) {
  return (
    left?.startContainer.ownerDocument === right.startContainer.ownerDocument &&
    left.compareBoundaryPoints(Range.START_TO_START, right) === 0 &&
    left.compareBoundaryPoints(Range.END_TO_END, right) === 0
  )
}

function sameEndpoints(
  left: ReaderSelectionRange,
  right: Pick<SerializedPdfSelection, 'start' | 'end'>
) {
  return (
    left.start.selectionId === right.start.selectionId &&
    left.start.offset === right.start.offset &&
    left.end.selectionId === right.end.selectionId &&
    left.end.offset === right.end.offset
  )
}

function enginePageNumbers(pageCount: number, props: Props) {
  return getVisiblePageNumbers(
    Array.from({ length: pageCount }, (_, index) => index + 1),
    props.pageRange
  ).filter(
    (number) =>
      props.edgeCropEditing ||
      !(props.hiddenPages ?? []).some(
        (hidden) => hidden === number || hidden === `page-${number}`
      )
  )
}

function useGeneratedOcr(source: ReaderEngineSource | undefined) {
  const generated = useRef<{
    source: typeof source
    texts: Record<number, readonly IntermediateText[]>
  }>({ source, texts: {} })
  if (generated.current.source !== source)
    generated.current = { source, texts: {} }
  return generated
}

function annotationPopup<T>(
  item: T | undefined,
  popover: ReactNode | ((item: T) => ReactNode),
  fallback: ReactNode
) {
  if (!item) return fallback
  return typeof popover === 'function' ? popover(item) : popover
}

function forwardPublicationPointer(
  root: HTMLElement | null,
  event: PointerEvent
) {
  if (!root) return
  const frame = (
    event.currentTarget as Document
  ).defaultView?.frameElement?.getBoundingClientRect()
  root.dispatchEvent(
    new PointerEvent(event.type, {
      bubbles: true,
      cancelable: true,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX + (frame?.left ?? 0),
      clientY: event.clientY + (frame?.top ?? 0)
    })
  )
}

function epubViewportStyle(
  source: ReaderEngineSource | undefined,
  inset: number,
  props: Props
): CSSProperties | undefined {
  if (source?.format !== 'epub') return undefined
  return {
    '--epub-bottom-inset': `${Math.max(inset, (props.containMarginBottom ?? props.containMarginY ?? 0) + 8)}px`
  } as CSSProperties
}

/** Shared reader UI over Foliate and the official PDFViewer. No storage owner here. */
function sharedHistoryPresent(history: AnnotationHistoryController | null) {
  return history?.getStatus().enabled ? history.getPresent() : undefined
}

export function EngineDocumentViewer(props: Props) {
  const { engineSource: source, engineRenderMode: mode = 'layout' } = props
  const preferredTheme = usePrefersColorScheme()
  const theme = resolveReaderTheme(props.engineDarkMode, preferredTheme)
  const [navigation, setNavigation] = useState<EpubNavigationState>({
    canPrevious: false,
    canNext: false,
    busy: true
  })
  const [epubReady, setEpubReady] = useState(false)
  const pagination = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const [epubDocument, setEpubDocument] = useState<Document | null>(null)
  const [epubPage, setEpubPage] = useState(1)
  const [coverElement, setCoverElement] = useState<HTMLDivElement | null>(null)
  const bindRoot = useCallback((element: HTMLDivElement | null) => {
    root.current = element
    setRootElement(element)
  }, [])
  const epubContainer = useRef<HTMLDivElement>(null)
  const epub = useRef<EpubEngine | null>(null)
  const pdf = useRef<PdfDocumentViewerRef>(null)
  const latest = useRef(props)
  latest.current = props
  const generatedOcr = useGeneratedOcr(source)
  const publishOcr = useCallback((page: number, texts: IntermediateText[]) => {
    generatedOcr.current.texts[page] = texts
    latest.current.onOcrTextsChange?.(page, texts)
  }, [])
  const [retry, setRetry] = useState(0)
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [book, setBook] = useState<EpubEngineBookInfo | null>(null)
  const [unlocatable, setUnlocatable] = useState<readonly string[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [activeSelection, setActiveSelection] = useState<ActiveSelection>(null)
  const activeText = useRef<{ range: Range; rangeId: string | null } | null>(
    null
  )
  const pendingRemoval = useRef(new Set<string>())
  const rangeActionGeneration = useRef(0)
  const rangeActionToken = rangeActionGeneration.current
  const nativeRange =
    activeSelection?.kind === 'text' ? activeSelection.range : null
  const [epubInteractiveRange, setEpubInteractiveRange] =
    useState<Range | null>(null)
  const cancelEpubHandoff = useRef(() => {})
  const setNativeRange = useCallback(
    (range: Range | null, rangeId: string | null = null) => {
      activeText.current = range ? { range, rangeId } : null
      setActiveSelection((current) => {
        if (range) return { kind: 'text', range, rangeId }
        return current?.kind === 'text' ? null : current
      })
    },
    []
  )
  useLayoutEffect(() => {
    setEpubInteractiveRange(null)
    if (source?.format !== 'epub' || !nativeRange) return
    const selection = nativeRange.startContainer.ownerDocument?.getSelection()
    if (selection && !selection.isCollapsed) return
    // Give WebKit a painting opportunity after native Selection is removed.
    // This is a UI gate, not an acknowledgement from UIKit.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEpubInteractiveRange(nativeRange))
    })
    return () => cancelAnimationFrame(frame)
  }, [source, nativeRange])
  const sharedHistory = useContext(AnnotationHistoryContext)
  const [internalRanges, setInternalRanges] = useState(
    sharedHistory?.getPresent().ranges ?? props.defaultRanges ?? []
  )
  const [internalRects, setInternalRects] = useState<
    ReaderSelectionRectangle[]
  >(() => sharedHistory?.getPresent().rects ?? [])
  const [internalSelected, setInternalSelected] = useState<string | null>(
    props.defaultSelectedRangeId ?? null
  )
  const [internalRectId, setInternalRectId] = useState<string | null>(null)
  const [draftRectangle, setDraftRectangle] =
    useState<ReaderSelectionRectangle | null>(null)
  const pdfTouch = source?.format === 'pdf'

  const editing = useRef(false)
  const activating = useRef(false)
  const restored = useRef(false)
  const progressEnabled = useRef(false)
  useEffect(() => {
    if (!rootElement) return
    // Native capture runs before PDF portal/drag listeners can stop the event.
    const down = () => {
      progressEnabled.current = true
    }
    const keydown = () => {
      progressEnabled.current = true
    }
    rootElement.addEventListener('keydown', keydown, true)
    rootElement.addEventListener('pointerdown', down, true)
    return () => {
      rootElement.removeEventListener('pointerdown', down, true)
      rootElement.removeEventListener('keydown', keydown, true)
    }
  }, [rootElement])
  // The file owner also supplies uncontrolled content after a source reset.
  const sharedPresent = sharedHistoryPresent(sharedHistory)
  const ranges = props.ranges ?? sharedPresent?.ranges ?? internalRanges
  const rects = props.rects ?? sharedPresent?.rects ?? internalRects
  const selected = controlledSelection(props.selectedRangeId, internalSelected)
  const selectedRect = controlledSelection(props.selectedRectId, internalRectId)
  const values = useRef({ ranges, rects, selected, selectedRect })
  values.current = { ranges, rects, selected, selectedRect }
  const snapshot = (): ReaderAnnotationHistoryValue => ({
    ranges: values.current.ranges,
    rects: values.current.rects,
    selectedRangeId: values.current.selected,
    selectedRectId: values.current.selectedRect
  })
  const history = useAnnotationHistory({
    enabled: props.annotationHistory?.enabled ?? false,
    initialValue: snapshot(),
    onChange: (next, detail) =>
      latest.current.onAnnotationHistoryChange?.(next, detail)
  })
  const historyRef = useRef(history)
  historyRef.current = history
  const status = history.getStatus()
  const statusKey = JSON.stringify(status)
  const { bottomInset: paginationInset } = useReadingViewport({
    root: rootElement,
    controlsRef: pagination,
    enabled: source?.format === 'epub',
    bottomInset: props.containMarginBottom ?? props.containMarginY ?? 0
  })
  useEffect(() => {
    latest.current.onAnnotationHistoryStatusChange?.(JSON.parse(statusKey))
  }, [statusKey])
  const resetKey = props.annotationHistory?.resetKey
  useLayoutEffect(() => {
    pendingRemoval.current.clear()
  }, [source, resetKey])
  useEffect(() => {
    if (!sharedHistory) historyRef.current.reset(snapshot(), 'reset')
  }, [source, resetKey])
  const annotationsKey = JSON.stringify(snapshot())
  useEffect(() => {
    // A controlled deletion becomes a checkpoint only when the host accepts it.
    // Keep the preceding present until the reconciliation effect records that step.
    if (
      latest.current.ranges !== undefined &&
      [...pendingRemoval.current].some(
        (id) => !values.current.ranges.some((item) => item.id === id)
      )
    )
      return
    if (!sharedHistory)
      historyRef.current.syncSilent(JSON.parse(annotationsKey))
  }, [annotationsKey])

  const apply = (
    next: ReaderAnnotationHistoryValue,
    reason: ReaderAnnotationHistoryChangeSource
  ) => {
    if (latest.current.ranges === undefined) setInternalRanges(next.ranges)
    if (latest.current.rects === undefined) setInternalRects(next.rects)
    if (latest.current.selectedRangeId === undefined)
      setInternalSelected(next.selectedRangeId)
    if (latest.current.selectedRectId === undefined)
      setInternalRectId(next.selectedRectId)
    historyRef.current.setCheckpoint(next, reason)
  }
  const activationGeneration = useRef(0)
  const activate = useCallback((id: string | null) => {
    if (id) {
      if (!values.current.ranges.some((item) => item.id === id)) return
      // The host may reject deletion and retain the authoritative range.
      // A new activation starts a fresh session; captured actions from before
      // deletion remain invalidated by rangeActionGeneration.
      if (pendingRemoval.current.has(id)) {
        if (latest.current.ranges === undefined) return
        pendingRemoval.current.delete(id)
      }
    }
    editing.current = false
    const selection =
      activeText.current?.range.startContainer.ownerDocument?.getSelection()
    // A host can confirm inside an end callback. Keep that callback's native
    // Selection alive until the pending handoff finishes all consumers.
    const nativeConfirmation = Boolean(
      epub.current &&
      id &&
      activeText.current?.rangeId === id &&
      selection &&
      !selection.isCollapsed
    )
    const token = nativeConfirmation
      ? activationGeneration.current
      : ++activationGeneration.current
    setInternalSelected(id)
    latest.current.onSelectRange?.(id)
    latest.current.onLinkedSelectRange?.(id)
    if (!id) {
      activating.current = false
      setNativeRange(null)
      epub.current?.setActiveRange(null)
      epub.current?.clearSelection()
      pdf.current?.clearSelection()
      return
    }
    setInternalRectId(null)
    latest.current.onSelectRect?.(null)
    setDraftRectangle(null)
    activating.current = true
    if (epub.current) {
      if (nativeConfirmation) {
        epub.current.setActiveRange(id)
        activating.current = false
        return
      }
      const engine = epub.current
      engine
        .selectRange(id)
        .then((range) => {
          if (
            token !== activationGeneration.current ||
            epub.current !== engine ||
            !values.current.ranges.some((item) => item.id === id) ||
            pendingRemoval.current.has(id)
          )
            return
          setNativeRange(range, id)
          epub.current?.setActiveRange(range ? id : null)
          activating.current = false
        })
        .catch(() => {
          if (token === activationGeneration.current) activating.current = false
        })
    } else {
      setNativeRange(pdf.current?.selectRange(id) ?? null, id)
      activating.current = false
    }
  }, [])
  const emitRange = (range: ReaderSelectionRange, update: boolean) => {
    if (
      update &&
      (pendingRemoval.current.has(range.id) ||
        !values.current.ranges.some((item) => item.id === range.id))
    )
      return
    const next = update
      ? values.current.ranges.map((item) =>
          item.id === range.id ? range : item
        )
      : [...values.current.ranges, range]
    apply(
      {
        ...snapshot(),
        ranges: next,
        selectedRangeId: range.id,
        selectedRectId: null
      },
      update ? 'update-range' : 'highlight'
    )
    if (update) {
      latest.current.onUpdateRange?.(range)
      latest.current.onLinkedUpdateRange?.(range)
    } else {
      latest.current.onSelect?.(range)
      latest.current.onLinkedSelect?.(range)
      latest.current.onHighlight?.(range)
    }
    latest.current.onLinkedDataChange?.({
      items: next,
      selectedRangeId: range.id,
      activeRange: range,
      selectionOrder: Array.from(
        new Set(
          next.flatMap((item) => [item.start.selectionId, item.end.selectionId])
        )
      )
    })
    setInternalSelected(range.id)
  }
  const serialize = () =>
    epub.current?.serializeCurrentSelection() ??
    pdf.current?.serializeSelection() ??
    null
  const confirmRectangle = () => {
    if (!draftRectangle) return
    const color = latest.current.highlightColor ?? '#ffc107'
    const rectangle = {
      ...draftRectangle,
      markerStyle: {
        ...draftRectangle.markerStyle,
        backgroundColor: color
      }
    }
    apply(
      {
        ...snapshot(),
        rects: [...values.current.rects, rectangle],
        selectedRangeId: null,
        selectedRectId: rectangle.id
      },
      'create-rect'
    )
    latest.current.onCreateRect?.(rectangle)
    latest.current.onSelectRect?.(rectangle.id)
    setDraftRectangle(null)
  }
  const confirm = () => {
    if (latest.current.selectedTool === 'rect-selection') {
      confirmRectangle()
      return
    }
    if (
      editing.current ||
      activating.current ||
      !restored.current ||
      !activeText.current ||
      activeText.current.rangeId ||
      latest.current.selectedTool !== 'text-selection'
    )
      return
    const detail = serialize()
    if (!detail || !detail.text) return
    const range: ReaderSelectionRange = {
      ...detail,
      id: nextRangeId(),
      createdAt: Date.now(),
      rectsBySelectionId:
        (detail as SerializedPdfSelection).rectsBySelectionId ?? {},
      overlayRectType: latest.current.overlayRectType ?? 'percent',
      markerStyle: {
        backgroundColor: latest.current.highlightColor ?? '#ffc107'
      }
    }
    setNativeRange(activeText.current.range, range.id)
    emitRange(range, false)
  }
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  const selectionCallbackGeneration = useRef({ change: 0, end: 0 })
  const emitSelectionCallbacks = useCallback(async (end = false) => {
    const kind = end ? 'end' : 'change'
    const token = ++selectionCallbackGeneration.current[kind]
    const detail = serialize()
    const native = root.current?.ownerDocument.getSelection()
    const range =
      latest.current.engineSource?.format === 'epub'
        ? epub.current?.getSelectionRange()
        : (pdf.current?.getSelectionRange() ?? firstSelectionRange(native))
    const selection = range?.startContainer.ownerDocument?.getSelection()
    if (!detail || !selection || !latest.current.document) return
    const startPage = pageNumberOf(detail.start.selectionId)
    const { texts, segments } = await engineSelectionSegments(
      latest.current.document,
      detail,
      { ...generatedOcr.current.texts, ...latest.current.ocrTexts }
    ).catch(() => ({ texts: [], segments: [] }))
    if (token !== selectionCallbackGeneration.current[kind] || !texts[0]) return
    const payload = {
      text: texts[0],
      texts,
      selectedText: detail.text,
      pageNumber: startPage,
      selection
    }
    if (end) latest.current.onTextSelectionEnd?.(texts[0], payload)
    else latest.current.onTextSelectionChange?.(texts[0], payload)
    if (end) latest.current.onSelectText?.(selection, segments, detail.text)
  }, [])
  const selectionChanged = useCallback(() => {
    if (editing.current || activating.current) return
    const selection = root.current?.ownerDocument.getSelection()
    const range =
      latest.current.engineSource?.format === 'epub'
        ? epub.current?.getSelectionRange()
        : (pdf.current?.getSelectionRange() ?? firstSelectionRange(selection))
    const detail = serialize()
    if (detail && range) {
      const current = values.current.ranges.find(
        (item) =>
          item.id === values.current.selected &&
          !pendingRemoval.current.has(item.id)
      )
      const active = activeText.current
      const sameRange =
        current &&
        active?.rangeId === current.id &&
        (sameNativeRange(active.range, range) || sameEndpoints(current, detail))
      if (values.current.selected && !sameRange) {
        setInternalSelected(null)
        latest.current.onSelectRange?.(null)
        latest.current.onLinkedSelectRange?.(null)
        epub.current?.setActiveRange(null)
      }
      if (values.current.selectedRect) {
        setInternalRectId(null)
        latest.current.onSelectRect?.(null)
      }
      setDraftRectangle(null)
      ++activationGeneration.current
      setNativeRange(range.cloneRange(), sameRange ? current.id : null)
      return emitSelectionCallbacks()
    } else {
      ++selectionCallbackGeneration.current.change
      ++selectionCallbackGeneration.current.end
      epub.current?.setActiveRange(null)
      setNativeRange(null)
    }
  }, [emitSelectionCallbacks])

  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const previews = usePdfPreviews(
    pdfDocument,
    Boolean(props.showPageBrowser),
    () => pdf.current?.isRendering() ?? true,
    (document, page) => pdf.current?.releasePreviewPage(document, page)
  )
  const capturePdfPosition = () => {
    const result = pdf.current?.captureReadingPosition()
    return result?.status === 'ready' ? result.position : undefined
  }
  const emittedLayoutPositions = useRef(new Set<string>())
  // A controlled host can return the same emitted object more than once (e.g.
  // a debounced save crossing crop reflow). A consumed key alone loses that
  // provenance and turns the second echo into an explicit bookmark navigation.
  const emittedLayoutBookmarks = useRef(new WeakSet<ReaderBookmark>())
  const publishPosition = useCallback(
    (pageNumber: number, captured?: ReadingPosition) => {
      setPage(pageNumber)
      if (!restored.current || !progressEnabled.current) return
      const result =
        captured ??
        epub.current?.captureReadingPosition() ??
        pdf.current?.captureReadingPosition()
      const position = result?.status === 'ready' ? result.position : undefined
      if (!position) return
      const textAnchor = isTextBookmark(position) ? position : undefined
      latest.current.onTextAnchorChange?.(textAnchor)
      if (latest.current.engineRenderMode === 'text')
        latest.current.onTextReadingProgressChange?.({
          currentPageNumber: position.pageNumber,
          ...(textAnchor
            ? { anchor: textAnchor }
            : {
                verticalPercentage:
                  'verticalPercentage' in position
                    ? position.verticalPercentage
                    : 0
              })
        })
      else {
        emittedLayoutPositions.current.add(getBookmarkKey(position))
        emittedLayoutBookmarks.current.add(position)
        if (emittedLayoutPositions.current.size > 32)
          emittedLayoutPositions.current.delete(
            emittedLayoutPositions.current.values().next().value!
          )
        latest.current.onLayoutReadingProgressChange?.(position)
      }
    },
    []
  )
  const cancelSelection = useCallback((clear = true) => {
    cancelEpubHandoff.current()
    ++activationGeneration.current
    ++selectionCallbackGeneration.current.change
    ++selectionCallbackGeneration.current.end
    activating.current = false
    editing.current = false
    setNativeRange(null)
    if (clear) {
      epub.current?.clearSelection()
      pdf.current?.clearSelection()
    }
    epub.current?.setActiveRange(null)
  }, [])
  const navigate = useCallback(
    (pageNumber: number) => {
      ++pdfNavigationGeneration.current
      progressEnabled.current = true
      cancelSelection()
      if (epub.current) epub.current.goToPage(pageNumber).catch(() => undefined)
      else pdf.current?.scrollToPage(pageNumber)
    },
    [publishPosition]
  )
  const pdfNavigationGeneration = useRef(0)
  useEffect(() => {
    if (source?.format === 'pdf') {
      restored.current = false
      progressEnabled.current = false
      emittedLayoutPositions.current.clear()
      emittedLayoutBookmarks.current = new WeakSet()
    }
    return () => {
      ++pdfNavigationGeneration.current
    }
  }, [source])
  const navigateBookmark = (bookmark: ReaderBookmark, publish = true) => {
    if (epub.current) {
      return epub.current.goToPosition(bookmark)
    }
    const generation = ++pdfNavigationGeneration.current
    progressEnabled.current = false
    return pdf.current
      ?.scrollToAnchor(bookmark, { preserveOnFailure: publish })
      .then(() => {
        if (generation !== pdfNavigationGeneration.current) return
        if (publish) {
          progressEnabled.current = true
          publishPosition(bookmark.pageNumber)
        }
      })
      .catch((failure: Error) => {
        if (generation !== pdfNavigationGeneration.current) return
        setError(failure.message)
        throw failure
      })
  }
  const lastLayoutRequest = useRef(props.layoutReadingProgress)
  useEffect(() => {
    const target = props.layoutReadingProgress
    if (
      source?.format !== 'pdf' ||
      !target ||
      !restored.current ||
      lastLayoutRequest.current === target
    )
      return
    lastLayoutRequest.current = target
    const emitted = emittedLayoutPositions.current.delete(
      getBookmarkKey(target)
    )
    if (emitted || emittedLayoutBookmarks.current.has(target)) {
      emittedLayoutBookmarks.current.add(target)
      return
    }
    const actual = capturePdfPosition()
    if (!actual || getBookmarkKey(actual) !== getBookmarkKey(target))
      navigateBookmark(target)?.catch(() => undefined)
  }, [props.layoutReadingProgress, pdfDocument])
  const restorePosition = () => {
    const current = latest.current
    const progress = resolveReadingProgress(
      {
        layoutReadingProgress: current.layoutReadingProgress,
        virtualPaper: current.defaultVirtualPaperTransform,
        textReadingProgress: current.textReadingProgress
      },
      current.engineRenderMode ?? 'layout'
    )
    if (!progress) return Promise.resolve()
    const allowed = enginePageNumbers(pageCountRef.current, current)
    const targetPage =
      allowed.length && !allowed.includes(progress.pageNumber)
        ? (allowed.find((page) => page >= progress.pageNumber) ??
          allowed.at(-1)!)
        : progress.pageNumber
    const fallback = { pageNumber: targetPage, verticalPercentage: 0 }
    const target = targetPage === progress.pageNumber ? progress : fallback
    if (target !== progress)
      setRestoreNotice('原阅读页当前不可见，已显示相邻页；原进度已保留')
    return Promise.resolve(navigateBookmark(target, false)).catch((failure) => {
      if (failure instanceof Error && failure.name === 'AbortError') return
      setRestoreNotice('无法精确恢复阅读位置，已显示原页；原进度已保留')
      pdf.current?.scrollToPage(fallback.pageNumber)
    })
  }
  const restorePositionRef = useRef(restorePosition)
  restorePositionRef.current = restorePosition
  const onPdfReady = useCallback(async (count: number) => {
    const activeSource = latest.current.engineSource
    pageCountRef.current = count
    setPageCount(count)
    // PDF pages are available independently of which navigation wins. Pending
    // restores still block publication via progressEnabled/captureReadingPosition.
    restored.current = true
    const restoration = restorePositionRef.current()
    const generation = pdfNavigationGeneration.current
    try {
      await restoration
      if (
        generation !== pdfNavigationGeneration.current ||
        activeSource !== latest.current.engineSource
      )
        return
      // Readiness must not itself publish/migrate stored progress. User input
      // or an explicit navigation enables saves, including replacement seeks.
    } catch (failure) {
      if (
        generation !== pdfNavigationGeneration.current ||
        (failure instanceof Error && failure.name === 'AbortError')
      )
        return
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [])
  const onPdfTextReady = useCallback((loadedPages: readonly number[]) => {
    latest.current.onPageLoadStatusChange?.([...loadedPages])
    const position = capturePdfPosition()
    if (position) publishPosition(position.pageNumber)
    const id = values.current.selected
    if (id && !editing.current) {
      activating.current = true
      setNativeRange(pdf.current?.selectRange(id) ?? null, id)
      activating.current = false
    }
  }, [])

  useEffect(() => {
    if (source?.format !== 'epub' || !epubContainer.current) return
    let cancelled = false
    let restoreFrame = 0
    let handoffFrame = 0
    let handoffGeneration = 0
    let pointerActive = false
    let touchActive = false
    let ended = false
    let endPoint: { x: number; y: number } | null = null
    let changeCallbacks: Promise<void> | undefined
    const invalidateHandoff = () => {
      ++handoffGeneration
      ++selectionCallbackGeneration.current.end
      cancelAnimationFrame(handoffFrame)
    }
    const cancelHandoff = () => {
      invalidateHandoff()
      pointerActive = false
      touchActive = false
      ended = false
      endPoint = null
      changeCallbacks = undefined
      ++selectionCallbackGeneration.current.change
      ++selectionCallbackGeneration.current.end
    }
    cancelEpubHandoff.current = cancelHandoff
    const queueHandoff = () => {
      invalidateHandoff()
      if (cancelled || pointerActive || touchActive) return
      const token = handoffGeneration
      handoffFrame = requestAnimationFrame(() => {
        void (async () => {
          const active = activeText.current
          const range = engine.getSelectionRange()?.cloneRange()
          if (cancelled || token !== handoffGeneration || !active || !range)
            return
          const activation = activationGeneration.current
          const selection = range.startContainer.ownerDocument?.getSelection()
          if (endPoint && !ended && selection && !selection.isCollapsed) {
            ended = true
            latest.current.onSelectionEnd?.(endPoint, selection)
          }
          // Consumers read the live Selection during these callbacks. Do not
          // empty it while asynchronous text extraction is still in flight.
          await Promise.all([
            changeCallbacks,
            endPoint ? emitSelectionCallbacks(true) : undefined
          ])
          if (
            cancelled ||
            token !== handoffGeneration ||
            activation !== activationGeneration.current ||
            !activeText.current ||
            !sameNativeRange(activeText.current.range, active.range) ||
            !range.startContainer.isConnected ||
            !range.endContainer.isConnected
          )
            return
          const rangeId = activeText.current.rangeId
          engine.setSelectionRange(range)
          setNativeRange(range, rangeId)
          const confirmDraft =
            endPoint && latest.current.autoHighlight && !rangeId
          endPoint = null
          if (confirmDraft) confirmRef.current()
        })()
      })
    }
    const listeners = new Map<Document, () => void>()
    restored.current = false
    progressEnabled.current = false
    setError(null)
    setEpubReady(false)
    setBook(null)
    setEpubDocument(null)
    cancelSelection()
    pendingRemoval.current.clear()
    const restoreActiveRange = (engine: EpubEngine) => {
      const id = values.current.selected
      if (id && !editing.current && !pendingRemoval.current.has(id)) {
        cancelHandoff()
        // Foliate may still move/collapse the native selection after relocate.
        // Restore against the live iframe once that navigation has settled.
        const token = ++activationGeneration.current
        activating.current = true
        cancelAnimationFrame(restoreFrame)
        restoreFrame = requestAnimationFrame(() => {
          if (
            cancelled ||
            token !== activationGeneration.current ||
            epub.current !== engine
          )
            return
          const part = engine.getRangePart(id)
          engine.setSelectionRange(part ?? null)
          setNativeRange(part?.cloneRange() ?? null, id)
          engine.setActiveRange(part ? id : null)
          activating.current = false
        })
      }
    }
    const engine = createEpubEngine({
      container: epubContainer.current,
      source: source.data,
      fontScale: latest.current.fontScale,
      flow: 'paginated',
      onNavigationState: (state) => {
        if (!cancelled) setNavigation(state)
      },
      selectionColor: latest.current.selectionColor,
      onSelection: () => {
        changeCallbacks = selectionChanged()
        queueHandoff()
      },
      onHighlightActivate: activate,
      onDocumentLoad: (doc, pageNumber) => {
        setEpubDocument(doc)
        setEpubPage(pageNumber)
        setNativeRange(null)
        latest.current.onPageLoadStatusChange?.([pageNumber])
        const forward = (event: PointerEvent) =>
          forwardPublicationPointer(root.current, event)
        const pointerEvents = [
          'pointerdown',
          'pointermove',
          'pointerup',
          'pointercancel'
        ] as const
        pointerEvents.forEach((type) =>
          doc.addEventListener(type, forward, true)
        )
        const down = (event: PointerEvent) => {
          invalidateHandoff()
          ++selectionCallbackGeneration.current.change
          pointerActive = true
          ended = false
          endPoint = null
          setEpubInteractiveRange(null)
          ++activationGeneration.current
          activating.current = false
          progressEnabled.current = true
          const selection = doc.getSelection()
          if (selection)
            latest.current.onSelectionStart?.(
              { x: event.clientX, y: event.clientY },
              selection
            )
        }
        const up = (event: PointerEvent) => {
          pointerActive = false
          const activation = activationGeneration.current
          const selection = doc.getSelection()
          if (!ended && selection && !selection.isCollapsed) {
            ended = true
            latest.current.onSelectionEnd?.(
              { x: event.clientX, y: event.clientY },
              selection
            )
          }
          if (editing.current || activation !== activationGeneration.current)
            return
          endPoint = { x: event.clientX, y: event.clientY }
          changeCallbacks = selectionChanged()
          queueHandoff()
        }
        const touchStart = (event: TouchEvent) => {
          if (!pointerActive && !touchActive) {
            ended = false
            endPoint = null
          }
          touchActive = event.touches.length > 0
          invalidateHandoff()
          setEpubInteractiveRange(null)
        }
        const touchEnd = (event: TouchEvent) => {
          touchActive = event.touches.length > 0
          if (touchActive || editing.current) return
          pointerActive = false
          const touch = event.changedTouches[0]
          if (!endPoint && touch)
            endPoint = { x: touch.clientX, y: touch.clientY }
          changeCallbacks = selectionChanged()
          queueHandoff()
        }
        const pointerCancel = () => {
          pointerActive = false
          if (!touchActive) {
            endPoint = null
            ++selectionCallbackGeneration.current.end
            queueHandoff()
          }
        }
        const touchCancel = () => {
          pointerActive = false
          touchActive = false
          endPoint = null
          ++selectionCallbackGeneration.current.end
          queueHandoff()
        }
        doc.addEventListener('pointerdown', down, true)
        doc.addEventListener('pointerup', up)
        doc.addEventListener('pointercancel', pointerCancel)
        doc.addEventListener('touchstart', touchStart, { passive: true })
        doc.addEventListener('touchend', touchEnd)
        doc.addEventListener('touchcancel', touchCancel)
        const interacted = () => {
          progressEnabled.current = true
        }
        doc.addEventListener('wheel', interacted, { passive: true })
        doc.addEventListener('keydown', interacted)
        listeners.set(doc, () => {
          for (const type of pointerEvents)
            doc.removeEventListener(type, forward, true)
          doc.removeEventListener('pointerdown', down, true)
          doc.removeEventListener('pointerup', up)
          doc.removeEventListener('pointercancel', pointerCancel)
          doc.removeEventListener('touchstart', touchStart)
          doc.removeEventListener('touchend', touchEnd)
          doc.removeEventListener('touchcancel', touchCancel)
          doc.removeEventListener('wheel', interacted)
          doc.removeEventListener('keydown', interacted)
        })
        restoreActiveRange(engine)
      },
      onDocumentUnload: (doc) => {
        cancelHandoff()
        if (activeText.current?.range.startContainer.ownerDocument === doc)
          cancelSelection(false)
        listeners.get(doc)?.()
        listeners.delete(doc)
      },
      onError: (failure) => {
        if (!cancelled) setError(failure.message)
      },
      onRelocate: (location) => {
        if (cancelled) return
        if (location.pageNumber) publishPosition(location.pageNumber)
        restoreActiveRange(engine)
      }
    })
    epub.current = engine
    engine.ready
      .then(async (info) => {
        if (cancelled) return
        pageCountRef.current = info.pageCount
        setPageCount(info.pageCount)
        await engine.setHiddenPages(
          latest.current.hiddenPages ?? [],
          latest.current.edgeCropEditing,
          latest.current.pageRange
        )
        if (
          info.coverPrepended &&
          !latest.current.layoutReadingProgress &&
          !latest.current.textReadingProgress
        )
          await engine.goToPage(1)
        const report = engine.showRanges(values.current.ranges)
        setUnlocatable(report.unlocatable.map((item) => item.id))
        await restorePositionRef.current()
        if (cancelled) return
        restored.current = true
        setBook(info)
        setEpubReady(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      invalidateHandoff()
      cancelAnimationFrame(restoreFrame)
      restored.current = false
      cancelSelection(false)
      listeners.forEach((remove) => remove())
      listeners.clear()
      epub.current = null
      engine.destroy().catch(() => undefined)
      if (cancelEpubHandoff.current === cancelHandoff)
        cancelEpubHandoff.current = () => {}
    }
  }, [
    source,
    retry,
    activate,
    publishPosition,
    selectionChanged,
    emitSelectionCallbacks,
    cancelSelection
  ])
  useEffect(
    () => () => {
      activationGeneration.current++
      selectionCallbackGeneration.current.change++
      selectionCallbackGeneration.current.end++
      activating.current = false
    },
    [source]
  )
  useEffect(() => {
    epub.current
      ?.setHiddenPages(
        props.hiddenPages ?? [],
        props.edgeCropEditing,
        props.pageRange
      )
      .catch(() => undefined)
  }, [props.hiddenPages, props.edgeCropEditing, props.pageRange, book])
  useEffect(() => {
    epub.current?.setFontScale(props.fontScale ?? 1)
  }, [props.fontScale])
  // Child layout effects run before the Reader owner's external-content check.
  // Record only host-accepted deletions while the preceding snapshot still exists.
  useLayoutEffect(() => {
    for (const id of pendingRemoval.current) {
      if (!ranges.some((item) => item.id === id)) {
        if (latest.current.ranges !== undefined)
          historyRef.current.setCheckpoint(snapshot(), 'clear')
        pendingRemoval.current.delete(id)
      }
    }
  }, [ranges])
  useEffect(() => {
    const activeId = activeText.current?.rangeId
    if (activeId && !ranges.some((item) => item.id === activeId))
      cancelSelection()
    if (pdf.current && activeId && ranges.some((item) => item.id === activeId))
      setNativeRange(pdf.current.selectRange(activeId), activeId)
    const report = epub.current?.showRanges(ranges)
    if (report) setUnlocatable(report.unlocatable.map((item) => item.id))
  }, [ranges, book])
  useEffect(() => {
    if (!selected) {
      if (activeText.current?.rangeId) setNativeRange(null)
      epub.current?.setActiveRange(null)
      return
    }
    activate(selected)
  }, [selected, activate])
  useEffect(() => {
    setActiveSelection((current) => {
      if (selectedRect) return { kind: 'rectangle', id: selectedRect }
      return current?.kind === 'rectangle' && current.id !== draftRectangle?.id
        ? null
        : current
    })
  }, [selectedRect, draftRectangle])

  useEffect(() => {
    if (source?.format !== 'epub' || !rootElement) return
    // Empty paper and tool overlays also must not scroll the host. Sidebars
    // remain independent scroll regions and are deliberately excluded.
    const paper = (event: Event) => {
      const target = event.target as Element | null
      return !target?.closest?.(
        '[role="dialog"], [role="complementary"], .hamster-reader__page-browser, .hamster-reader__epub-pagination'
      )
    }
    return buttonOnlyInput(rootElement, paper)
  }, [source?.format, rootElement])

  const turnEpub = (forward: boolean) => {
    setError(null)
    progressEnabled.current = true
    cancelSelection()
    epub.current?.[forward ? 'nextPage' : 'previousPage']()
  }

  useImperativeHandle(
    props.readingPositionRef,
    () => ({
      captureTextAnchor: () =>
        epub.current?.captureTextAnchor() ??
        pdf.current?.captureTextAnchor() ??
        undefined,
      captureAndPublish: () => {
        if (!progressEnabled.current) return
        const position =
          epub.current?.captureReadingPosition() ??
          pdf.current?.captureReadingPosition()
        if (!restored.current || position?.status !== 'ready')
          throw new Error('当前阅读位置尚未就绪，保存未确认，请稍后重试')
        publishPosition(pageRef.current, position)
      },
      captureReadingPosition: () => {
        const result =
          epub.current?.captureReadingPosition() ??
          pdf.current?.captureReadingPosition()
        return result?.status === 'ready' ? result.position : undefined
      },
      waitForStable: () => epub.current?.whenStable() ?? Promise.resolve()
    }),
    []
  )
  const commands: ReaderSelectionRef = {
    highlight: confirm,
    confirm,
    confirmRect: confirmRectangle,
    clear: () => {
      apply(
        { ranges: [], rects: [], selectedRangeId: null, selectedRectId: null },
        'clear'
      )
      cancelSelection()
      setActiveSelection(null)
      setDraftRectangle(null)
    },
    scrollToRange: (id) => {
      ++pdfNavigationGeneration.current
      progressEnabled.current = true
      if (epub.current) epub.current.goToRange(id)
      else pdf.current?.scrollToRange(id)
    },
    scrollToRect: (id) => {
      const rectangle = rects.find((item) => item.id === id)
      if (rectangle?.selectionId) navigate(pageNumberOf(rectangle.selectionId))
    },
    scrollToPosition: (position) => {
      const container = root.current?.querySelector(
        '.hamster-reader__pdf-viewer-container'
      )
      container?.scrollTo(position.x, position.y)
      if (position.scale) pdf.current?.setScale(position.scale)
    },
    undo: () => {
      historyRef.current.cancelInput()
      if ((props.ranges || props.rects) && !props.onAnnotationHistoryChange)
        return false
      const result = historyRef.current.undo()
      if (result.applied) {
        setInternalRanges(result.target.ranges)
        setInternalRects(result.target.rects)
        setInternalSelected(result.target.selectedRangeId)
        setInternalRectId(result.target.selectedRectId)
      }
      return result.applied
    },
    redo: () => {
      historyRef.current.cancelInput()
      if ((props.ranges || props.rects) && !props.onAnnotationHistoryChange)
        return false
      const result = historyRef.current.redo()
      if (result.applied) {
        setInternalRanges(result.target.ranges)
        setInternalRects(result.target.rects)
        setInternalSelected(result.target.selectedRangeId)
        setInternalRectId(result.target.selectedRectId)
      }
      return result.applied
    },
    canUndo: () => historyRef.current.getStatus().canUndo,
    canRedo: () => historyRef.current.getStatus().canRedo,
    getAnnotationHistoryState: () => historyRef.current.getStatus()
  }
  useImperativeHandle(props.selectionRef, () => commands)
  const pdfSource = useMemo(
    () => (source ? { data: source.data.slice() } : null),
    [source, retry]
  )
  useEffect(() => {
    if (source?.format === 'pdf') {
      restored.current = false
      progressEnabled.current = false
      setRestoreNotice(null)
    }
  }, [source, retry])
  const pageRef = useRef(page)
  pageRef.current = page
  const pageCountRef = useRef(pageCount)
  pageCountRef.current = pageCount
  const pageNumbers = enginePageNumbers(pageCount, props)
  const visiblePageNumbers = useMemo(() => new Set([page]), [page])
  const current = ranges.find(
    (range) =>
      range.id ===
      (activeSelection?.kind === 'text' ? activeSelection.rangeId : null)
  )
  const currentRectangle = rects.find((item) => item.id === selectedRect)
  const rectanglePopup = annotationPopup(
    currentRectangle,
    props.rectPopover,
    props.selectionPopover ?? (
      <DefaultSelectionPopover
        selectionRef={{ current: commands }}
        highlightColor={props.highlightColor}
        darkMode={props.engineDarkMode}
        {...props.enginePopoverContext}
      />
    )
  )
  const removeRange = (id: string) => {
    if (
      pendingRemoval.current.has(id) ||
      !values.current.ranges.some((item) => item.id === id)
    )
      return
    pendingRemoval.current.add(id)
    ++rangeActionGeneration.current
    cancelSelection()
    setInternalSelected(null)
    latest.current.onSelectRange?.(null)
    latest.current.onLinkedSelectRange?.(null)
    if (latest.current.ranges === undefined) {
      apply(
        {
          ...snapshot(),
          ranges: values.current.ranges.filter((item) => item.id !== id),
          selectedRangeId: null
        },
        'clear'
      )
    }
    latest.current.onRemoveRange?.(id)
  }
  const menuContext: DefaultPopoverContext = {
    darkMode: props.engineDarkMode,
    selectionRef: { current: commands },
    highlightColor: props.highlightColor,
    ...props.enginePopoverContext,
    selectedRangeId: current?.id ?? null,
    ranges,
    onUpdateRange: (range) => {
      const target = values.current.ranges.find((item) => item.id === range.id)
      if (
        !target ||
        rangeActionToken !== rangeActionGeneration.current ||
        activeText.current?.range !== nativeRange ||
        activeText.current?.rangeId !== range.id
      )
        return
      emitRange(
        {
          ...target,
          markerStyle: {
            ...target.markerStyle,
            backgroundColor: range.markerStyle?.backgroundColor
          }
        },
        true
      )
    },
    onRemoveRange: (id) => {
      if (
        rangeActionToken === rangeActionGeneration.current &&
        activeText.current?.range === nativeRange &&
        activeText.current?.rangeId === id
      )
        removeRange(id)
    }
  }
  const popup = annotationPopup(
    current,
    props.highlightPopover ??
      (() => <DefaultHighlightPopover {...menuContext} />),
    props.selectionPopover ?? <DefaultSelectionPopover {...menuContext} />
  )
  const resolveHighlight = useCallback(
    (x: number, y: number) => {
      if (epubDocument && epub.current) {
        const id = epub.current.rangeIdAtPoint(epubDocument, x, y)
        return values.current.ranges.find((item) => item.id === id) ?? null
      }
      const overlays =
        root.current?.querySelectorAll<HTMLElement>('[data-range-id]') ?? []
      for (const overlay of overlays) {
        const rect = overlay.getBoundingClientRect()
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        )
          return (
            values.current.ranges.find(
              (item) => item.id === overlay.dataset.rangeId
            ) ?? null
          )
      }
      return null
    },
    [epubDocument]
  )
  const draftRect = (rectangle: ReaderSelectionRectangle) => {
    activate(null)
    setInternalRectId(null)
    props.onSelectRect?.(null)
    setDraftRectangle(rectangle)
    setActiveSelection({ kind: 'rectangle', id: rectangle.id })
  }
  const updateRect = (rectangle: ReaderSelectionRectangle) => {
    if (draftRectangle?.id === rectangle.id) return setDraftRectangle(rectangle)
    apply(
      {
        ...snapshot(),
        rects: rects.map((item) =>
          item.id === rectangle.id ? rectangle : item
        )
      },
      'update-rect'
    )
    props.onUpdateRect?.(rectangle)
  }
  const selectRect = (id: string | null) => {
    activate(null)
    setInternalRectId(id)
    props.onSelectRect?.(id)
    setDraftRectangle(null)
    setActiveSelection(id ? { kind: 'rectangle', id } : null)
  }
  const dismissPdfSelectionOutside = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    const target = event.target as Element
    // Popovers are portals whose React events still bubble through this root.
    // Handles and annotation hits must retain/transfer selection normally.
    if (
      target.closest('.hsn-selection-popover, .hamster-reader__engine-handle')
    )
      return
    const annotations = root.current?.querySelectorAll<HTMLElement>(
      '[data-range-id], [data-rect-id]'
    )
    const hit = Array.from(annotations ?? []).some((element) => {
      const box = element.getBoundingClientRect()
      return (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      )
    })
    if (!hit) selectRect(null)
  }
  const pdfNavigationTouch = useRef<{
    pointer: number
    x: number
    y: number
    range: Range | null
    moved: boolean
  } | null>(null)
  const bookmarkToggleHandler = () => {
    if (!props.onToggleBookmark) return undefined
    return (bookmark: ReaderBookmark) => {
      const position = capturePdfPosition()
      if (props.bookmarks?.includes(bookmark) || !pdf.current)
        props.onToggleBookmark?.(bookmark)
      else if (position) props.onToggleBookmark?.(position)
    }
  }
  return (
    <RangeMagnifierProvider
      rootElement={rootElement}
      source={source}
      enabled={props.showSelectionMagnifier ?? true}
    >
      <div
        ref={bindRoot}
        className='hamster-reader__engine-viewer'
        data-engine={source?.format}
        style={epubViewportStyle(source, paginationInset, props)}
        onPointerDown={(event) => {
          if (source?.format === 'pdf') {
            // Clear before the browser starts its next native text gesture;
            // never preventDefault, so a fresh drag selection remains intact.
            if (event.pointerType === 'touch') {
              pdfNavigationTouch.current = {
                pointer: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                range: activeText.current?.range ?? null,
                moved: false
              }
            } else dismissPdfSelectionOutside(event)
            const selection = root.current?.ownerDocument.getSelection()
            if (selection)
              props.onSelectionStart?.(
                { x: event.clientX, y: event.clientY },
                selection
              )
          }
        }}
        onWheel={() => {
          progressEnabled.current = true
        }}
        onPointerMove={(event) => {
          const gesture = pdfNavigationTouch.current
          if (
            gesture?.pointer === event.pointerId &&
            Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8
          )
            gesture.moved = true
        }}
        onPointerCancel={() => {
          pdfNavigationTouch.current = null
        }}
        onPointerUp={(event) => {
          if (source?.format === 'pdf') {
            const gesture = pdfNavigationTouch.current
            pdfNavigationTouch.current = null
            if (
              gesture?.pointer === event.pointerId &&
              !gesture.moved &&
              gesture.range === (activeText.current?.range ?? null)
            )
              dismissPdfSelectionOutside(event)
            const selection = root.current?.ownerDocument.getSelection()
            if (
              selection &&
              (!selection.isCollapsed || pdf.current?.getSelectionRange())
            ) {
              props.onSelectionEnd?.(
                { x: event.clientX, y: event.clientY },
                selection
              )
              void emitSelectionCallbacks(true)
            }
          }
          if (
            source?.format === 'pdf' &&
            props.autoHighlight &&
            !selected &&
            props.selectedTool === 'text-selection'
          )
            confirm()
        }}
      >
        <EngineHighlightInteractions
          element={
            source?.format === 'epub'
              ? (epubDocument?.body ?? null)
              : rootElement
          }
          resolveHighlight={resolveHighlight}
          onDragHighlight={
            props.onDragHighlight
              ? (range) => {
                  setNativeRange(null)
                  epub.current?.setActiveRange(null)
                  props.onDragHighlight?.(range)
                }
              : undefined
          }
        />
        {source?.format === 'epub' ? (
          <div
            ref={epubContainer}
            className='hamster-reader__epub-container'
            style={{
              display: emptyPageDisplay(pageCount, pageNumbers)
            }}
          />
        ) : (
          <PdfDocumentViewer
            key={retry}
            ref={pdf}
            onDocumentReady={setPdfDocument}
            readingInsets={{
              top: props.containMarginTop ?? props.containMarginY ?? 0,
              bottom: props.containMarginBottom ?? props.containMarginY ?? 0,
              horizontal: props.containMarginX ?? 0
            }}
            source={pdfSource}
            workerSrc={source?.workerSrc}
            documentOptions={source?.documentOptions}
            scale={
              typeof props.nativeLayoutZoom === 'number'
                ? props.nativeLayoutZoom
                : props.scale
            }
            defaultScale={props.defaultScale}
            fitWidth={props.nativeLayoutZoom === 'fit-width'}
            ranges={ranges}
            rects={rects}
            selectedRangeId={nativeRange ? selected : null}
            selectedRectId={selectedRect}
            onSelectRange={activate}
            onSelectRect={selectRect}
            onTextSelectionChange={selectionChanged}
            onPagesLoaded={onPdfReady}
            onTextLayerReady={onPdfTextReady}
            onPageChange={publishPosition}
            onTextAnchorChange={(anchor) =>
              publishPosition(anchor?.pageNumber ?? page)
            }
            onReadingPositionChange={(position) => {
              if (position.status === 'ready')
                publishPosition(position.position.pageNumber, position)
            }}
            onRestoreError={setRestoreNotice}
            viewportTopInset={props.containMarginTop ?? props.containMarginY}
            viewportBottomInset={
              props.containMarginBottom ?? props.containMarginY
            }
            onScaleChange={props.onNativeLayoutScaleChange}
            onError={(failure) => setError(failure.message)}
            tool={props.selectedTool}
            overlayRectType={props.overlayRectType}
            highlightColor={props.highlightColor}
            hiddenPages={props.hiddenPages}
            pageRange={props.pageRange}
            ocr={props.ocr}
            extraOCR={props.extraOCR}
            ocrTexts={props.ocrTexts}
            onOcrTextsChange={publishOcr}
            onOcrError={props.onOcrError}
            ocrDebug={props.ocrDebug}
            edgeCrop={props.edgeCrop}
            edgeCropEditing={props.edgeCropEditing}
            onEdgeCropApply={props.onEdgeCropApply}
            onEdgeCropHidePage={props.onEdgeCropHidePage}
            onHiddenPagesRestore={props.onHiddenPagesRestore}
            canUndoHiddenPagesRestore={props.canUndoHiddenPagesRestore}
            onHiddenPagesRestoreUndo={props.onHiddenPagesRestoreUndo}
            pagePaintings={props.pagePaintings}
            paintingSettings={props.paintingSettings}
            onPaintingSettingsChange={props.onPaintingSettingsChange}
            paintingTool={props.paintingTool}
            drawingStrokeColor={props.drawingStrokeColor}
            onPagePaintingChange={props.onPagePaintingChange}
            onCreateRect={(rectangle) => {
              apply(
                {
                  ...snapshot(),
                  rects: [...rects, rectangle],
                  selectedRangeId: null,
                  selectedRectId: rectangle.id
                },
                'create-rect'
              )
              props.onCreateRect?.(rectangle)
              setActiveSelection({ kind: 'rectangle', id: rectangle.id })
            }}
            draftRectangle={draftRectangle}
            onDraftRect={draftRect}
            onUpdateRect={updateRect}
          />
        )}
        {source?.format === 'epub' && (
          <EpubSurface
            allowedPages={pageNumbers}
            book={book}
            page={page}
            mode={mode}
            bindCover={setCoverElement}
            doc={epubDocument}
            pageElement={coverElement}
            pageNumber={epubPage}
            viewer={{ ...props, rects, selectedRectId: selectedRect }}
            draftRectangle={draftRectangle}
            onDraftRect={draftRect}
            onUpdateRect={updateRect}
            onSelectRect={selectRect}
          />
        )}
        {source?.format === 'epub' && (
          <ViewportPaginationControls
            controlsRef={pagination}
            className='hamster-reader__epub-pagination'
            theme={theme}
            ready={epubReady}
            navigation={navigation}
            onPrevious={() => turnEpub(false)}
            onNext={() => turnEpub(true)}
          />
        )}
        {unlocatable.length > 0 && (
          <div role='status' className='hamster-reader__engine-notice'>
            {unlocatable.length} 条高亮无法定位，原数据已保留
          </div>
        )}
        {restoreNotice && <div role='status'>{restoreNotice}</div>}
        {error && (
          <div role='alert' className='hamster-reader__engine-error'>
            <p>{error}</p>
            <button
              type='button'
              onClick={() => {
                setError(null)
                setRetry((value) => value + 1)
              }}
            >
              重试
            </button>
          </div>
        )}
        <PageBrowser
          outline={
            book && (
              <EpubOutline
                items={book.toc}
                pageNumbers={pageNumbers}
                onNavigate={(href) => {
                  progressEnabled.current = true
                  cancelSelection()
                  epub.current?.goToTocHref(href).catch(() => undefined)
                }}
              />
            )
          }
          isOpen={props.showPageBrowser ?? false}
          pageNumbers={pageNumbers}
          pageSizesByPageNumber={previews.sizes}
          baseImagesByPageNumber={previews.images}
          previewErrors={previews.errors}
          onRetryPreview={previews.retryPreview}
          onPageVisibilityChange={previews.onVisibility}
          onNavigateToPage={navigate}
          onClose={props.onPageBrowserClose}
          showPagesTab={mode === 'layout'}
          ranges={ranges}
          rects={rects}
          selectedRangeId={selected}
          selectedRectId={selectedRect}
          onSelectRange={activate}
          onNavigateToRange={(id) => {
            ++pdfNavigationGeneration.current
            progressEnabled.current = true
            if (epub.current) epub.current.goToRange(id)
            else pdf.current?.scrollToRange(id)
          }}
          onDeleteRange={removeRange}
          onDeleteRect={props.onRemoveRect}
          onSelectRect={props.onSelectRect}
          onNavigateToRect={(id) => {
            const rectangle = rects.find((item) => item.id === id)
            if (rectangle?.selectionId)
              navigate(pageNumberOf(rectangle.selectionId))
          }}
          commentCountByRangeId={
            props.commentCountByRangeId ??
            (props.comments
              ? getCommentCountByHighlightId(props.comments)
              : undefined)
          }
          commentCountByRectId={props.commentCountByRectId}
          bookmarks={props.bookmarks}
          onToggleBookmark={bookmarkToggleHandler()}
          onNavigateToBookmark={(bookmark) => {
            navigateBookmark(bookmark)?.catch(() => undefined)
          }}
          currentPageNumber={page}
          currentBookmark={
            epub.current?.captureTextAnchor() ?? capturePdfPosition()
          }
          visiblePageNumbers={visiblePageNumbers}
          pagePaintings={props.pagePaintings}
          themeColor={props.themeColor}
        />
        <ReadingProgress
          mode='text'
          pageNumbers={pageNumbers}
          currentPageNumber={page}
          ranges={ranges}
          isMoving={false}
          onSeekPage={navigate}
          insetBottom={props.containMarginBottom}
          insetTop={props.containMarginTop}
        />
        <EngineSelectionControls
          range={props.showPageBrowser ? null : nativeRange}
          containerRef={root}
          showHandles={
            source?.format !== 'epub' || epubInteractiveRange === nativeRange
          }
          managedText={!pdfTouch}
          pdfTouch={pdfTouch}
          pdfCustomHandles={source?.format === 'pdf'}
          color={current?.markerStyle?.backgroundColor ?? props.highlightColor}
          paintPreview={getSelectionGroup(ranges, selected).length <= 1}
          onPreview={(range) => {
            if (epub.current) epub.current.setSelectionRange(range)
            else pdf.current?.setSelectionRange(range, pdfTouch)
          }}
          hitTest={
            source?.format === 'pdf'
              ? (x, y) => pdf.current?.hitTestSelection(x, y) ?? null
              : undefined
          }
          showStart={endpointVisible(current, source?.format, epubPage, false)}
          showEnd={endpointVisible(current, source?.format, epubPage, true)}
          onEditingChange={(value) => {
            if (rangeActionToken !== rangeActionGeneration.current) return
            editing.current = value
            if (value && epub.current && nativeRange)
              epub.current.setSelectionRange(nativeRange)
          }}
          onUpdate={(range, end) => {
            const active = activeText.current
            if (
              !active ||
              rangeActionToken !== rangeActionGeneration.current ||
              active.range !== nativeRange ||
              active.range.startContainer.ownerDocument !==
                range.startContainer.ownerDocument
            )
              return
            const group = getSelectionGroup(
              values.current.ranges,
              active.rangeId
            )
            const pdfTarget = end ? group.at(-1) : group[0]
            const target = pdf.current
              ? pdfTarget
              : values.current.ranges.find((item) => item.id === active.rangeId)
            if (pdf.current) pdf.current.setSelectionRange(range, pdfTouch)
            else epub.current?.setSelectionRange(range)
            let detail: ReturnType<typeof serialize>
            if (epub.current && target)
              detail = epub.current.updateRangeEndpoint(target.id, range, end)
            else if (pdf.current && target)
              detail = pdf.current.serializeRangeEndpoint(target.id, range, end)
            else detail = epub.current?.serializeRange(range) ?? serialize()
            if (!detail) {
              if (pdf.current) {
                pdf.current.setSelectionRange(active.range, pdfTouch)
                return
              }
              epub.current?.setSelectionRange(active.range)
              return
            }
            setNativeRange(range.cloneRange(), target?.id ?? null)
            if (target)
              emitRange(
                {
                  ...target,
                  ...detail,
                  rectsBySelectionId:
                    (detail as SerializedPdfSelection).rectsBySelectionId ??
                    target.rectsBySelectionId
                },
                true
              )
          }}
        >
          {popup}
        </EngineSelectionControls>
        <PopoverPortal
          containerRef={root}
          selectionKind='selected'
          visible={
            !props.showPageBrowser &&
            activeSelection?.kind === 'rectangle' &&
            Boolean(currentRectangle ?? draftRectangle)
          }
        >
          {rectanglePopup}
        </PopoverPortal>
      </div>
    </RangeMagnifierProvider>
  )
}
