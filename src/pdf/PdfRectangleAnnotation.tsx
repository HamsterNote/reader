import { useRef, useState } from 'react'
import type { ReaderSelectionRectangle } from '../types/selection'
import {
  captureViewportRectAsStored,
  projectStoredRectToViewport
} from './pdfOverlayGeometry'
import type { PdfPageOverlayGeometry } from './PdfPageOverlayLayer'

export function PdfRectangleAnnotation({
  rectangle,
  selected,
  geometry,
  pageDiv,
  onUpdate
}: {
  readonly rectangle: ReaderSelectionRectangle
  readonly selected: boolean
  readonly geometry: PdfPageOverlayGeometry
  readonly pageDiv: HTMLElement
  readonly onUpdate?: (rectangle: ReaderSelectionRectangle) => void
}) {
  const [draft, setDraft] = useState<ReaderSelectionRectangle | null>(null)
  const drag = useRef<{
    pointer: number
    opposite: { x: number; y: number }
    value: ReaderSelectionRectangle
  } | null>(null)
  const value = draft ?? rectangle
  const projected = projectStoredRectToViewport(
    value.rect,
    value.overlayRectType,
    geometry.scaleOneViewport,
    geometry.viewport,
    geometry.visual
  )
  const color = rectangle.selectionStyle?.borderColor ?? '#1976d2'
  const finish = () => {
    drag.current = null
    setDraft(null)
  }
  return (
    <div
      className={`hamster-reader__pdf-rect-annotation${selected ? ' hsn-selection-rect--selected' : ''}`}
      data-rect-id={rectangle.id}
      style={{
        left: projected.left,
        top: projected.top,
        width: projected.width,
        height: projected.height,
        ...rectangle.markerStyle,
        borderColor: color
      }}
    >
      {selected &&
        onUpdate &&
        [
          [false, false],
          [true, false],
          [false, true],
          [true, true]
        ].map(([right, bottom]) => (
          <button
            type='button'
            key={`${right}:${bottom}`}
            aria-label={`调整矩形${bottom ? '下' : '上'}${right ? '右' : '左'}角`}
            className='hamster-reader__engine-handle'
            style={{
              position: 'absolute',
              left: right ? 'calc(100% - 7px)' : -7,
              top: bottom ? 'calc(100% - 7px)' : -7,
              pointerEvents: 'auto'
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = {
                pointer: event.pointerId,
                opposite: {
                  x: projected.left + (right ? 0 : projected.width),
                  y: projected.top + (bottom ? 0 : projected.height)
                },
                value: rectangle
              }
            }}
            onPointerMove={(event) => {
              const active = drag.current
              if (!active || active.pointer !== event.pointerId) return
              const page = pageDiv.getBoundingClientRect()
              const x = Math.max(
                0,
                Math.min(page.width, event.clientX - page.left)
              )
              const y = Math.max(
                0,
                Math.min(page.height, event.clientY - page.top)
              )
              const box = {
                left: Math.min(active.opposite.x, x),
                top: Math.min(active.opposite.y, y),
                width: Math.abs(active.opposite.x - x),
                height: Math.abs(active.opposite.y - y)
              }
              const stored = captureViewportRectAsStored(
                box,
                geometry.viewport,
                geometry.scaleOneViewport,
                rectangle.overlayRectType,
                geometry.visual
              )
              const next = {
                ...rectangle,
                rect: stored,
                start: { x: stored.x, y: stored.y },
                end: { x: stored.x + stored.width, y: stored.y + stored.height }
              }
              active.value = next
              setDraft(next)
            }}
            onPointerUp={(event) => {
              if (drag.current?.pointer !== event.pointerId) return
              const next = drag.current.value
              finish()
              if (next !== rectangle) onUpdate(next)
            }}
            onPointerCancel={finish}
          />
        ))}
    </div>
  )
}
