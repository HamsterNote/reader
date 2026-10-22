// HAM-89 / tasks.md 3.3/3.4：reader 高亮/矩形/绘图叠加层，portal 进官方
// viewer 的 page div，随 viewport 投影。叠加容器 pointer-events:none +
// 程序化命中检测，原生选区不被拦截；页面回收后 textlayerrendered 触发
// 重挂载，按持久化数据重建（回页恢复）。

import type {
  DrawingValue,
  PaintingControllerData
} from '@hamster-note/painting'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../types/selection'
import { PageDrawingLayer } from '../components/PageDrawingLayer'
import type { OverlayRectUnit, PageVisualSize } from './pdfOverlayGeometry'
import { projectStoredRectToViewport } from './pdfOverlayGeometry'
import { captureViewportRectAsStored } from './pdfOverlayGeometry'
import type { PageViewport } from './pdfjsRuntime'
import { deriveRectsForCanonicalRange } from './pdfSelectionSerializer'
import type { PdfPageSelectionContext } from './pdfSelectionSerializer'

export type PdfPageOverlayGeometry = {
  readonly viewport: PageViewport
  readonly scaleOneViewport: PageViewport
  readonly visual: PageVisualSize
}

export type PdfPageOverlayLayerProps = {
  readonly pageNumber: number
  readonly pageDiv: HTMLElement
  readonly geometry: PdfPageOverlayGeometry
  readonly tool: 'text-selection' | 'rect-selection' | 'drawing'
  readonly overlayRectType: OverlayRectUnit
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
  readonly painting: DrawingValue | undefined
  readonly selectedRangeId?: string | null
  readonly selectedRectId?: string | null
  readonly highlightColor: string
  readonly selectionContexts: ReadonlyMap<number, PdfPageSelectionContext>
  readonly paintingControllerData: PaintingControllerData
  readonly onPaintingControllerDataChange: (
    data: PaintingControllerData
  ) => void
  readonly onPaintingChange?: (
    pageId: string,
    nextValue: DrawingValue,
    nextPaintings: Record<string, DrawingValue>
  ) => void
  readonly pagePaintings: Record<string, DrawingValue>
  readonly onSelectRange?: (id: string | null) => void
  readonly onSelectRect?: (id: string | null) => void
  readonly onCreateRect?: (rect: ReaderSelectionRectangle) => void
}

type RectDraft = {
  readonly startX: number
  readonly startY: number
  readonly currentX: number
  readonly currentY: number
}

const RECT_DRAG_TOLERANCE_PX = 4

let rectIdCounter = 0
const nextRectId = (): string => {
  rectIdCounter += 1
  return `pdf-rect-${Date.now().toString(36)}-${rectIdCounter}`
}

export function PdfPageOverlayLayer({
  pageNumber,
  pageDiv,
  geometry,
  tool,
  overlayRectType,
  ranges,
  rects,
  painting,
  selectedRangeId,
  selectedRectId,
  highlightColor,
  selectionContexts,
  paintingControllerData,
  onPaintingControllerDataChange,
  onPaintingChange,
  pagePaintings,
  onSelectRange,
  onSelectRect,
  onCreateRect
}: PdfPageOverlayLayerProps) {
  const pageId = `page-${pageNumber}`
  const [rectDraft, setRectDraft] = useState<RectDraft | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const pageRanges = ranges.filter((range) => {
    const ids = [
      range.start.selectionId,
      range.end.selectionId,
      ...Object.keys(range.rectsBySelectionId ?? {})
    ]
    return ids.includes(pageId)
  })
  const pageRects = rects.filter((rect) => rect.selectionId === pageId)

  // 高亮/矩形命中检测：挂在 pageDiv 捕获阶段，overlay 自身不收指针事件，
  // 文本选择手势永远直达 text layer（契约：原生选区不被拦截）。
  useEffect(() => {
    if (tool !== 'text-selection') return
    if (!onSelectRange && !onSelectRect) return

    const handlePointerDown = (event: PointerEvent) => {
      const pageBox = pageDiv.getBoundingClientRect()
      const point = {
        left: event.clientX - pageBox.left,
        top: event.clientY - pageBox.top
      }

      for (const range of pageRanges) {
        const storedRects =
          range.rectsBySelectionId?.[pageId] ??
          deriveRectsForCanonicalRange(
            range.start,
            range.end,
            selectionContexts,
            overlayRectType
          )[pageId] ??
          []
        const hit = storedRects.some((stored) => {
          const projected = projectStoredRectToViewport(
            stored,
            range.overlayRectType ?? overlayRectType,
            geometry.scaleOneViewport,
            geometry.viewport,
            geometry.visual
          )
          return (
            point.left >= projected.left &&
            point.left <= projected.left + projected.width &&
            point.top >= projected.top &&
            point.top <= projected.top + projected.height
          )
        })
        if (hit) {
          onSelectRange?.(range.id)
          return
        }
      }

      for (const rect of pageRects) {
        const projected = projectStoredRectToViewport(
          rect.rect,
          rect.overlayRectType,
          geometry.scaleOneViewport,
          geometry.viewport,
          geometry.visual
        )
        if (
          point.left >= projected.left &&
          point.left <= projected.left + projected.width &&
          point.top >= projected.top &&
          point.top <= projected.top + projected.height
        ) {
          onSelectRect?.(rect.id)
          return
        }
      }
    }

    pageDiv.addEventListener('pointerdown', handlePointerDown)
    return () => pageDiv.removeEventListener('pointerdown', handlePointerDown)
  }, [
    tool,
    pageDiv,
    pageRanges,
    pageRects,
    pageId,
    geometry,
    overlayRectType,
    selectionContexts,
    onSelectRange,
    onSelectRect
  ])

  const toPagePoint = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pageBox = pageDiv.getBoundingClientRect()
      return {
        x: event.clientX - pageBox.left,
        y: event.clientY - pageBox.top
      }
    },
    [pageDiv]
  )

  const handleRectPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'rect-selection' || event.button !== 0) return
    const point = toPagePoint(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    setRectDraft({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    })
    event.preventDefault()
  }

  const handleRectPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rectDraft) return
    const point = toPagePoint(event)
    setRectDraft({ ...rectDraft, currentX: point.x, currentY: point.y })
  }

  const handleRectPointerUp = () => {
    if (!rectDraft) return
    setRectDraft(null)

    const width = Math.abs(rectDraft.currentX - rectDraft.startX)
    const height = Math.abs(rectDraft.currentY - rectDraft.startY)
    if (width < RECT_DRAG_TOLERANCE_PX || height < RECT_DRAG_TOLERANCE_PX) {
      return
    }

    const capture = (x: number, y: number) =>
      captureViewportRectAsStored(
        { left: x, top: y, width: 0, height: 0 },
        geometry.viewport,
        geometry.scaleOneViewport,
        overlayRectType,
        geometry.visual
      )
    const start = capture(rectDraft.startX, rectDraft.startY)
    const end = capture(rectDraft.currentX, rectDraft.currentY)
    const rect = captureViewportRectAsStored(
      {
        left: Math.min(rectDraft.startX, rectDraft.currentX),
        top: Math.min(rectDraft.startY, rectDraft.currentY),
        width,
        height
      },
      geometry.viewport,
      geometry.scaleOneViewport,
      overlayRectType,
      geometry.visual
    )

    onCreateRect?.({
      id: nextRectId(),
      createdAt: Date.now(),
      overlayRectType,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      rect,
      selectionId: pageId
    })
  }

  const handlePaintingChange = onPaintingChange
    ? (nextValue: DrawingValue) => {
        onPaintingChange(pageId, nextValue, {
          ...pagePaintings,
          [pageId]: nextValue
        })
      }
    : undefined

  return (
    <div
      ref={overlayRef}
      className='hamster-reader__pdf-overlay'
      data-testid={`pdf-overlay-${pageId}`}
      onPointerDown={
        tool === 'rect-selection' ? handleRectPointerDown : undefined
      }
      onPointerMove={
        tool === 'rect-selection' ? handleRectPointerMove : undefined
      }
      onPointerUp={tool === 'rect-selection' ? handleRectPointerUp : undefined}
      style={{
        pointerEvents:
          tool === 'rect-selection' || tool === 'drawing' ? 'auto' : 'none'
      }}
    >
      {pageRanges.flatMap((range) => {
        const storedRects =
          range.rectsBySelectionId?.[pageId] ??
          deriveRectsForCanonicalRange(
            range.start,
            range.end,
            selectionContexts,
            overlayRectType
          )[pageId] ??
          []
        return storedRects.map((stored, index) => {
          const projected = projectStoredRectToViewport(
            stored,
            range.overlayRectType ?? overlayRectType,
            geometry.scaleOneViewport,
            geometry.viewport,
            geometry.visual
          )
          return (
            <div
              key={`${range.id}-${index}`}
              className={`hamster-reader__pdf-highlight-rect${
                selectedRangeId === range.id
                  ? ' hamster-reader__pdf-highlight-rect--selected'
                  : ''
              }`}
              data-range-id={range.id}
              style={{
                left: projected.left,
                top: projected.top,
                width: projected.width,
                height: projected.height,
                backgroundColor:
                  range.markerStyle?.backgroundColor ?? highlightColor
              }}
            />
          )
        })
      })}

      {pageRects.map((rect) => {
        const projected = projectStoredRectToViewport(
          rect.rect,
          rect.overlayRectType,
          geometry.scaleOneViewport,
          geometry.viewport,
          geometry.visual
        )
        const borderColor =
          typeof rect.selectionStyle?.borderColor === 'string'
            ? rect.selectionStyle.borderColor
            : 'rgba(25, 118, 210, 0.9)'
        return (
          <div
            key={rect.id}
            className={`hamster-reader__pdf-rect-annotation${
              selectedRectId === rect.id
                ? ' hamster-reader__pdf-rect-annotation--selected'
                : ''
            }`}
            data-rect-id={rect.id}
            style={{
              left: projected.left,
              top: projected.top,
              width: projected.width,
              height: projected.height,
              borderColor
            }}
          />
        )
      })}

      {rectDraft && (
        <div
          className='hamster-reader__pdf-rect-draft'
          style={{
            left: Math.min(rectDraft.startX, rectDraft.currentX),
            top: Math.min(rectDraft.startY, rectDraft.currentY),
            width: Math.abs(rectDraft.currentX - rectDraft.startX),
            height: Math.abs(rectDraft.currentY - rectDraft.startY)
          }}
        />
      )}

      {(painting !== undefined || tool === 'drawing') && (
        <PageDrawingLayer
          enabled={tool === 'drawing'}
          pageId={pageId}
          controllerData={paintingControllerData}
          onControllerDataChange={onPaintingControllerDataChange}
          value={painting}
          onChange={handlePaintingChange}
          canvasScale={geometry.viewport.scale}
          cancelDrawingOnMultiTouch
        />
      )}
    </div>
  )
}
