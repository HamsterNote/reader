// HAM-89 / tasks.md 3.3/3.4：reader 高亮/矩形/绘图叠加层，portal 进官方
// viewer 的 page div，随 viewport 投影。叠加容器 pointer-events:none +
// 程序化命中检测，原生选区不被拦截；页面回收后 textlayerrendered 触发
// 重挂载，按持久化数据重建（回页恢复）。

import { mergePdfLineRects, pdfHighlightFill } from './pdfSelectionPaint'

import type {
  EditorDocument,
  LayeredToolsSnapshot,
  PageGeometry
} from '@hamster-note/painting/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../types/selection'
import { PageDrawingLayer } from '../components/PageDrawingLayer'
import { PdfRectangleAnnotation } from './PdfRectangleAnnotation'
import type {
  OverlayRectUnit,
  PageVisualSize,
  OverlayViewport
} from './pdfOverlayGeometry'
import { projectStoredRectToViewport } from './pdfOverlayGeometry'
import { captureViewportRectAsStored } from './pdfOverlayGeometry'
import { deriveRectsForCanonicalRange } from './pdfSelectionSerializer'
import type { PdfPageSelectionContext } from './pdfSelectionSerializer'
import { getSelectionGroup } from '../components/selection/selectionGroups'

export type PdfPageOverlayGeometry = {
  readonly viewport: OverlayViewport
  readonly scaleOneViewport: OverlayViewport
  readonly visual: PageVisualSize
  readonly drawing: PageGeometry | null
}

export type PdfPageOverlayLayerProps = {
  readonly pageNumber: number
  readonly pageDiv: HTMLElement
  readonly geometry: PdfPageOverlayGeometry
  readonly tool: 'text-selection' | 'rect-selection' | 'drawing'
  readonly overlayRectType: OverlayRectUnit
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
  readonly painting: EditorDocument | undefined
  readonly selectedRangeId?: string | null
  readonly selectedRectId?: string | null
  readonly highlightColor: string
  readonly selectionContexts: ReadonlyMap<number, PdfPageSelectionContext>
  readonly paintingSettings: LayeredToolsSnapshot
  readonly onPaintingSettingsChange: (data: LayeredToolsSnapshot) => void
  readonly onPaintingChange?: (
    pageId: string,
    nextValue: EditorDocument,
    nextPaintings: Record<string, EditorDocument>
  ) => void
  readonly pagePaintings: Record<string, EditorDocument>
  readonly onSelectRange?: (id: string | null) => void
  readonly onSelectRect?: (id: string | null) => void
  readonly onCreateRect?: (rect: ReaderSelectionRectangle) => void
  readonly onDraftRect?: (rect: ReaderSelectionRectangle) => void
  readonly draftRectangle?: ReaderSelectionRectangle | null
  readonly onUpdateRect?: (rect: ReaderSelectionRectangle) => void
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
  paintingSettings,
  onPaintingChange,
  pagePaintings,
  onSelectRange,
  onSelectRect,
  onCreateRect,
  onDraftRect,
  draftRectangle,
  onUpdateRect
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
  const selectedGroup = getSelectionGroup(ranges, selectedRangeId)
  const selectedGroupIds = new Set(selectedGroup.map((range) => range.id))

  // Annotation hits take priority over rectangle creation. In text mode the
  // event continues to the native text layer so drag selection still works.
  useEffect(() => {
    if (tool === 'drawing') return
    if (!onSelectRange && !onSelectRect) return

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      // Let the handle's React gesture receive the event at the root.
      if (
        event.target instanceof Element &&
        event.target.closest('.hamster-reader__engine-handle')
      )
        return
      const select = (
        callback: ((id: string | null) => void) | undefined,
        id: string
      ) => {
        // Keep the materialized range while clicking an existing annotation.
        // Otherwise the native pointer default collapses it after activation.
        event.preventDefault()
        callback?.(id)
        if (tool === 'rect-selection') {
          // Stop before the portal's delegated React rectangle gesture handler.
          event.stopPropagation()
        }
      }
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
          select(onSelectRange, range.id)
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
          select(onSelectRect, rect.id)
          return
        }
      }
    }

    pageDiv.addEventListener('pointerdown', handlePointerDown, true)
    return () =>
      pageDiv.removeEventListener('pointerdown', handlePointerDown, true)
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

    const emit = onDraftRect ?? onCreateRect
    emit?.({
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
    ? (nextValue: EditorDocument) => {
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
      onPointerCancel={() => setRectDraft(null)}
      style={{
        pointerEvents:
          tool === 'rect-selection' || tool === 'drawing' ? 'auto' : 'none'
      }}
    >
      {pageRanges.flatMap((range) => {
        // Old saved boxes can include font/element boxes taller than the PDF line.
        // Recompute from canonical anchors when the text layer is available.
        const derived = deriveRectsForCanonicalRange(
          range.start,
          range.end,
          selectionContexts,
          overlayRectType
        )[pageId]
        const storedRects = derived?.length
          ? derived
          : (range.rectsBySelectionId?.[pageId] ?? [])
        const projectedRects = mergePdfLineRects(
          storedRects.map((stored) =>
            projectStoredRectToViewport(
              stored,
              derived?.length
                ? overlayRectType
                : (range.overlayRectType ?? overlayRectType),
              geometry.scaleOneViewport,
              geometry.viewport,
              geometry.visual
            )
          )
        )
        if (projectedRects.length === 0) return null
        const left = Math.min(...projectedRects.map((rect) => rect.left))
        const top = Math.min(...projectedRects.map((rect) => rect.top))
        const right = Math.max(
          ...projectedRects.map((rect) => rect.left + rect.width)
        )
        const bottom = Math.max(
          ...projectedRects.map((rect) => rect.top + rect.height)
        )
        const width = right - left
        const height = bottom - top
        // Same-winding subpaths with nonzero fill paint overlaps once. Keep
        // stored rectangles unchanged for hit testing and cross-mode anchors.
        const path = projectedRects
          .map(
            (rect) =>
              `M${rect.left - left} ${rect.top - top}h${rect.width}v${rect.height}h${-rect.width}Z`
          )
          .join('')
        const selectedClass =
          selectedGroup.length > 1
            ? ' hamster-reader__pdf-highlight-rect--group-selected'
            : ' hamster-reader__pdf-highlight-rect--selected'
        return (
          <svg
            key={range.id}
            className={`hamster-reader__pdf-highlight-rect${
              selectedGroupIds.has(range.id) ? selectedClass : ''
            }`}
            data-range-id={range.id}
            data-selected={selectedGroupIds.has(range.id) ? 'true' : undefined}
            style={{ left, top, width, height }}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
          >
            <path
              d={path}
              fillRule='nonzero'
              fill={pdfHighlightFill(
                range.markerStyle?.backgroundColor ?? highlightColor
              )}
            />
          </svg>
        )
      })}

      {[
        ...pageRects,
        ...(draftRectangle?.selectionId === pageId ? [draftRectangle] : [])
      ].map((rect) => (
        <PdfRectangleAnnotation
          key={rect.id}
          rectangle={rect}
          selected={
            selectedRectId === rect.id || draftRectangle?.id === rect.id
          }
          pageDiv={pageDiv}
          geometry={geometry}
          highlightColor={highlightColor}
          onUpdate={onUpdateRect}
        />
      ))}

      {rectDraft && (
        <div
          className='hamster-reader__pdf-rect-draft'
          style={{
            left: Math.min(rectDraft.startX, rectDraft.currentX),
            top: Math.min(rectDraft.startY, rectDraft.currentY),
            width: Math.abs(rectDraft.currentX - rectDraft.startX),
            height: Math.abs(rectDraft.currentY - rectDraft.startY),
            borderColor: highlightColor
          }}
        />
      )}

      {(painting !== undefined || tool === 'drawing') && (
        <PageDrawingLayer
          enabled={tool === 'drawing'}
          pageId={pageId}
          settings={paintingSettings}
          value={painting}
          onChange={handlePaintingChange}
          geometry={geometry.drawing}
        />
      )}
    </div>
  )
}
