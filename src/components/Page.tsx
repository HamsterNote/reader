import type {
  DrawingTool,
  DrawingValue,
  PaintingControllerData
} from '@hamster-note/painting'
import {
  Selection,
  type SelectionRange,
  type SelectionRect,
  type SelectionRef,
  type SelectionTool
} from '@hamster-note/selection'
import type {
  IntermediatePageSerialized,
  IntermediateTextSerialized
} from '@hamster-note/types'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import type { ReaderPageTool } from '../types/readerOptions'
import { PageDrawingLayer, sanitizeDrawingValue } from './PageDrawingLayer'

export type { ReaderPageTool } from '../types/readerOptions'

/**
 * 文档流页面的坐标基准宽度：A4 纸宽度（pt，72dpi 下 210mm = 595pt）。
 * 与 IntermediateDocumentViewer 的 DEFAULT_PAGE_SIZE 宽度保持一致。
 *
 * useFlowLayout 页面不再受自身 width/height 约束：宽度按 A4 纸宽度计算
 * 文字缩放，高度由文档流内容自然撑开。
 */
export const FLOW_LAYOUT_PAGE_WIDTH = 595

/**
 * 携带 useFlowLayout 标记的序列化页面。
 *
 * 普通页面按 width/height 比例做绝对定位渲染；当页面数据带有
 * `useFlowLayout: true` 时（例如 TXT 直出页面），Page 改用文档流渲染：
 * 文本条目不做绝对定位，按内容顺序排列，isEOL 条目后换行。
 */
export type ReaderFlowLayoutPage = IntermediatePageSerialized & {
  /** 为 true 时使用文档流渲染，忽略 width/height 的尺寸约束 */
  useFlowLayout?: boolean
}

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
  page: ReaderFlowLayoutPage
  selectedTool?: ReaderPageTool
  paintingValue?: DrawingValue
  paintingTool?: DrawingTool
  /** 绘制图形的描边颜色，默认 '#2563eb' */
  drawingStrokeColor?: string
  textSelections?: readonly SelectionRange[]
  rectSelections?: readonly SelectionRect[]
  onPaintingChange?: (nextValue: DrawingValue) => void
  onTextSelectionsChange?: (nextSelections: readonly SelectionRange[]) => void
  onRectSelectionsChange?: (nextSelections: readonly SelectionRect[]) => void
  onTextSelectionUpdate?: (nextSelection: SelectionRange) => void
  onRectSelectionUpdate?: (nextSelection: SelectionRect) => void
  autoConfirm?: boolean
}

const EMPTY_TEXT_SELECTIONS: readonly SelectionRange[] = []
const EMPTY_RECT_SELECTIONS: readonly SelectionRect[] = []

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

type SerializedPageText = IntermediateTextSerialized

function getPageTexts(
  page: IntermediatePageSerialized
): readonly SerializedPageText[] {
  if (page.content) {
    return page.content.filter(
      (item): item is IntermediateTextSerialized => !('src' in item)
    )
  }

  return page.texts ?? []
}

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

function renderFlowTextItem(text: SerializedPageText, index: number) {
  const key = text.id ?? `flow-text-${index}`

  // EOL 空文本（TXT 空行）不产出 span，只保留一个换行。
  if (text.content.length === 0) {
    return text.isEOL ? <br key={`${key}:eol`} /> : null
  }

  return (
    <Fragment key={key}>
      <span
        className='hamster-reader__text-item hamster-reader__text-item--flow'
        data-testid={`reader-page-text-${text.id}`}
        style={{
          fontSize: `${(text.fontSize / FLOW_LAYOUT_PAGE_WIDTH) * 100}%`,
          lineHeight: `${Math.max((text.lineHeight / text.fontSize) * 100, 100)}%`,
          fontFamily: text.fontFamily,
          fontWeight: text.fontWeight,
          fontStyle: text.italic ? 'italic' : 'normal',
          color: text.color
        }}
      >
        {text.content}
      </span>
      {text.isEOL ? <br key={`${key}:eol`} /> : null}
    </Fragment>
  )
}

function renderTextLayer(page: ReaderFlowLayoutPage, useFlowLayout: boolean) {
  if (useFlowLayout) {
    return (
      <div
        className='hamster-reader__text-layer hamster-reader__text-layer--flow'
        data-testid={`reader-page-text-layer-${page.id}`}
        style={{ fontSize: '100cqw' }}
      >
        {getPageTexts(page).map(renderFlowTextItem)}
      </div>
    )
  }

  const textItems = getPageTexts(page).map((text) => {
    const geometry = getTextGeometry(text)
    if (!geometry) {
      return null
    }

    const widthPercent = (geometry.width / page.width) * 100
    const heightPercent = (geometry.height / page.height) * 100
    const leftPercent = (geometry.left / page.width) * 100
    const topPercent = (geometry.top / page.height) * 100
    const fontSizePercent = (text.fontSize / page.width) * 100
    const lineHeightPercent = (text.lineHeight / text.fontSize) * 100

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
          lineHeight: `${Math.max(lineHeightPercent, 100)}%`,
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
      style={{ fontSize: '100cqw' }}
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
  drawingStrokeColor = '#2563eb',
  textSelections = EMPTY_TEXT_SELECTIONS,
  rectSelections = EMPTY_RECT_SELECTIONS,
  onPaintingChange,
  onTextSelectionsChange,
  onRectSelectionsChange,
  onTextSelectionUpdate,
  onRectSelectionUpdate,
  autoConfirm = false
}: PageProps) {
  const selectionRef = useRef<SelectionRef>(null)
  const confirmationTimerRef = useRef<number | null>(null)
  const selectionTool = getSelectionTool(selectedTool)
  const drawingValue = useMemo(
    () => sanitizeDrawingValue(paintingValue),
    [paintingValue]
  )
  const contentCount = getPageTexts(page).length
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const [selectedRectId, setSelectedRectId] = useState<string | null>(null)
  const [paintingControllerData, setPaintingControllerData] =
    useState<PaintingControllerData>({
      tool: paintingTool,
      minimap: false,
      strokeColor: drawingStrokeColor,
      strokeWidth: 3
    })

  useEffect(() => {
    setPaintingControllerData((current) => ({
      ...current,
      tool: paintingTool,
      strokeColor: drawingStrokeColor
    }))
  }, [drawingStrokeColor, paintingTool])

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

  useEffect(
    () => () => {
      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current)
      }
    },
    []
  )

  const useFlowLayout = page.useFlowLayout === true
  const textLayer = useMemo(
    () => renderTextLayer(page, useFlowLayout),
    [page, useFlowLayout]
  )
  const showSelectionLayer = selectedTool !== 'drawing'
  const handleSelectionEnd = () => {
    if (confirmationTimerRef.current !== null) {
      window.clearTimeout(confirmationTimerRef.current)
    }
    confirmationTimerRef.current = window.setTimeout(() => {
      confirmationTimerRef.current = null
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
              {useFlowLayout
                ? `${FLOW_LAYOUT_PAGE_WIDTH} × auto`
                : `${page.width} × ${page.height}`}
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
          className={
            useFlowLayout
              ? 'hamster-reader__page-surface hamster-reader__page-surface--flow'
              : 'hamster-reader__page-surface'
          }
          style={
            useFlowLayout
              ? undefined
              : { aspectRatio: `${page.width} / ${page.height}` }
          }
          data-testid={`reader-page-surface-${page.id}`}
        >
          {showSelectionLayer ? (
            <Selection
              ref={selectionRef}
              className={
                useFlowLayout
                  ? 'hamster-reader__selection-layer hamster-reader__selection-layer--flow'
                  : 'hamster-reader__selection-layer'
              }
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
              onUpdateRange={onTextSelectionUpdate}
              onUpdateRect={onRectSelectionUpdate}
              onSelectionEnd={autoConfirm ? handleSelectionEnd : undefined}
              overlayRectType='percent'
              selectionStyle={{ backgroundColor: 'rgba(236, 72, 153, 0.28)' }}
              markerStyle={{ backgroundColor: 'rgba(250, 204, 21, 0.36)' }}
            >
              {textLayer}
            </Selection>
          ) : (
            textLayer
          )}

          <PageDrawingLayer
            enabled={selectedTool === 'drawing'}
            pageId={page.id}
            controllerData={paintingControllerData}
            onControllerDataChange={setPaintingControllerData}
            value={paintingValue}
            onChange={onPaintingChange}
          />
        </div>

        <p className='hamster-reader__page-hint'>{getPageHint(selectedTool)}</p>
      </div>
    </article>
  )
}
