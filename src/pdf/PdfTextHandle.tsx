import type {
  HandleRenderProps,
  LinkedSelectionData
} from '@hamster-note/selection'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useRef
} from 'react'
import { useRangeHandleDrag } from '../components/IntermediateDocumentViewer/useRangeHandleDrag'
import { PdfTouchSelectionHandle } from '../components/PdfTouchSelectionHandle'
import { pdfTextDomOffsetRect, pdfTextRectColumn } from './pdfTextPagination'

type PdfTextHandleProps = {
  handle: HandleRenderProps
  linkedData: LinkedSelectionData
  root: HTMLElement | null
  selectionId: string
  width: number
  column: number
  magnifierEnabled: boolean
}

type PdfTextGeometry = {
  left: number | string
  top: number | string
  lineHeight: number
  libraryPoint: { clientX: number; clientY: number }
}

const axisPosition = (
  value: number,
  unit: HandleRenderProps['positionUnit'],
  pixelOffset = 0
): number | string => {
  if (unit === 'px') return value + pixelOffset
  if (pixelOffset === 0) return `${value}%`
  return `calc(${value}% ${pixelOffset < 0 ? '-' : '+'} ${Math.abs(pixelOffset)}px)`
}

const handleColor = (style: CSSProperties): string => {
  const color = (style as CSSProperties & { '--hsn-handle-color'?: string })[
    '--hsn-handle-color'
  ]
  if (color) return color
  if (typeof style.backgroundColor === 'string') return style.backgroundColor
  if (typeof style.background === 'string') return style.background
  return '#ffc107'
}

function PdfTextHandleControl({
  handle,
  root,
  magnifierEnabled,
  geometry
}: Pick<PdfTextHandleProps, 'handle' | 'root' | 'magnifierEnabled'> & {
  geometry: PdfTextGeometry
}) {
  const circleRef = useRef<HTMLButtonElement>(null)
  const startHandleDrag = useRangeHandleDrag({
    circleRef,
    correctPointerCoordinates: true,
    magnifierEnabled,
    viewerRoot: root,
    pointerTarget: geometry.libraryPoint
  })
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    startHandleDrag(event.nativeEvent)
    handle.onPointerDown(event)
  }

  return (
    <PdfTouchSelectionHandle
      ref={circleRef}
      end={handle.type === 'end'}
      color={handleColor(handle.style)}
      lineHeight={geometry.lineHeight}
      className={handle.className}
      aria-label={handle.ariaLabel}
      data-range-handle-circle={handle.type}
      data-rect-id={handle.rectId ?? ''}
      data-range-id={handle.rangeId ?? ''}
      data-pdf-text-target-x={geometry.libraryPoint.clientX}
      data-pdf-text-target-y={geometry.libraryPoint.clientY}
      style={{
        ...handle.style,
        position: 'absolute',
        left: geometry.left,
        top: geometry.top
      }}
      onPointerDown={handlePointerDown}
    />
  )
}

export function PdfTextHandle({
  handle,
  linkedData,
  root,
  selectionId,
  width,
  column,
  magnifierEnabled
}: PdfTextHandleProps) {
  const end = handle.type === 'end'
  const range =
    handle.owner === 'active-selection'
      ? linkedData.activeRange
      : linkedData.items.find((item) => item.id === handle.rangeId)
  const endpoint = end ? range?.end : range?.start
  const content = Array.from(
    root?.querySelectorAll<HTMLElement>('.hsn-selection-content') ?? []
  ).find(
    (candidate) =>
      candidate.closest<HTMLElement>('[data-selection-id]')?.dataset
        .selectionId === selectionId
  )
  if (!endpoint || endpoint.selectionId !== selectionId || !content) return null
  const offset = end ? Math.max(0, endpoint.offset - 1) : endpoint.offset
  const endpointRect = pdfTextDomOffsetRect(content, offset)
  if (
    !endpointRect ||
    pdfTextRectColumn(content, endpointRect, width) !== column
  )
    return null
  const container = content.closest<HTMLElement>('.hsn-selection-container')
  if (!container) return null
  const containerRect = container.getBoundingClientRect()
  const percent = handle.positionUnit === 'percent'
  if (percent && (containerRect.width === 0 || containerRect.height === 0))
    return null

  const localX =
    (end ? endpointRect.right : endpointRect.left) - containerRect.left
  const localY =
    (end ? endpointRect.bottom : endpointRect.top) - containerRect.top
  const geometry: PdfTextGeometry = {
    left: axisPosition(
      percent ? (localX / containerRect.width) * 100 : localX,
      handle.positionUnit
    ),
    top: axisPosition(
      percent ? (localY / containerRect.height) * 100 : localY,
      handle.positionUnit,
      end ? 10 : -10
    ),
    lineHeight: endpointRect.height,
    libraryPoint: {
      clientX: percent
        ? containerRect.left + (handle.position.x / 100) * containerRect.width
        : containerRect.left + handle.position.x,
      clientY: percent
        ? containerRect.top + (handle.position.y / 100) * containerRect.height
        : containerRect.top + handle.position.y
    }
  }
  return (
    <PdfTextHandleControl
      handle={handle}
      root={root}
      magnifierEnabled={magnifierEnabled}
      geometry={geometry}
    />
  )
}
