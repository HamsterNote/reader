import {
  DrawingSurface,
  type DrawingGesture,
  type DrawingPoint,
  type DrawingStroke,
  type DrawingTool,
  type DrawingValue
} from '@hamster-note/painting'
import { useMemo } from 'react'

const EMPTY_DRAWING_VALUE: DrawingValue = { strokes: [] }
const MAX_DRAWING_STROKES = 500
const MAX_DRAWING_POINTS = 20_000
const MAX_DASH_ARRAY_VALUES = 32

export type PageDrawingLayerProps = {
  readonly enabled: boolean
  readonly pageId: string
  readonly tool?: DrawingTool
  /** 绘制图形的描边颜色，默认 '#2563eb' */
  readonly strokeColor?: string
  readonly value?: DrawingValue
  readonly onChange?: (nextValue: DrawingValue) => void
  readonly gestures?: readonly DrawingGesture[]
  readonly gestureScaleBounds?: {
    readonly minScale?: number
    readonly maxScale?: number
  }
  readonly canvasScale?: number
}

function parseDrawingPoint(point: unknown): DrawingPoint | null {
  if (
    typeof point !== 'object' ||
    point === null ||
    !('x' in point) ||
    typeof point.x !== 'number' ||
    !Number.isFinite(point.x) ||
    !('y' in point) ||
    typeof point.y !== 'number' ||
    !Number.isFinite(point.y)
  ) {
    return null
  }

  return {
    x: point.x,
    y: point.y,
    ...('pressure' in point &&
    typeof point.pressure === 'number' &&
    Number.isFinite(point.pressure)
      ? { pressure: point.pressure }
      : {})
  }
}

function parseDrawingTool(tool: unknown): DrawingTool | null {
  switch (tool) {
    case 'pen':
    case 'line':
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'bezier':
    case 'eraser':
      return tool
    default:
      return null
  }
}

type DrawingStrokeCandidate = {
  readonly id: unknown
  readonly tool?: unknown
  readonly points: unknown
}

function isDrawingStrokeCandidate(
  stroke: unknown
): stroke is DrawingStrokeCandidate {
  return (
    typeof stroke === 'object' &&
    stroke !== null &&
    'id' in stroke &&
    'points' in stroke
  )
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getDashArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .slice(0, MAX_DASH_ARRAY_VALUES)
    .filter(
      (item): item is number =>
        typeof item === 'number' && Number.isFinite(item)
    )
  return values.length === Math.min(value.length, MAX_DASH_ARRAY_VALUES)
    ? values
    : undefined
}

function parseDrawingStroke(
  stroke: unknown,
  maxPointChecks: number
): {
  readonly stroke: DrawingStroke
  readonly inspectedPointCount: number
} | null {
  if (
    !isDrawingStrokeCandidate(stroke) ||
    typeof stroke.id !== 'string' ||
    !Array.isArray(stroke.points)
  ) {
    return null
  }

  const tool = parseDrawingTool(stroke.tool)
  if (!tool) return null

  const inspectedPoints = stroke.points.slice(0, maxPointChecks)
  const points = inspectedPoints.flatMap(
    (point: unknown) => parseDrawingPoint(point) ?? []
  )

  return {
    inspectedPointCount: inspectedPoints.length,
    stroke: {
      id: stroke.id,
      tool,
      points,
      ...('strokeColor' in stroke
        ? { strokeColor: getOptionalString(stroke.strokeColor) }
        : {}),
      ...('strokeWidth' in stroke
        ? { strokeWidth: getFiniteNumber(stroke.strokeWidth) }
        : {}),
      ...('dashArray' in stroke
        ? { dashArray: getDashArray(stroke.dashArray) }
        : {}),
      ...('dashOffset' in stroke
        ? { dashOffset: getFiniteNumber(stroke.dashOffset) }
        : {}),
      ...('fillColor' in stroke
        ? { fillColor: getOptionalString(stroke.fillColor) }
        : {}),
      ...('fillOpacity' in stroke
        ? { fillOpacity: getFiniteNumber(stroke.fillOpacity) }
        : {})
    }
  }
}

export function sanitizeDrawingValue(value: unknown): DrawingValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('strokes' in value) ||
    !Array.isArray(value.strokes)
  ) {
    return EMPTY_DRAWING_VALUE
  }

  let inspectedPointCount = 0
  const strokes: DrawingStroke[] = []
  const rawStrokes: readonly unknown[] = value.strokes

  for (const stroke of rawStrokes.slice(0, MAX_DRAWING_STROKES)) {
    const remainingPointChecks = MAX_DRAWING_POINTS - inspectedPointCount
    if (remainingPointChecks === 0) break

    const parsedStroke = parseDrawingStroke(stroke, remainingPointChecks)
    if (!parsedStroke) continue

    inspectedPointCount += parsedStroke.inspectedPointCount
    strokes.push(parsedStroke.stroke)
  }

  return { strokes }
}

function scaleDrawingValue(value: DrawingValue, scale: number): DrawingValue {
  return {
    strokes: value.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({
        ...point,
        x: point.x * scale,
        y: point.y * scale
      }))
    }))
  }
}

export function hasDrawingStrokes(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'strokes' in value &&
    Array.isArray(value.strokes) &&
    value.strokes.length > 0
  )
}

export function PageDrawingLayer({
  enabled,
  pageId,
  tool = 'pen',
  strokeColor = '#2563eb',
  value,
  onChange,
  gestures = [],
  gestureScaleBounds,
  canvasScale = 1
}: PageDrawingLayerProps) {
  const safeCanvasScale =
    Number.isFinite(canvasScale) && canvasScale > 0 ? canvasScale : 1
  const drawingValue = useMemo(
    () => scaleDrawingValue(sanitizeDrawingValue(value), safeCanvasScale),
    [safeCanvasScale, value]
  )
  const handleChange = onChange
    ? (nextValue: DrawingValue) => {
        onChange(scaleDrawingValue(nextValue, 1 / safeCanvasScale))
      }
    : undefined

  return (
    <div
      className='hamster-reader__drawing-layer'
      data-testid={`reader-page-drawing-layer-${pageId}`}
      style={{
        pointerEvents: enabled ? 'auto' : 'none',
        width: `${safeCanvasScale * 100}%`,
        height: `${safeCanvasScale * 100}%`,
        transform: `scale(${1 / safeCanvasScale})`,
        transformOrigin: 'top left'
      }}
    >
      <DrawingSurface
        value={drawingValue}
        onChange={handleChange}
        tool={tool}
        inputMethods={enabled ? undefined : []}
        gestures={gestures}
        gestureScaleBounds={gestureScaleBounds}
        cursor={enabled ? undefined : false}
        strokeColor={strokeColor}
        strokeWidth={3}
        testID={`reader-painting-${pageId}`}
      />
    </div>
  )
}
