import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IntermediateDocumentViewerProps } from './IntermediateDocumentViewer'
import type { ReaderSelectionRectangle } from '../types/selection'
import { PdfPageOverlayLayer } from '../pdf/PdfPageOverlayLayer'
import { edgeCropToClipPath } from '../pdf/pdfOverlayGeometry'
import { EdgeCropOverlay } from './IntermediateDocumentViewer/EdgeCropOverlay'
import { resolvePageEdgeCrop } from './IntermediateDocumentViewer/pageDisplay'

const emptyContexts = new Map()
const ignoreControllerChange = () => {}
const identityViewport = {
  scale: 1,
  convertToPdfPoint: (x: number, y: number) => [x, y],
  convertToViewportPoint: (x: number, y: number) => [x, y]
}

/** Keep reader-owned tools outside the publication iframe, in its document coordinates. */
export function EngineEpubLayoutLayer({
  doc,
  pageElement,
  pageNumber,
  viewer,
  draftRectangle,
  onDraftRect,
  onUpdateRect,
  onSelectRect
}: {
  readonly doc: Document
  readonly pageElement?: HTMLElement | null
  readonly pageNumber: number
  readonly viewer: IntermediateDocumentViewerProps
  readonly draftRectangle: ReaderSelectionRectangle | null
  readonly onDraftRect: (rect: ReaderSelectionRectangle) => void
  readonly onUpdateRect: (rect: ReaderSelectionRectangle) => void
  readonly onSelectRect: (id: string | null) => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const bindLayer = useCallback((node: HTMLDivElement | null) => {
    layer.current = node
    setElement(node)
  }, [])
  const [size, setSize] = useState({ width: 1, height: 1 })
  const hidden = (viewer.hiddenPages ?? []).some(
    (page) => page === pageNumber || page === `page-${pageNumber}`
  )
  const crop = viewer.edgeCropEditing
    ? undefined
    : resolvePageEdgeCrop(viewer.edgeCrop, pageNumber)
  const clip = edgeCropToClipPath(crop) ?? ''
  useEffect(() => {
    let animation = 0
    const frameElement =
      pageElement ?? (doc.defaultView?.frameElement as HTMLElement | null)
    if (!frameElement) return
    const clipTarget = pageElement ?? frameElement.parentElement ?? frameElement
    const previous = clipTarget.style.clipPath
    const update = () => {
      const frame = frameElement.getBoundingClientRect()
      const parent = layer.current?.parentElement?.getBoundingClientRect()
      if (layer.current && parent) {
        Object.assign(layer.current.style, {
          left: `${frame.left - parent.left}px`,
          top: `${frame.top - parent.top}px`,
          width: `${frame.width}px`,
          height: `${frame.height}px`
        })
      }
      setSize((current) =>
        current.width === frame.width && current.height === frame.height
          ? current
          : {
              width: Math.max(1, frame.width),
              height: Math.max(1, frame.height)
            }
      )
      clipTarget.style.clipPath = hidden ? 'inset(100%)' : clip
      animation = requestAnimationFrame(update)
    }
    update()
    return () => {
      cancelAnimationFrame(animation)
      clipTarget.style.clipPath = previous
    }
  }, [doc, pageElement, clip, hidden])
  useEffect(() => {
    if (
      viewer.selectedTool !== 'text-selection' ||
      hidden ||
      viewer.edgeCropEditing
    )
      return
    const target = pageElement ?? doc
    const down = (event: Event) => {
      const pointer = event as PointerEvent
      const origin = pageElement?.getBoundingClientRect()
      const x = pointer.clientX - (origin?.left ?? 0)
      const y = pointer.clientY - (origin?.top ?? 0)
      const hit = viewer.rects?.find((rect) => {
        if (rect.selectionId !== `page-${pageNumber}`) return false
        const scaleX = rect.overlayRectType === 'percent' ? size.width / 100 : 1
        const scaleY =
          rect.overlayRectType === 'percent' ? size.height / 100 : 1
        return (
          x >= rect.rect.x * scaleX &&
          x <= (rect.rect.x + rect.rect.width) * scaleX &&
          y >= rect.rect.y * scaleY &&
          y <= (rect.rect.y + rect.rect.height) * scaleY
        )
      })
      if (hit) onSelectRect(hit.id)
    }
    target.addEventListener('pointerdown', down)
    return () => target.removeEventListener('pointerdown', down)
  }, [
    doc,
    pageElement,
    pageNumber,
    viewer.selectedTool,
    viewer.rects,
    viewer.edgeCropEditing,
    hidden,
    size,
    onSelectRect
  ])
  const geometry = useMemo(() => {
    const viewport = identityViewport
    return { viewport, scaleOneViewport: viewport, visual: size }
  }, [size])
  const pageId = `page-${pageNumber}`
  return (
    <div className='hamster-reader__epub-tools-viewport'>
      <div
        ref={bindLayer}
        className='hamster-reader__epub-tools-page'
        data-engine-page={pageId}
        style={{ clipPath: clip }}
      >
        {hidden ? (
          <div className='hamster-reader__engine-hidden-page'>
            当前 第 {pageNumber} 页 已隐藏
          </div>
        ) : (
          element && (
            <>
              <PdfPageOverlayLayer
                pageNumber={pageNumber}
                pageDiv={element}
                geometry={geometry}
                tool={
                  viewer.edgeCropEditing
                    ? 'text-selection'
                    : (viewer.selectedTool ?? 'text-selection')
                }
                overlayRectType={viewer.overlayRectType ?? 'percent'}
                ranges={[]}
                rects={viewer.rects ?? []}
                painting={viewer.pagePaintings?.[pageId]}
                selectedRectId={viewer.selectedRectId}
                highlightColor={viewer.highlightColor ?? '#ffc107'}
                selectionContexts={emptyContexts}
                paintingControllerData={
                  viewer.paintingControllerData ?? {
                    tool: viewer.paintingTool ?? 'pen',
                    minimap: false,
                    strokeWidth: 3,
                    strokeColor: viewer.drawingStrokeColor ?? '#2563eb'
                  }
                }
                onPaintingControllerDataChange={
                  viewer.onPaintingControllerDataChange ??
                  ignoreControllerChange
                }
                pagePaintings={viewer.pagePaintings ?? {}}
                onPaintingChange={viewer.onPagePaintingChange}
                onSelectRect={onSelectRect}
                draftRectangle={draftRectangle}
                onDraftRect={onDraftRect}
                onUpdateRect={onUpdateRect}
              />
              {viewer.edgeCropEditing && (
                <EdgeCropOverlay
                  pageNumber={pageNumber}
                  edgeCrop={viewer.edgeCrop}
                  onApply={viewer.onEdgeCropApply}
                  onHidePage={viewer.onEdgeCropHidePage}
                />
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}
