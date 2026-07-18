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

const MAGNIFIER_SIZE_PX = 120
const MAGNIFIER_GAP_PX = 18
const MAGNIFIER_EDGE_GAP_PX = 8
const MAGNIFICATION = 2

export interface MagnifierPoint {
  readonly clientX: number
  readonly clientY: number
}

interface MagnifierPosition {
  readonly left: number
  readonly top: number
  readonly placement: 'above' | 'below'
}

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

interface MagnifierSnapshot {
  readonly canvas: HTMLCanvasElement
  readonly sourceRect: DOMRect
}

interface MagnifierSourceRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const RangeMagnifierContext = createContext<RangeMagnifierController | null>(
  null
)

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum)

export const resolveMagnifierSourceRect = (
  snapshot: MagnifierSnapshot,
  point: MagnifierPoint
): MagnifierSourceRect => {
  const scaleX = snapshot.canvas.width / snapshot.sourceRect.width
  const scaleY = snapshot.canvas.height / snapshot.sourceRect.height
  const width = Math.min(
    (MAGNIFIER_SIZE_PX / MAGNIFICATION) * scaleX,
    snapshot.canvas.width
  )
  const height = Math.min(
    (MAGNIFIER_SIZE_PX / MAGNIFICATION) * scaleY,
    snapshot.canvas.height
  )
  const centerX = (point.clientX - snapshot.sourceRect.left) * scaleX
  const centerY = (point.clientY - snapshot.sourceRect.top) * scaleY

  return {
    x: clamp(centerX - width / 2, 0, snapshot.canvas.width - width),
    y: clamp(centerY - height / 2, 0, snapshot.canvas.height - height),
    width,
    height
  }
}

export const resolveMagnifierPosition = (
  point: MagnifierPoint,
  rootRect: DOMRect
): MagnifierPosition => {
  const relativeX = point.clientX - rootRect.left
  const relativeY = point.clientY - rootRect.top
  const maximumLeft = Math.max(
    MAGNIFIER_EDGE_GAP_PX,
    rootRect.width - MAGNIFIER_SIZE_PX - MAGNIFIER_EDGE_GAP_PX
  )
  const maximumTop = Math.max(
    MAGNIFIER_EDGE_GAP_PX,
    rootRect.height - MAGNIFIER_SIZE_PX - MAGNIFIER_EDGE_GAP_PX
  )
  const aboveTop = relativeY - MAGNIFIER_SIZE_PX - MAGNIFIER_GAP_PX
  const placement = aboveTop >= MAGNIFIER_EDGE_GAP_PX ? 'above' : 'below'
  const desiredTop =
    placement === 'above' ? aboveTop : relativeY + MAGNIFIER_GAP_PX

  return {
    left: clamp(
      relativeX - MAGNIFIER_SIZE_PX / 2,
      MAGNIFIER_EDGE_GAP_PX,
      maximumLeft
    ),
    top: clamp(desiredTop, MAGNIFIER_EDGE_GAP_PX, maximumTop),
    placement
  }
}

const drawSnapshot = (
  output: HTMLCanvasElement,
  snapshot: MagnifierSnapshot,
  point: MagnifierPoint
): void => {
  const context = output.getContext('2d')
  if (
    !context ||
    snapshot.sourceRect.width <= 0 ||
    snapshot.sourceRect.height <= 0
  )
    return

  const deviceScale = output.ownerDocument.defaultView?.devicePixelRatio ?? 1
  const outputSize = Math.round(MAGNIFIER_SIZE_PX * deviceScale)
  if (output.width !== outputSize || output.height !== outputSize) {
    output.width = outputSize
    output.height = outputSize
  }

  const source = resolveMagnifierSourceRect(snapshot, point)

  context.clearRect(0, 0, output.width, output.height)
  context.drawImage(
    snapshot.canvas,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    output.width,
    output.height
  )
}

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
  const captureGenerationRef = useRef(0)
  const dragCleanupsRef = useRef(new Set<() => void>())

  useEffect(
    () => () => {
      for (const cleanup of dragCleanupsRef.current) cleanup()
      dragCleanupsRef.current.clear()
    },
    []
  )

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
      if (snapshot && canvas) drawSnapshot(canvas, snapshot, point)
    },
    [rootElement]
  )

  const end = useCallback(() => {
    captureGenerationRef.current += 1
    snapshotRef.current = null
    pointRef.current = null
    if (lensRef.current) lensRef.current.hidden = true
  }, [])

  const start = useCallback(
    (source: HTMLElement, point: MagnifierPoint) => {
      const lens = lensRef.current
      const page = source.closest<HTMLElement>(
        '.hamster-reader__intermediate-page'
      )
      if (!lens || !page) return

      const captureGeneration = captureGenerationRef.current + 1
      captureGenerationRef.current = captureGeneration
      snapshotRef.current = null
      lens.hidden = false
      move(point)

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
            drawSnapshot(output, snapshotRef.current, currentPoint)
        },
        () => {
          if (captureGenerationRef.current === captureGeneration) end()
        }
      )
    },
    [end, move]
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
