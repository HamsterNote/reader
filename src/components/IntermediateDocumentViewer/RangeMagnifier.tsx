import html2canvas from 'html2canvas'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { pdfRangeClientRects } from '../../pdf/pdfSelectionPaint'
import { magnifierCaptureSource } from './magnifierCaptureSource'
import {
  clearPdfMagnifierText,
  renderPdfMagnifierText,
  type PdfMagnifierFocus
} from './pdfMagnifierText'
import {
  drawMagnifierSnapshot,
  type MagnifierPoint,
  type MagnifierSnapshot,
  resolveMagnifierPosition,
  resolveMagnifierSnapshotPoint
} from './rangeMagnifierGeometry'

const SNAPSHOT_DEBOUNCE_MS = 100

export type { MagnifierPoint } from './rangeMagnifierGeometry'
export {
  resolveMagnifierPosition,
  resolveMagnifierSourceRect,
  resolveMagnifierSnapshotPoint
} from './rangeMagnifierGeometry'

interface RangeMagnifierController {
  readonly start: (
    source: HTMLElement,
    point: MagnifierPoint,
    pdf?: PdfMagnifierFocus
  ) => void
  readonly move: (point: MagnifierPoint, pdf?: PdfMagnifierFocus) => void
  readonly end: () => void
  readonly registerDragCleanup: (cleanup: () => void) => () => void
}

interface RangeMagnifierProviderProps {
  readonly children: ReactNode
  readonly enabled?: boolean
  readonly rootElement: HTMLElement | null
  readonly source?: unknown
  readonly pdfText?: boolean
}

const RangeMagnifierContext = createContext<RangeMagnifierController | null>(
  null
)

export const useRangeMagnifier = (): RangeMagnifierController | null =>
  useContext(RangeMagnifierContext)

export const RangeMagnifierProvider = ({
  children,
  enabled = true,
  rootElement,
  source,
  pdfText = false
}: RangeMagnifierProviderProps) => {
  const lensRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const setTextElement = useCallback((element: HTMLDivElement | null) => {
    if (textRef.current) clearPdfMagnifierText(textRef.current)
    textRef.current = element
  }, [])
  const markerRef = useRef<HTMLSpanElement>(null)
  const pdfRef = useRef<{
    source: HTMLElement
    focus: PdfMagnifierFocus
  } | null>(null)
  const [pdfMode, setPdfMode] = useState(false)
  const snapshotRef = useRef<MagnifierSnapshot | null>(null)
  const pointRef = useRef<MagnifierPoint | null>(null)
  const pageRef = useRef<HTMLElement | null>(null)
  const caretSourceRef = useRef<HTMLElement | null>(null)
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureGenerationRef = useRef(0)
  const dragCleanupsRef = useRef(new Set<() => void>())

  useEffect(
    () => () => {
      for (const cleanup of dragCleanupsRef.current) cleanup()
      dragCleanupsRef.current.clear()
      if (captureTimerRef.current !== null)
        clearTimeout(captureTimerRef.current)
      captureGenerationRef.current += 1
    },
    []
  )

  const end = useCallback(() => {
    if (captureTimerRef.current !== null) {
      clearTimeout(captureTimerRef.current)
      captureTimerRef.current = null
    }
    captureGenerationRef.current += 1
    pageRef.current = null
    snapshotRef.current = null
    pointRef.current = null
    pdfRef.current = null
    caretSourceRef.current = null
    if (textRef.current) clearPdfMagnifierText(textRef.current)
    if (markerRef.current) {
      markerRef.current.removeAttribute('data-caret')
      for (const property of ['left', 'top', 'height', 'background-color'])
        markerRef.current.style.removeProperty(property)
    }
    if (lensRef.current) lensRef.current.hidden = true
  }, [])

  useEffect(() => {
    end()
  }, [end, rootElement, source, pdfText])

  const updateCaret = useCallback((point: MagnifierPoint) => {
    const marker = markerRef.current
    const snapshot = snapshotRef.current
    const source = caretSourceRef.current
    if (!marker || !snapshot || !source) return
    const markerPoint = resolveMagnifierSnapshotPoint(snapshot, point)
    if (!markerPoint) return
    const frame =
      source.ownerDocument.defaultView?.frameElement?.getBoundingClientRect()
    const caret = source.ownerDocument.caretRangeFromPoint?.(
      point.clientX - (frame?.left ?? 0),
      point.clientY - (frame?.top ?? 0)
    )
    const lineHeight = caret?.getBoundingClientRect().height ?? 12
    marker.dataset.caret = 'true'
    marker.style.left = `${markerPoint.x}px`
    marker.style.top = `${markerPoint.y}px`
    marker.style.height = `${Math.max(12, lineHeight * 2)}px`
    const color = source.style.getPropertyValue('--hsn-handle-color')
    if (color) marker.style.backgroundColor = color
  }, [])

  const capture = useCallback(
    (page: HTMLElement) => {
      const captureGeneration = captureGenerationRef.current + 1
      captureGenerationRef.current = captureGeneration
      const source = page.getBoundingClientRect()
      const frame =
        page.ownerDocument.defaultView?.frameElement?.getBoundingClientRect()
      const sourceRect = new DOMRect(
        source.x + (frame?.x ?? 0),
        source.y + (frame?.y ?? 0),
        source.width,
        source.height
      )
      const deviceScale = page.ownerDocument.defaultView?.devicePixelRatio ?? 1
      const captureSource = magnifierCaptureSource(
        page,
        rootElement?.ownerDocument ?? page.ownerDocument
      )

      html2canvas(captureSource.element, {
        backgroundColor: null,
        ignoreElements: (element) =>
          element.classList.contains('hsn-selection-handle'),
        logging: false,
        scale: deviceScale,
        useCORS: true
      })
        .finally(captureSource.release)
        .then(
          (canvas) => {
            if (captureGenerationRef.current !== captureGeneration) return

            snapshotRef.current = { canvas, sourceRect }
            const currentPoint = pointRef.current
            const output = canvasRef.current
            if (currentPoint) {
              if (output)
                drawMagnifierSnapshot(output, snapshotRef.current, currentPoint)
              updateCaret(currentPoint)
            }
          },
          () => {
            if (captureGenerationRef.current === captureGeneration) end()
          }
        )
    },
    [end, rootElement, updateCaret]
  )

  const scheduleCapture = useCallback(() => {
    if (captureTimerRef.current !== null) clearTimeout(captureTimerRef.current)

    captureTimerRef.current = setTimeout(() => {
      captureTimerRef.current = null
      const page = pageRef.current
      if (page) capture(page)
    }, SNAPSHOT_DEBOUNCE_MS)
  }, [capture])

  const updateSnapshot = useCallback(
    (point: MagnifierPoint) => {
      const snapshot = snapshotRef.current
      const canvas = canvasRef.current
      if (snapshot && canvas) drawMagnifierSnapshot(canvas, snapshot, point)
      updateCaret(point)
    },
    [updateCaret]
  )

  const move = useCallback(
    (point: MagnifierPoint, pdf?: PdfMagnifierFocus) => {
      const lens = lensRef.current
      if (!lens || !rootElement) return

      pointRef.current = point
      if (pdfRef.current && pdf) pdfRef.current.focus = pdf
      const rootBox = rootElement.getBoundingClientRect()
      const relative = resolveMagnifierPosition(point, rootBox)
      const position = { ...relative }
      if (pdfRef.current) {
        // PDF handles and the lens share a body-level fixed stacking context.
        position.left += rootBox.left
        position.top += rootBox.top
        if (textRef.current)
          renderPdfMagnifierText(textRef.current, pdfRef.current.source, point)
        if (markerRef.current) {
          markerRef.current.style.backgroundColor = pdfRef.current.focus.color
          const rects = pdfRangeClientRects(pdfRef.current.focus.range)
          const rect = pdfRef.current.focus.end ? rects.at(-1) : rects[0]
          markerRef.current.style.height = `${Math.max(12, (rect?.height ?? 12) * 2)}px`
        }
      }
      lens.style.left = `${position.left}px`
      lens.style.top = `${position.top}px`
      lens.dataset.placement = position.placement

      if (!pdfRef.current) updateSnapshot(point)

      if (pageRef.current) scheduleCapture()
    },
    [rootElement, scheduleCapture, updateSnapshot]
  )

  const start = useCallback(
    (source: HTMLElement, point: MagnifierPoint, pdf?: PdfMagnifierFocus) => {
      const lens = lensRef.current
      if (pdf && lens) {
        end()
        pdfRef.current = {
          source: source.closest<HTMLElement>('.pdfViewer') ?? source,
          focus: pdf
        }
        setPdfMode(true)
        lens.hidden = false
        move(point, pdf)
        return
      }
      setPdfMode(false)
      caretSourceRef.current = pdfText ? source : null
      const page = source.closest<HTMLElement>(
        '.hamster-reader__intermediate-page, .hamster-reader__intermediate-text-page, .pdfViewer .page, [data-engine-page]'
      )
      const captureSource =
        page ??
        (source.ownerDocument.defaultView?.frameElement
          ? source
          : source.querySelector<HTMLElement>('.pdfViewer .page'))
      if (!lens || !captureSource) return

      if (captureTimerRef.current !== null) {
        clearTimeout(captureTimerRef.current)
        captureTimerRef.current = null
      }
      snapshotRef.current = null
      pageRef.current = null
      lens.hidden = false
      move(point)
      pageRef.current = captureSource
      capture(captureSource)
    },
    [capture, move, end, pdfText]
  )

  const registerDragCleanup = useCallback((cleanup: () => void) => {
    dragCleanupsRef.current.add(cleanup)
    return () => dragCleanupsRef.current.delete(cleanup)
  }, [])

  useLayoutEffect(() => {
    if (pdfMode && pdfRef.current && pointRef.current) {
      if (lensRef.current) lensRef.current.hidden = false
      move(pointRef.current, pdfRef.current.focus)
    }
  }, [pdfMode, move])

  const controller = useMemo<RangeMagnifierController>(
    () => ({ start, move, end, registerDragCleanup }),
    [end, move, registerDragCleanup, start]
  )

  const portalHost = pdfMode ? rootElement?.ownerDocument.body : rootElement

  return enabled ? (
    <RangeMagnifierContext.Provider value={controller}>
      {children}
      {portalHost
        ? createPortal(
            <div
              ref={lensRef}
              className='hamster-reader__range-magnifier'
              data-pdf={pdfMode ? 'true' : undefined}
              data-testid='range-magnifier'
              aria-hidden='true'
              hidden
            >
              <canvas ref={canvasRef} hidden={pdfMode} />
              <div
                ref={setTextElement}
                className='hamster-reader__range-magnifier-text'
                hidden={!pdfMode}
              />
              <span
                ref={markerRef}
                className='hamster-reader__range-magnifier-marker'
              />
            </div>,
            portalHost
          )
        : null}
    </RangeMagnifierContext.Provider>
  ) : (
    children
  )
}
