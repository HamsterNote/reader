import {
  type DrawingValue,
  normalizeDrawingValue,
  PaintingBoard,
  type PaintingControllerData
} from '@hamster-note/painting'
import { useEffect, useMemo, useRef } from 'react'

export type PageDrawingLayerProps = {
  readonly enabled: boolean
  readonly pageId: string
  readonly controllerData: PaintingControllerData
  readonly onControllerDataChange: (data: PaintingControllerData) => void
  readonly value?: DrawingValue
  readonly onChange?: (nextValue: DrawingValue) => void
  readonly canvasScale?: number
  readonly cancelDrawingOnMultiTouch?: boolean
}

/**
 * 将外部持久化数据统一迁移到 painting 当前的数据结构。
 * PaintingBoard 产生的 text、image 等新笔迹字段会由官方迁移器完整保留。
 */
export function sanitizeDrawingValue(value: unknown): DrawingValue {
  const normalized =
    typeof value === 'object' && value !== null
      ? normalizeDrawingValue(value)
      : normalizeDrawingValue(undefined)

  return {
    ...normalized,
    strokes: normalized.strokes.slice(0, 500).map((stroke) => ({
      ...stroke,
      points: stroke.points.slice(0, 20_000),
      dashArray: stroke.dashArray?.slice(0, 32)
    }))
  }
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
  controllerData,
  onControllerDataChange,
  value,
  onChange,
  canvasScale = 1,
  cancelDrawingOnMultiTouch = false
}: PageDrawingLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    const layer = layerRef.current
    if (!enabled || !cancelDrawingOnMultiTouch || !layer) return

    const ownerDocument = layer.ownerDocument
    const PointerEventConstructor = ownerDocument.defaultView?.PointerEvent
    if (!PointerEventConstructor) return

    const activeTouchPointerIds = new Set<number>()
    const dispatchedCancelPointerIds = new Set<number>()
    let isMultiTouchGesture = false

    const cancelDrawingPointers = () => {
      for (const pointerId of activeTouchPointerIds) {
        dispatchedCancelPointerIds.add(pointerId)
        ownerDocument.dispatchEvent(
          new PointerEventConstructor('pointercancel', {
            bubbles: true,
            pointerId,
            pointerType: 'touch'
          })
        )
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return

      if (activeTouchPointerIds.size === 0 && !isMultiTouchGesture) {
        activeTouchPointerIds.add(event.pointerId)
        return
      }

      cancelDrawingPointers()
      activeTouchPointerIds.add(event.pointerId)
      isMultiTouchGesture = true
      event.stopImmediatePropagation()
    }

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      if (
        event.type === 'pointercancel' &&
        dispatchedCancelPointerIds.delete(event.pointerId)
      ) {
        return
      }

      activeTouchPointerIds.delete(event.pointerId)
      if (activeTouchPointerIds.size === 0) {
        isMultiTouchGesture = false
      }
    }

    layer.addEventListener('pointerdown', handlePointerDown, true)
    ownerDocument.addEventListener('pointerup', handlePointerEnd, true)
    ownerDocument.addEventListener('pointercancel', handlePointerEnd, true)
    return () => {
      cancelDrawingPointers()
      layer.removeEventListener('pointerdown', handlePointerDown, true)
      ownerDocument.removeEventListener('pointerup', handlePointerEnd, true)
      ownerDocument.removeEventListener('pointercancel', handlePointerEnd, true)
    }
  }, [cancelDrawingOnMultiTouch, enabled])

  return (
    <div
      ref={layerRef}
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
      <PaintingBoard
        value={drawingValue}
        onChange={handleChange}
        inputMethods={enabled ? undefined : []}
        cursor={enabled ? undefined : false}
        toolbar={false}
        virtualPaper={false}
        controller={{
          boardId: pageId,
          data: controllerData,
          onDataChange: onControllerDataChange
        }}
        testID={`reader-painting-${pageId}`}
      />
    </div>
  )
}
