import {
  type ReactNode,
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
import { useAnnotationHistory } from './Reader/useAnnotationHistory'
import { PageBrowser } from './IntermediateDocumentViewer/PageBrowser'
import { ReadingProgress } from './IntermediateDocumentViewer/ReadingProgress'
import { isTextBookmark } from './IntermediateDocumentViewer/textAnchor'
import { getCommentCountByHighlightId } from '../comments'
import { EngineSelectionControls } from './EngineSelectionControls'
import { EngineHighlightInteractions } from './EngineHighlightInteractions'
import { PopoverPortal } from './PopoverPortal'
import { EpubOutline } from './EpubOutline'

type Props = IntermediateDocumentViewerProps & {
  readonly engineSource?: ReaderEngineSource
  readonly engineRenderMode?: ReaderRenderMode
  readonly textReadingProgress?: ReaderTextReadingProgress
  readonly onTextReadingProgressChange?: (
    progress: ReaderTextReadingProgress
  ) => void
}

const pageNumberOf = (id: string) => Number(id.slice(5))

function controlledSelection(
  value: string | null | undefined,
  fallback: string | null
) {
  return value === undefined ? fallback : value
}

function canEditEndpoints(
  mouse: boolean,
  format: ReaderEngineSource['format'] | undefined,
  range: ReaderSelectionRange | undefined
) {
  // A Range in one iframe cannot represent both ends of a cross-chapter highlight.
  return (
    mouse &&
    !(
      format === 'epub' &&
      range &&
      range.start.selectionId !== range.end.selectionId
    )
  )
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
  const activate = useCallback((id: string | null) => {
    setInternalSelected(id)
    latest.current.onSelectRange?.(id)
    latest.current.onLinkedSelectRange?.(id)
    if (!id) {
      setNativeRange(null)
      epub.current?.setActiveRange(null)
      epub.current?.clearSelection()
      pdf.current?.clearSelection()
      return
    }
    activating.current = true
    if (epub.current) {
      epub.current.selectRange(id).then((range) => {
        setNativeRange(range)
        epub.current?.setActiveRange(range ? id : null)
        activating.current = false
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
  const selectionChanged = useCallback(() => {
    if (editing.current || activating.current) return
    const selection = root.current?.ownerDocument.getSelection()
    const range =
      epub.current?.getSelectionRange() ??
      (selection?.rangeCount ? selection.getRangeAt(0) : null)
    const detail = serialize()
    if (detail && range) {
      setNativeRange(range.cloneRange())
    } else if (!values.current.selected) setNativeRange(null)
  }, [])
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
      if (epub.current)
        epub.current
          .goToPage(pageNumber)
          .then(() => publishPosition(pageNumber))
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
    const listeners: Array<() => void> = []
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
        listeners.push(() => {
          for (const type of pointerEvents)
            doc.removeEventListener(type, forward, true)
          doc.removeEventListener('pointerdown', down, true)
          doc.removeEventListener('pointerup', up)
          doc.removeEventListener('wheel', interacted)
          doc.removeEventListener('keydown', interacted)
        })
      },
      onError: (failure) => setError(failure.message),
      onRelocate: (location) => {
        if (location.pageNumber) publishPosition(location.pageNumber)
      }
    })
    epub.current = engine
    engine.ready
      .then(async (info) => {
        if (cancelled) return
        setBook(info)
        setPageCount(info.pageCount)
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
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      restored.current = false
      listeners.forEach((remove) => remove())
      epub.current = null
      engine.destroy().catch(() => undefined)
    }
  }, [source, retry, activate, publishPosition, selectionChanged])
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
  return (
    <div
      ref={bindRoot}
      className='hamster-reader__engine-viewer'
      data-engine={source?.format}
      onPointerDown={(event) => {
        progressEnabled.current = true
        setMouse(event.pointerType === 'mouse')
      }}
      onWheel={() => {
        progressEnabled.current = true
      }}
      onPointerUp={() => {
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
          source?.format === 'epub' ? (epubDocument?.body ?? null) : rootElement
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
          onSelectRect={(id) => {
            activate(null)
            setInternalRectId(id)
            latest.current.onSelectRect?.(id)
          }}
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
          onPaintingControllerDataChange={props.onPaintingControllerDataChange}
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
          onDraftRect={(rectangle) => {
            activate(null)
            setInternalRectId(null)
            props.onSelectRect?.(null)
            setDraftRectangle(rectangle)
          }}
          onUpdateRect={(rectangle) => {
            if (draftRectangle?.id === rectangle.id) {
              setDraftRectangle(rectangle)
              return
            }
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
          }}
        />
      )}
      {book?.cover && page === 1 && book.coverPrepended && (
        <button
          type='button'
          className='hamster-reader__epub-cover'
          aria-label='进入正文'
          onClick={() => navigate(2)}
        >
          <img
            className='hamster-reader__epub-cover'
            src={book.cover.url}
            alt={book.cover.alt ?? '封面'}
          />
        </button>
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
        showHandles={canEditEndpoints(mouse, source?.format, current)}
        onEditingChange={(value) => {
          editing.current = value
        }}
        onUpdate={(range) => {
          setNativeRange(range.cloneRange())
          const detail = epub.current?.serializeRange(range) ?? serialize()
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
          !props.showPageBrowser && Boolean(currentRectangle ?? draftRectangle)
        }
      >
        {rectanglePopup}
      </PopoverPortal>
    </div>
  )
}
