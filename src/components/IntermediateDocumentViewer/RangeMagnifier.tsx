import html2canvas from 'html2canvas'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef
} from 'react'
import { createPortal } from 'react-dom'
import {
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
  readonly start: (source: HTMLElement, point: MagnifierPoint) => void
  readonly move: (point: MagnifierPoint) => void
  readonly end: () => void
  readonly registerDragCleanup: (cleanup: () => void) => () => void
}

interface RangeMagnifierProviderProps {
  readonly children: ReactNode
  readonly rootElement: HTMLElement | null
}

const RangeMagnifierContext = createContext<RangeMagnifierController | null>(
  null
)

export const useRangeMagnifier = (): RangeMagnifierController | null =>
  useContext(RangeMagnifierContext)

export const RangeMagnifierProvider = ({
  children,
  rootElement
}: RangeMagnifierProviderProps) => {
  const lensRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
    if (lensRef.current) lensRef.current.hidden = true
  }, [])

  const capture = useCallback(
    (page: HTMLElement) => {
      const captureGeneration = captureGenerationRef.current + 1
      captureGenerationRef.current = captureGeneration
      const sourceRect = page.getBoundingClientRect()
      const deviceScale = page.ownerDocument.defaultView?.devicePixelRatio ?? 1

      html2canvas(page, {
        backgroundColor: null,
        ignoreElements: (element) =>
          element.classList.contains('hsn-selection-handle'),
        logging: false,
        scale: deviceScale,
        useCORS: true
      }).then(
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
    [end]
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
    (point: MagnifierPoint) => {
      const lens = lensRef.current
      if (!lens || !rootElement) return

      pointRef.current = point
      const position = resolveMagnifierPosition(
        point,
        rootElement.getBoundingClientRect()
      )
      lens.style.left = `${position.left}px`
      lens.style.top = `${position.top}px`
      lens.dataset.placement = position.placement

      const snapshot = snapshotRef.current
      const canvas = canvasRef.current
      if (snapshot && canvas) drawMagnifierSnapshot(canvas, snapshot, point)

      if (pageRef.current) scheduleCapture()
    },
    [rootElement, scheduleCapture]
  )

  const start = useCallback(
    (source: HTMLElement, point: MagnifierPoint) => {
      const lens = lensRef.current
      const page = source.closest<HTMLElement>(
        '.hamster-reader__intermediate-page'
      )
      if (!lens || !page) return

      if (captureTimerRef.current !== null) {
        clearTimeout(captureTimerRef.current)
        captureTimerRef.current = null
      }
      snapshotRef.current = null
      pageRef.current = null
      lens.hidden = false
      move(point)
      pageRef.current = page
      capture(page)
    },
    [capture, move]
  )

  const registerDragCleanup = useCallback((cleanup: () => void) => {
    dragCleanupsRef.current.add(cleanup)
    return () => dragCleanupsRef.current.delete(cleanup)
  }, [])

  const controller = useMemo<RangeMagnifierController>(
    () => ({ start, move, end, registerDragCleanup }),
    [end, move, registerDragCleanup, start]
  )

  return (
    <RangeMagnifierContext.Provider value={controller}>
      {children}
      {rootElement
        ? createPortal(
            <div
              ref={lensRef}
              className='hamster-reader__range-magnifier'
              data-testid='range-magnifier'
              aria-hidden='true'
              hidden
            >
              <canvas ref={canvasRef} />
              <span className='hamster-reader__range-magnifier-marker' />
            </div>,
            rootElement
          )
        : null}
    </RangeMagnifierContext.Provider>
  )
}
