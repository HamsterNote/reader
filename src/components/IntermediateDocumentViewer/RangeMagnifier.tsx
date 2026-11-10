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
import { renderFlowMagnifierText, clearFlowMagnifierText } from './flowMagnifierText'
import { projectInsertionMarker, TEXT_LENS_BORDER_PX, TEXT_LENS_DISTANCE_PX, TEXT_LENS_SIZE_PX, TEXT_LENS_MAGNIFICATION, TEXT_LENS_MARKER_WIDTH_PX, usesTouchMagnifier } from './selectionInteraction'
import { magnifierCaptureSource } from './magnifierCaptureSource'
import {
  clearPdfMagnifierText,
  renderPdfMagnifierText,
  type PdfMagnifierFocus
} from './pdfMagnifierText'
import {
  SNAPSHOT_LENS_SIZE_PX,
  SNAPSHOT_LENS_DISTANCE_PX,
  drawMagnifierSnapshot,
  type MagnifierPoint,
  type MagnifierSnapshot,
  resolveMagnifierPosition
} from './rangeMagnifierGeometry'

const SNAPSHOT_DEBOUNCE_MS = 100

export type { MagnifierPoint } from './rangeMagnifierGeometry'
export {
  resolveMagnifierPosition,
  resolveMagnifierSourceRect
} from './rangeMagnifierGeometry'

interface RangeMagnifierController {
  readonly start: (
    source: HTMLElement,
    point: MagnifierPoint,
    pdf?: PdfMagnifierFocus,
    pointerType?: string
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
  source
}: RangeMagnifierProviderProps) => {
  const lensRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const setTextElement = useCallback((element: HTMLDivElement | null) => {
    if (textRef.current) { clearPdfMagnifierText(textRef.current); clearFlowMagnifierText(textRef.current) }
    textRef.current = element
  }, [])
  const markerRef = useRef<HTMLSpanElement>(null)
  const textSessionRef = useRef<{
    source: HTMLElement
    focus: PdfMagnifierFocus
  } | null>(null)
  const [textMode, setTextMode] = useState(false)
  const snapshotRef = useRef<MagnifierSnapshot | null>(null)
  const pointRef = useRef<MagnifierPoint | null>(null)
  const pageRef = useRef<HTMLElement | null>(null)
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
    textSessionRef.current = null
    if (textRef.current) { clearPdfMagnifierText(textRef.current); clearFlowMagnifierText(textRef.current) }
    if (lensRef.current) lensRef.current.hidden = true
  }, [])

  useEffect(() => {
    end()
  }, [end, rootElement, source, enabled])

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
            if (currentPoint && output)
              drawMagnifierSnapshot(output, snapshotRef.current, currentPoint)
          },
          () => {
            if (captureGenerationRef.current === captureGeneration) end()
          }
        )
    },
    [end, rootElement]
  )

  const scheduleCapture = useCallback(() => {
    if (captureTimerRef.current !== null) clearTimeout(captureTimerRef.current)

    captureTimerRef.current = setTimeout(() => {
      captureTimerRef.current = null
      const page = pageRef.current
      if (page) capture(page)
    }, SNAPSHOT_DEBOUNCE_MS)
  }, [capture])

  const move = useCallback(
    (point: MagnifierPoint, pdf?: PdfMagnifierFocus) => {
      const lens = lensRef.current
      if (!lens || !rootElement || !pointRef.current) return

      pointRef.current = point
      if (textSessionRef.current && pdf) textSessionRef.current.focus = pdf
      const box = rootElement.getBoundingClientRect()
      const rootBox = new DOMRect(Math.max(0, box.left), Math.max(0, box.top),
        Math.max(0, Math.min(innerWidth, box.right) - Math.max(0, box.left)),
        Math.max(0, Math.min(innerHeight, box.bottom) - Math.max(0, box.top)))
      const relative = resolveMagnifierPosition(point, rootBox, textSessionRef.current ? TEXT_LENS_SIZE_PX : SNAPSHOT_LENS_SIZE_PX, textSessionRef.current ? TEXT_LENS_DISTANCE_PX : SNAPSHOT_LENS_DISTANCE_PX)
      const position = { ...relative }
      if (textSessionRef.current) {
        // Managed handles and the text lens share a fixed stacking context.
        position.left += rootBox.left
        position.top += rootBox.top
        if (textRef.current) {
          const renderer = textSessionRef.current.source.matches('.pdfViewer')
            ? renderPdfMagnifierText : renderFlowMagnifierText
          renderer(textRef.current, textSessionRef.current.source, point)
        }
        if (markerRef.current) {
          const marker = markerRef.current
          const projection = projectInsertionMarker(textSessionRef.current.focus, point)
          marker.hidden = !projection
          marker.style.backgroundColor = textSessionRef.current.focus.color
          if (projection) {
            marker.style.left = `${projection.left}px`
            marker.style.top = `${projection.top}px`
            marker.style.height = `${projection.height}px`
          }
        }
      }
      lens.style.left = `${position.left}px`
      lens.style.top = `${position.top}px`
      lens.dataset.placement = position.placement

      const snapshot = snapshotRef.current
      const canvas = canvasRef.current
      if (!textSessionRef.current && snapshot && canvas)
        drawMagnifierSnapshot(canvas, snapshot, point)

      if (pageRef.current) scheduleCapture()
    },
    [rootElement, scheduleCapture]
  )

  const start = useCallback(
    (source: HTMLElement, point: MagnifierPoint, pdf?: PdfMagnifierFocus, pointerType?: string) => {
      const lens = lensRef.current
      if (pdf && (!enabled || !usesTouchMagnifier(pointerType ?? ""))) { end(); return }
      pointRef.current = point
      if (pdf && lens) {
        end()
        textSessionRef.current = {
          source: source.closest<HTMLElement>('.pdfViewer') ?? source,
          focus: pdf
        }
        pointRef.current = point
        setTextMode(true)
        lens.hidden = false
        move(point, pdf)
        return
      }
      setTextMode(false)
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
    [capture, move, end, enabled]
  )

  const registerDragCleanup = useCallback((cleanup: () => void) => {
    dragCleanupsRef.current.add(cleanup)
    return () => dragCleanupsRef.current.delete(cleanup)
  }, [])

  useLayoutEffect(() => {
    if (textMode && textSessionRef.current && pointRef.current) {
      if (lensRef.current) lensRef.current.hidden = false
      move(pointRef.current, textSessionRef.current.focus)
    }
  }, [textMode, move])

  const controller = useMemo<RangeMagnifierController>(
    () => ({ start, move, end, registerDragCleanup }),
    [end, move, registerDragCleanup, start]
  )

  const portalHost = textMode ? rootElement?.ownerDocument.body : rootElement

  return enabled ? (
    <RangeMagnifierContext.Provider value={controller}>
      {children}
      {portalHost
        ? createPortal(
            <div
              ref={lensRef}
              className='hamster-reader__range-magnifier'
              data-text={textMode ? 'true' : undefined}
              data-testid='range-magnifier'
              aria-hidden='true'
              style={textMode ? { width: TEXT_LENS_SIZE_PX, height: TEXT_LENS_SIZE_PX, outline: `${TEXT_LENS_BORDER_PX}px solid white`, outlineOffset: -TEXT_LENS_BORDER_PX } : undefined}
              hidden
            >
              <canvas ref={canvasRef} hidden={textMode} />
              <div
                ref={setTextElement}
                className='hamster-reader__range-magnifier-text'
                hidden={!textMode}
                style={{ transform: `scale(${TEXT_LENS_MAGNIFICATION})` }}
              />
              <span
                ref={markerRef}
                style={textMode ? { width: TEXT_LENS_MARKER_WIDTH_PX } : undefined}
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
