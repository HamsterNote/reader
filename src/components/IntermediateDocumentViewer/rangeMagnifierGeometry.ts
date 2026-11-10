import {
  TEXT_LENS_SIZE_PX as MAGNIFIER_SIZE_PX,
  TEXT_LENS_DISTANCE_PX,
  TEXT_LENS_EDGE_PX as MAGNIFIER_EDGE_GAP_PX,
  TEXT_LENS_MAGNIFICATION as MAGNIFICATION
} from './selectionInteraction'

// Preserve the existing rectangle-tool snapshot geometry.
export const SNAPSHOT_LENS_SIZE_PX = 120
export const SNAPSHOT_LENS_DISTANCE_PX = 78

export interface MagnifierPoint {
  readonly clientX: number
  readonly clientY: number
}

interface MagnifierPosition {
  readonly left: number
  readonly top: number
  readonly placement: 'above' | 'below'
}

export interface MagnifierSnapshot {
  readonly canvas: HTMLCanvasElement
  readonly sourceRect: DOMRect
}

interface MagnifierSourceRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum)

export const resolveMagnifierSourceRect = (
  snapshot: MagnifierSnapshot,
  point: MagnifierPoint
): MagnifierSourceRect => {
  const scaleX = snapshot.canvas.width / snapshot.sourceRect.width
  const scaleY = snapshot.canvas.height / snapshot.sourceRect.height
  const width = Math.min(
    (SNAPSHOT_LENS_SIZE_PX / MAGNIFICATION) * scaleX,
    snapshot.canvas.width
  )
  const height = Math.min(
    (SNAPSHOT_LENS_SIZE_PX / MAGNIFICATION) * scaleY,
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
  rootRect: DOMRect,
  size = MAGNIFIER_SIZE_PX,
  distance = TEXT_LENS_DISTANCE_PX
): MagnifierPosition => {
  const relativeX = point.clientX - rootRect.left
  const relativeY = point.clientY - rootRect.top
  const edgeX = Math.min(MAGNIFIER_EDGE_GAP_PX, Math.max(0, (rootRect.width - size) / 2))
  const edgeY = Math.min(MAGNIFIER_EDGE_GAP_PX, Math.max(0, (rootRect.height - size) / 2))
  const maximumLeft = Math.max(
    edgeX,
    rootRect.width - size - edgeX
  )
  const maximumTop = Math.max(
    edgeY,
    rootRect.height - size - edgeY
  )
  const aboveTop = relativeY - distance - size / 2
  const placement = aboveTop >= edgeY ? 'above' : 'below'
  const desiredTop =
    placement === 'above' ? aboveTop : relativeY + distance - size / 2

  return {
    left: clamp(
      relativeX - size / 2,
      edgeX,
      maximumLeft
    ),
    top: clamp(desiredTop, edgeY, maximumTop),
    placement
  }
}

export const drawMagnifierSnapshot = (
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
  const outputSize = Math.round(SNAPSHOT_LENS_SIZE_PX * deviceScale)
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
