import {
  DrawingSurface,
  type DrawingTool,
  type DrawingValue
} from '@hamster-note/painting'
import {
  Selection,
  type SelectionRange,
  type SelectionRect,
  type SelectionRef,
  type SelectionTool
} from '@hamster-note/selection'
import type { IntermediatePageSerialized } from '@hamster-note/types'
import { useEffect, useMemo, useRef, useState } from 'react'

export type ReaderPageTool = 'text-selection' | 'rect-selection' | 'drawing'

export type ReaderPagePaintingMap = Record<string, DrawingValue>

export type ReaderPageTextSelectionMap = Record<
  string,
  readonly SelectionRange[]
>

export type ReaderPageRectSelectionMap = Record<
  string,
  readonly SelectionRect[]
>

export type PageProps = {
  page: IntermediatePageSerialized
  selectedTool?: ReaderPageTool
  paintingValue?: DrawingValue
  paintingTool?: DrawingTool
  textSelections?: readonly SelectionRange[]
  rectSelections?: readonly SelectionRect[]
  onPaintingChange?: (nextValue: DrawingValue) => void
  onTextSelectionsChange?: (nextSelections: readonly SelectionRange[]) => void
  onRectSelectionsChange?: (nextSelections: readonly SelectionRect[]) => void
}

const EMPTY_DRAWING_VALUE: DrawingValue = {
  strokes: []
}

const EMPTY_TEXT_SELECTIONS: readonly SelectionRange[] = []
const EMPTY_RECT_SELECTIONS: readonly SelectionRect[] = []
const PAINTING_GESTURES = ['TouchDoublePan', 'TouchDoubleZoom'] as const

function assertNever(value: never): never {
  throw new Error(`Unexpected reader page tool: ${value}`)
}

function getSelectionTool(tool: ReaderPageTool): SelectionTool {
  switch (tool) {
    case 'text-selection':
      return 'text'
    case 'rect-selection':
      return 'rect'
    case 'drawing':
      return 'text'
    default:
      return assertNever(tool)
  }
}

function getToolLabel(tool: ReaderPageTool): string {
  switch (tool) {
    case 'text-selection':
      return 'Text selection'
    case 'rect-selection':
      return 'Rect selection'
    case 'drawing':
      return 'Drawing'
    default:
      return assertNever(tool)
  }
}

function getPageHint(tool: ReaderPageTool): string {
  switch (tool) {
    case 'text-selection':
      return 'Text selection mode: drag to highlight text on the page.'
    case 'rect-selection':
      return 'Rect selection mode: drag to create a rectangle selection on the page.'
    case 'drawing':
      return 'Drawing mode: single finger draws, two fingers pan/zoom.'
    default:
      return assertNever(tool)
  }
}

type PageTextGeometry = {
  width: number
  height: number
  left: number
  top: number
  rotate: number
}

type SerializedPageText = NonNullable<
  IntermediatePageSerialized['texts']
>[number]

function getPolygonBounds(
  polygon: readonly [number, number][]
): PageTextGeometry | null {
  const firstPoint = polygon[0]
  if (!firstPoint) {
    return null
  }

  let minX = firstPoint[0]
  let maxX = firstPoint[0]
  let minY = firstPoint[1]
  let maxY = firstPoint[1]

  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  return {
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
    left: minX,
    top: minY,
    rotate: 0
  }
}

function getTextGeometry(text: SerializedPageText): PageTextGeometry | null {
  if ('polygon' in text && Array.isArray(text.polygon)) {
    return getPolygonBounds(text.polygon)
  }

  if (
    'width' in text &&
    typeof text.width === 'number' &&
    'height' in text &&
    typeof text.height === 'number' &&
    'x' in text &&
    typeof text.x === 'number' &&
    'y' in text &&
    typeof text.y === 'number'
  ) {
    return {
      width: text.width,
      height: text.height,
      left: text.x,
      top: text.y,
      rotate:
        'rotate' in text && typeof text.rotate === 'number' ? text.rotate : 0
    }
  }

  return null
}

function renderTextLayer(page: IntermediatePageSerialized) {
  const textItems = (page.texts ?? []).map((text) => {
    const geometry = getTextGeometry(text)
    if (!geometry) {
      return null
    }

    const widthPercent = (geometry.width / page.width) * 100
    const heightPercent = (geometry.height / page.height) * 100
    const leftPercent = (geometry.left / page.width) * 100
    const topPercent = (geometry.top / page.height) * 100
    const fontSizePercent = (text.fontSize / page.width) * 100
    const lineHeightPercent = (text.lineHeight / page.height) * 100

    return (
      <span
        key={text.id}
        className='hamster-reader__text-item'
        data-testid={`reader-page-text-${text.id}`}
        style={{
          width: `${widthPercent}%`,
          minHeight: `${heightPercent}%`,
          left: `${leftPercent}%`,
          top: `${topPercent}%`,
          fontSize: `${fontSizePercent}%`,
          lineHeight: `${Math.max(lineHeightPercent, fontSizePercent)}%`,
          fontFamily: text.fontFamily,
          fontWeight: text.fontWeight,
          fontStyle: text.italic ? 'italic' : 'normal',
          color: text.color,
          transform: `rotate(${geometry.rotate}deg) skew(${text.skew}deg)`
        }}
      >
        {text.content}
      </span>
    )
  })

  return (
    <div
      className='hamster-reader__text-layer'
      data-testid={`reader-page-text-layer-${page.id}`}
    >
      {textItems}
    </div>
  )
}

export function Page({
  page,
  selectedTool = 'text-selection',
  paintingValue,
  paintingTool = 'pen',
  textSelections = EMPTY_TEXT_SELECTIONS,
  rectSelections = EMPTY_RECT_SELECTIONS,
  onPaintingChange,
  onTextSelectionsChange,
  onRectSelectionsChange
}: PageProps) {
  const selectionRef = useRef<SelectionRef>(null)
  const selectionTool = getSelectionTool(selectedTool)
  const drawingValue = paintingValue ?? EMPTY_DRAWING_VALUE
  const contentCount = page.texts?.length ?? 0
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const [selectedRectId, setSelectedRectId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedRangeId((currentValue) => {
      if (currentValue === null) {
        return null
      }

      const hasMatch = textSelections.some((item) => item.id === currentValue)
      return hasMatch ? currentValue : null
    })
  }, [textSelections])

  useEffect(() => {
    setSelectedRectId((currentValue) => {
      if (currentValue === null) {
        return null
      }

      const hasMatch = rectSelections.some((item) => item.id === currentValue)
      return hasMatch ? currentValue : null
    })
  }, [rectSelections])

  const textLayer = useMemo(() => renderTextLayer(page), [page])
  const showSelectionLayer = selectedTool !== 'drawing'
  const handleSelectionEnd = () => {
    window.setTimeout(() => {
      if (selectedTool === 'rect-selection') {
        selectionRef.current?.confirmRect()
        return
      }

      if (selectedTool === 'text-selection') {
        selectionRef.current?.confirm()
      }
    }, 0)
  }

  return (
    <article
      className='hamster-reader__page'
      data-testid={`reader-page-${page.id}`}
      data-tool={selectedTool}
    >
      <header className='hamster-reader__page-header'>
        <div>
          <p className='hamster-reader__page-kicker'>Page {page.number}</p>
          <h3 className='hamster-reader__page-title'>Canvas</h3>
        </div>
        <dl className='hamster-reader__page-meta'>
          <div>
            <dt>Size</dt>
            <dd>
              {page.width} × {page.height}
            </dd>
          </div>
          <div>
            <dt>Content</dt>
            <dd>{contentCount}</dd>
          </div>
          <div>
            <dt>Tool</dt>
            <dd>{getToolLabel(selectedTool)}</dd>
          </div>
          <div>
            <dt>Text Marks</dt>
            <dd>{textSelections.length}</dd>
          </div>
          <div>
            <dt>Rect Marks</dt>
            <dd>{rectSelections.length}</dd>
          </div>
          <div>
            <dt>Strokes</dt>
            <dd>{drawingValue.strokes.length}</dd>
          </div>
        </dl>
      </header>

      <div className='hamster-reader__page-body'>
        <div
          className='hamster-reader__page-surface'
          style={{ aspectRatio: `${page.width} / ${page.height}` }}
          data-testid={`reader-page-surface-${page.id}`}
        >
          {showSelectionLayer ? (
            <Selection
              ref={selectionRef}
              className='hamster-reader__selection-layer'
              tool={selectionTool}
              ranges={[...textSelections]}
              rects={[...rectSelections]}
              selectedRangeId={selectedRangeId}
              selectedRectId={selectedRectId}
              onSelect={(range) => {
                onTextSelectionsChange?.([...textSelections, range])
                setSelectedRangeId(range.id)
              }}
              onSelectRange={setSelectedRangeId}
              onCreateRect={(rect) => {
                onRectSelectionsChange?.([...rectSelections, rect])
                setSelectedRectId(rect.id)
              }}
              onSelectRect={setSelectedRectId}
              onSelectionEnd={handleSelectionEnd}
              selectionStyle={{ backgroundColor: 'rgba(236, 72, 153, 0.28)' }}
              markerStyle={{ backgroundColor: 'rgba(250, 204, 21, 0.36)' }}
            >
              {textLayer}
            </Selection>
          ) : (
            textLayer
          )}

          <div
            className='hamster-reader__drawing-layer'
            data-testid={`reader-page-drawing-layer-${page.id}`}
          >
            <DrawingSurface
              value={drawingValue}
              onChange={onPaintingChange}
              tool={paintingTool}
              inputMethods={selectedTool === 'drawing' ? undefined : []}
              gestures={selectedTool === 'drawing' ? PAINTING_GESTURES : []}
              gestureScaleBounds={{ minScale: 0.5, maxScale: 4 }}
              cursor={selectedTool === 'drawing' ? undefined : false}
              strokeColor='#2563eb'
              strokeWidth={3}
              testID={`reader-painting-${page.id}`}
            />
          </div>
        </div>

        <p className='hamster-reader__page-hint'>{getPageHint(selectedTool)}</p>
      </div>
    </article>
  )
}
