import {
  type ReactNode,
  type ComponentProps,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
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
  ReaderSelectionRectangle
} from '../types/selection'
import {
  createEpubEngine,
  type EpubEngine,
  type EpubEngineBookInfo
} from '../epub/foliateEpubEngine'
import {
  PdfDocumentViewer,
  type PdfDocumentViewerRef
} from '../pdf/PdfDocumentViewer'
import type { IntermediateDocumentViewerProps } from './IntermediateDocumentViewer'
import { engineSelectionSegments } from './selection/engineSelectionSegments'
import { useAnnotationHistory } from './Reader/useAnnotationHistory'
import { PageBrowser } from './IntermediateDocumentViewer/PageBrowser'
import { ReadingProgress } from './IntermediateDocumentViewer/ReadingProgress'
import { isTextBookmark } from './IntermediateDocumentViewer/textAnchor'
import { getCommentCountByHighlightId } from '../comments'
import { EngineSelectionControls } from './EngineSelectionControls'
import { EngineHighlightInteractions } from './EngineHighlightInteractions'
import { PopoverPortal } from './PopoverPortal'
import { EpubOutline } from './EpubOutline'
import { EngineEpubLayoutLayer } from './EngineEpubLayoutLayer'
import { RangeMagnifierProvider } from './IntermediateDocumentViewer/RangeMagnifier'

type Props = IntermediateDocumentViewerProps & {
  readonly engineSource?: ReaderEngineSource
  readonly engineRenderMode?: ReaderRenderMode
  readonly textReadingProgress?: ReaderTextReadingProgress
  readonly onTextReadingProgressChange?: (
    progress: ReaderTextReadingProgress
  ) => void
}

const pageNumberOf = (id: string) => Number(id.slice(5))

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
  onNavigate,
  ...layout
}: Omit<ComponentProps<typeof EngineEpubLayoutLayer>, 'doc'> & {
  book: EpubEngineBookInfo | null
  page: number
  mode: ReaderRenderMode
  doc: Document | null
  bindCover: (element: HTMLButtonElement | null) => void
  onNavigate: (page: number) => void
}) {
  const cover = prependedCoverVisible(book, page)
  return (
    <>
      {book?.cover && cover && (
        <button
          ref={bindCover}
          type='button'
          className='hamster-reader__epub-cover'
          aria-label='进入正文'
          onClick={() => {
            if (
              !layout.viewer.selectedRectId &&
              !layout.viewer.edgeCropEditing &&
              (layout.viewer.selectedTool ?? 'text-selection') ===
                'text-selection'
            )
              onNavigate(2)
          }}
        >
          <img
            className='hamster-reader__epub-cover'
            src={book.cover.url}
            alt={book.cover.alt ?? '封面'}
          />
        </button>
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

function controlledSelection(
  value: string | null | undefined,
  fallback: string | null
) {
  return value === undefined ? fallback : value
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

/** Shared reader UI over Foliate and the official PDFViewer. No storage owner here. */
export function EngineDocumentViewer(props: Props) {
  const { engineSource: source, engineRenderMode: mode = 'layout' } = props
  const root = useRef<HTMLDivElement>(null)
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const [epubDocument, setEpubDocument] = useState<Document | null>(null)
  const [epubPage, setEpubPage] = useState(1)
  const [coverElement, setCoverElement] = useState<HTMLButtonElement | null>(
    null
  )
  const bindRoot = useCallback((element: HTMLDivElement | null) => {
    root.current = element
    setRootElement(element)
  }, [])
  const epubContainer = useRef<HTMLDivElement>(null)
  const epub = useRef<EpubEngine | null>(null)
  const pdf = useRef<PdfDocumentViewerRef>(null)
  const latest = useRef(props)
  latest.current = props
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [book, setBook] = useState<EpubEngineBookInfo | null>(null)
  const [unlocatable, setUnlocatable] = useState<readonly string[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [nativeRange, setNativeRange] = useState<Range | null>(null)
  const [internalRanges, setInternalRanges] = useState(
    props.defaultRanges ?? []
  )
  const [internalRects, setInternalRects] = useState<
    ReaderSelectionRectangle[]
  >([])
  const [internalSelected, setInternalSelected] = useState<string | null>(
    props.defaultSelectedRangeId ?? null
  )
  const [internalRectId, setInternalRectId] = useState<string | null>(null)
  const [draftRectangle, setDraftRectangle] =
    useState<ReaderSelectionRectangle | null>(null)
  const [mouse, setMouse] = useState(false)
  const editing = useRef(false)
  const activating = useRef(false)
  const restored = useRef(false)
  const progressEnabled = useRef(false)
  const ranges = props.ranges ?? internalRanges
  const rects = props.rects ?? internalRects
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
  useEffect(() => {
    latest.current.onAnnotationHistoryStatusChange?.(JSON.parse(statusKey))
  }, [statusKey])
  const resetKey = props.annotationHistory?.resetKey
  useEffect(() => {
    historyRef.current.reset(snapshot(), 'reset')
  }, [source, resetKey])
  const annotationsKey = JSON.stringify(snapshot())
  useEffect(() => {
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
    const token = ++activationGeneration.current
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
    activating.current = true
    if (epub.current) {
      const engine = epub.current
      engine
        .selectRange(id)
        .then((range) => {
          if (token !== activationGeneration.current || epub.current !== engine)
            return
          setNativeRange(range)
          epub.current?.setActiveRange(range ? id : null)
          activating.current = false
        })
        .catch(() => {
          if (token === activationGeneration.current) activating.current = false
        })
    } else {
      setNativeRange(pdf.current?.selectRange(id) ?? null)
      activating.current = false
    }
  }, [])
  const emitRange = (range: ReaderSelectionRange, update: boolean) => {
    const next = update
      ? values.current.ranges.map((item) =>
          item.id === range.id ? range : item
        )
      : [...values.current.ranges, range]
    apply(
      { ...snapshot(), ranges: next, selectedRangeId: range.id },
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
    apply(
      {
        ...snapshot(),
        rects: [...values.current.rects, draftRectangle],
        selectedRangeId: null,
        selectedRectId: draftRectangle.id
      },
      'create-rect'
    )
    latest.current.onCreateRect?.(draftRectangle)
    latest.current.onSelectRect?.(draftRectangle.id)
    setDraftRectangle(null)
  }
  const confirm = () => {
    if (latest.current.selectedTool === 'rect-selection') {
      confirmRectangle()
      return
    }
    if (editing.current || activating.current || !restored.current) return
    const detail = serialize()
    if (!detail || !detail.text) return
    const range: ReaderSelectionRange = {
      ...detail,
      id: `range-${globalThis.crypto.randomUUID()}`,
      createdAt: Date.now(),
      rectsBySelectionId:
        (detail as SerializedPdfSelection).rectsBySelectionId ?? {},
      overlayRectType: latest.current.overlayRectType ?? 'percent',
      markerStyle: {
        backgroundColor: latest.current.highlightColor ?? '#ffc107'
      }
    }
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
      epub.current?.getSelectionRange() ??
      (native?.rangeCount ? native.getRangeAt(0) : null)
    const selection = range?.startContainer.ownerDocument?.getSelection()
    if (!detail || !selection || !latest.current.document) return
    const startPage = pageNumberOf(detail.start.selectionId)
    const { texts, segments } = await engineSelectionSegments(
      latest.current.document,
      detail
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
      epub.current?.getSelectionRange() ??
      (selection?.rangeCount ? selection.getRangeAt(0) : null)
    const detail = serialize()
    if (detail && range) {
      setNativeRange(range.cloneRange())
      void emitSelectionCallbacks()
    } else if (!values.current.selected) setNativeRange(null)
  }, [emitSelectionCallbacks])
  const publishPosition = useCallback((pageNumber: number) => {
    setPage(pageNumber)
    if (!restored.current || !progressEnabled.current) return
    const anchor =
      epub.current?.captureTextAnchor() ??
      pdf.current?.captureTextAnchor() ??
      undefined
    latest.current.onTextAnchorChange?.(anchor)
    if (latest.current.engineRenderMode === 'text')
      latest.current.onTextReadingProgressChange?.({
        currentPageNumber: pageNumber,
        ...(anchor ? { anchor } : {})
      })
    else
      latest.current.onLayoutReadingProgressChange?.(
        anchor ?? { pageNumber, verticalPercentage: 0 }
      )
  }, [])
  const navigate = useCallback(
    (pageNumber: number) => {
      progressEnabled.current = true
      if (epub.current) epub.current.goToPage(pageNumber).catch(() => undefined)
      else pdf.current?.scrollToPage(pageNumber)
    },
    [publishPosition]
  )
  const navigateBookmark = (bookmark: ReaderBookmark) => {
    if (epub.current) {
      if (isTextBookmark(bookmark)) return epub.current.goToAnchor(bookmark)
      return epub.current.goToPage(bookmark.pageNumber)
    }
    return pdf.current?.scrollToAnchor(bookmark)
  }
  const restorePosition = () => {
    const current = latest.current
    let progress =
      current.layoutReadingProgress ??
      current.defaultVirtualPaperTransform?.anchor
    if (current.engineRenderMode === 'text') {
      progress = current.textReadingProgress?.anchor
      if (!progress && current.textReadingProgress)
        progress = {
          pageNumber: current.textReadingProgress.currentPageNumber,
          verticalPercentage: 0
        }
    }
    if (progress) {
      if (epub.current) {
        if (isTextBookmark(progress)) return epub.current.goToAnchor(progress)
        return epub.current.goToPage(progress.pageNumber)
      }
      return navigateBookmark(progress)
    }
    return Promise.resolve()
  }
  const restorePositionRef = useRef(restorePosition)
  restorePositionRef.current = restorePosition
  const onPdfReady = useCallback(async (count: number) => {
    setPageCount(count)
    await restorePositionRef.current()
    restored.current = true
  }, [])
  const onPdfTextReady = useCallback((loadedPages: readonly number[]) => {
    latest.current.onPageLoadStatusChange?.([...loadedPages])
    const id = values.current.selected
    if (id && !editing.current) {
      activating.current = true
      setNativeRange(pdf.current?.selectRange(id) ?? null)
      activating.current = false
    }
  }, [])

  useEffect(() => {
    if (source?.format !== 'epub' || !epubContainer.current) return
    let cancelled = false
    const listeners = new Map<Document, () => void>()
    restored.current = false
    progressEnabled.current = false
    setError(null)
    const engine = createEpubEngine({
      container: epubContainer.current,
      source: source.data,
      fontScale: latest.current.fontScale,
      flow: 'scrolled',
      selectionColor: latest.current.selectionColor,
      onSelection: selectionChanged,
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
          progressEnabled.current = true
          setMouse(event.pointerType === 'mouse')
          const selection = doc.getSelection()
          if (selection)
            latest.current.onSelectionStart?.(
              { x: event.clientX, y: event.clientY },
              selection
            )
        }
        const up = (event: PointerEvent) => {
          const selection = doc.getSelection()
          if (selection && !selection.isCollapsed)
            latest.current.onSelectionEnd?.(
              { x: event.clientX, y: event.clientY },
              selection
            )
          void emitSelectionCallbacks(true)
          if (latest.current.autoHighlight && !values.current.selected)
            confirmRef.current()
        }
        doc.addEventListener('pointerdown', down, true)
        doc.addEventListener('pointerup', up)
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
          doc.removeEventListener('wheel', interacted)
          doc.removeEventListener('keydown', interacted)
        })
      },
      onDocumentUnload: (doc) => {
        listeners.get(doc)?.()
        listeners.delete(doc)
      },
      onError: (failure) => setError(failure.message),
      onRelocate: (location) => {
        if (location.pageNumber) publishPosition(location.pageNumber)
        const id = values.current.selected
        if (id && !editing.current) {
          const part = engine.getRangePart(id)
          setNativeRange(part?.cloneRange() ?? null)
          if (part) {
            const selection = part.startContainer.ownerDocument?.getSelection()
            activating.current = true
            selection?.removeAllRanges()
            selection?.addRange(part)
            engine.setActiveRange(id)
            activating.current = false
          }
        }
      }
    })
    epub.current = engine
    engine.ready
      .then(async (info) => {
        if (cancelled) return
        setPageCount(info.pageCount)
        await engine.setHiddenPages(
          latest.current.hiddenPages ?? [],
          latest.current.edgeCropEditing
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
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      restored.current = false
      listeners.forEach((remove) => remove())
      listeners.clear()
      epub.current = null
      engine.destroy().catch(() => undefined)
    }
  }, [
    source,
    retry,
    activate,
    publishPosition,
    selectionChanged,
    emitSelectionCallbacks
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
      ?.setHiddenPages(props.hiddenPages ?? [], props.edgeCropEditing)
      .catch(() => undefined)
  }, [props.hiddenPages, props.edgeCropEditing, book])
  useEffect(() => {
    epub.current?.setFontScale(props.fontScale ?? 1)
  }, [props.fontScale])
  useEffect(() => {
    const report = epub.current?.showRanges(ranges)
    if (report) setUnlocatable(report.unlocatable.map((item) => item.id))
  }, [ranges, book])
  useEffect(() => {
    if (!selected) {
      setNativeRange(null)
      epub.current?.setActiveRange(null)
      return
    }
    activate(selected)
  }, [selected, activate])

  useImperativeHandle(
    props.readingPositionRef,
    () => ({
      captureTextAnchor: () =>
        epub.current?.captureTextAnchor() ??
        pdf.current?.captureTextAnchor() ??
        undefined
    }),
    []
  )
  useImperativeHandle(props.selectionRef, () => ({
    highlight: confirm,
    confirm,
    confirmRect: confirmRectangle,
    clear: () => {
      apply(
        { ranges: [], rects: [], selectedRangeId: null, selectedRectId: null },
        'clear'
      )
      setNativeRange(null)
      setDraftRectangle(null)
      epub.current?.clearSelection()
      epub.current?.setActiveRange(null)
      pdf.current?.clearSelection()
    },
    scrollToRange: (id) => {
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
  }))
  const pdfSource = useMemo(
    () => (source ? { data: source.data.slice() } : null),
    [source, retry]
  )
  const pageNumbers = Array.from(
    { length: pageCount },
    (_, index) => index + 1
  ).filter(
    (number) =>
      !(props.hiddenPages ?? []).some(
        (hidden) => hidden === number || hidden === `page-${number}`
      )
  )
  const current = ranges.find((range) => range.id === selected)
  const currentRectangle = rects.find((item) => item.id === selectedRect)
  const rectanglePopup = annotationPopup(
    currentRectangle,
    props.rectPopover,
    props.selectionPopover
  )
  const popup = annotationPopup(
    current,
    props.highlightPopover,
    props.selectionPopover
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
  }
  return (
    <RangeMagnifierProvider
      rootElement={rootElement}
      enabled={props.showSelectionMagnifier ?? true}
    >
      <div
        ref={bindRoot}
        className='hamster-reader__engine-viewer'
        data-engine={source?.format}
        onPointerDown={(event) => {
          progressEnabled.current = true
          setMouse(event.pointerType === 'mouse')
          if (source?.format === 'pdf') {
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
        onPointerUp={(event) => {
          if (source?.format === 'pdf') {
            const selection = root.current?.ownerDocument.getSelection()
            if (selection && !selection.isCollapsed) {
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
          <div ref={epubContainer} className='hamster-reader__epub-container' />
        ) : (
          <PdfDocumentViewer
            key={retry}
            ref={pdf}
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
            onTextAnchorChange={(anchor) => {
              if (anchor) publishPosition(anchor.pageNumber)
            }}
            onScaleChange={props.onNativeLayoutScaleChange}
            onError={(failure) => setError(failure.message)}
            tool={props.selectedTool}
            overlayRectType={props.overlayRectType}
            highlightColor={props.highlightColor}
            hiddenPages={props.hiddenPages}
            edgeCrop={props.edgeCrop}
            edgeCropEditing={props.edgeCropEditing}
            onEdgeCropApply={props.onEdgeCropApply}
            onEdgeCropHidePage={props.onEdgeCropHidePage}
            pagePaintings={props.pagePaintings}
            paintingControllerData={props.paintingControllerData}
            onPaintingControllerDataChange={
              props.onPaintingControllerDataChange
            }
            paintingTool={props.paintingTool}
            drawingStrokeColor={props.drawingStrokeColor}
            onPagePaintingChange={props.onPagePaintingChange}
            onCreateRect={(rectangle) => {
              apply(
                {
                  ...snapshot(),
                  rects: [...rects, rectangle],
                  selectedRectId: rectangle.id
                },
                'create-rect'
              )
              props.onCreateRect?.(rectangle)
            }}
            draftRectangle={draftRectangle}
            onDraftRect={draftRect}
            onUpdateRect={updateRect}
          />
        )}
        {source?.format === 'epub' && (
          <EpubSurface
            book={book}
            page={page}
            mode={mode}
            bindCover={setCoverElement}
            onNavigate={navigate}
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
        {unlocatable.length > 0 && (
          <div role='status' className='hamster-reader__engine-notice'>
            {unlocatable.length} 条高亮无法定位，原数据已保留
          </div>
        )}
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
                onNavigate={(href) => {
                  progressEnabled.current = true
                  epub.current?.goToTocHref(href).catch(() => undefined)
                }}
              />
            )
          }
          isOpen={props.showPageBrowser ?? false}
          pageNumbers={pageNumbers}
          pageSizesByPageNumber={new Map()}
          baseImagesByPageNumber={new Map()}
          onPageVisibilityChange={() => undefined}
          onNavigateToPage={navigate}
          onClose={props.onPageBrowserClose}
          showPagesTab={mode === 'layout'}
          ranges={ranges}
          rects={rects}
          selectedRangeId={selected}
          selectedRectId={selectedRect}
          onSelectRange={activate}
          onNavigateToRange={(id) => {
            if (epub.current) epub.current.goToRange(id)
            else pdf.current?.scrollToRange(id)
          }}
          onDeleteRange={props.onRemoveRange}
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
          onToggleBookmark={props.onToggleBookmark}
          onNavigateToBookmark={navigateBookmark}
          currentPageNumber={page}
          currentBookmark={
            epub.current?.captureTextAnchor() ??
            pdf.current?.captureTextAnchor() ?? {
              pageNumber: page,
              verticalPercentage: 0
            }
          }
          visiblePageNumbers={new Set([page])}
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
          showHandles={mouse}
          showStart={endpointVisible(current, source?.format, epubPage, false)}
          showEnd={endpointVisible(current, source?.format, epubPage, true)}
          onEditingChange={(value) => {
            editing.current = value
          }}
          onUpdate={(range, end) => {
            setNativeRange(range.cloneRange())
            const detail =
              epub.current && current
                ? epub.current.updateRangeEndpoint(current.id, range, end)
                : (epub.current?.serializeRange(range) ?? serialize())
            if (current && detail)
              emitRange(
                {
                  ...current,
                  ...detail,
                  rectsBySelectionId:
                    (detail as SerializedPdfSelection).rectsBySelectionId ??
                    current.rectsBySelectionId
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
            Boolean(currentRectangle ?? draftRectangle)
          }
        >
          {rectanglePopup}
        </PopoverPortal>
      </div>
    </RangeMagnifierProvider>
  )
}
