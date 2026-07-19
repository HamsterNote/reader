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
