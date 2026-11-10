import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { pdfHighlightFill, pdfRangeClientRects } from '../pdf/pdfSelectionPaint'
import { snapshotPdfRange } from '../pdf/pdfRangeRetention'
import { PdfTouchSelectionHandle } from './PdfTouchSelectionHandle'
import { useRangeMagnifier } from './IntermediateDocumentViewer/RangeMagnifier'
import {
  pdfHandleRange,
  pdfHandleScrollVelocity
} from './selection/pdfHandleDrag'

// The preview lens measured ~7.5px closer to the pointer than PDF Text.
// Lift only its layout anchor; sampling and selection retain their coordinates.
const PDF_MAGNIFIER_LIFT_PX = 8

function magnifierLayoutPoint(
  point: { clientX: number; clientY: number },
  pdfHandles: boolean
) {
  if (!pdfHandles) return point
  return {
    ...point,
    lensPoint: {
      clientX: point.clientX,
      clientY: point.clientY - PDF_MAGNIFIER_LIFT_PX
    }
  }
}

function magnifierPoint(range: Range, end: boolean) {
  const rects = rangeViewportRects(range, true)
  const rect = end ? rects.at(-1) : rects[0]
  return rect
    ? {
        clientX: end ? rect.right : rect.left,
        clientY: rect.top + rect.height / 2
      }
    : null
}

function pdfHandleLogicalEnd(
  drag: { readonly end: boolean; readonly movingEnd: boolean } | null,
  physicalEnd: boolean
) {
  if (!drag) return physicalEnd
  return drag.end === physicalEnd ? drag.movingEnd : !drag.movingEnd
}

function writePdfHandlePositions(
  rects: readonly DOMRect[],
  drag: { readonly end: boolean; readonly movingEnd: boolean } | null,
  elements: Record<'start' | 'end', HTMLButtonElement | null>
) {
  for (const physicalEnd of [false, true]) {
    const end = pdfHandleLogicalEnd(drag, physicalEnd)
    const endpoint = end ? rects.at(-1) : rects[0]
    const element = elements[physicalEnd ? 'end' : 'start']
    if (!endpoint || !element) continue
    element.style.left = `${end ? endpoint.right : endpoint.left}px`
    element.style.top = `${end ? endpoint.bottom + 10 : endpoint.top - 10}px`
    element.style.transform = 'translate(-50%, -50%)'
  }
}

/** Convert iframe-local Range geometry into the outer reader's viewport. */
export function rangeViewportRects(range: Range, pdfTouch = false): DOMRect[] {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
  const offset = frame?.getBoundingClientRect()
  return Array.from(
    pdfTouch ? pdfRangeClientRects(range) : range.getClientRects()
  )
    .filter((rect) => rect.width && rect.height)
    .map(
      (rect) =>
        new DOMRect(
          rect.x + (offset?.x ?? 0),
          rect.y + (offset?.y ?? 0),
          rect.width,
          rect.height
        )
    )
}

export function EngineSelectionControls({
  range,
  containerRef,
  children,
  onUpdate,
  showHandles,
  showStart = true,
  showEnd = true,
  onEditingChange,
  pdfTouch = false,
  pdfCustomHandles = false,
  color = '#ffc107',
  paintPreview = true,
  onPreview,
  hitTest
}: {
  readonly pdfTouch?: boolean
  readonly pdfCustomHandles?: boolean
  readonly color?: string
  readonly paintPreview?: boolean
  readonly onPreview?: (range: Range) => void
  readonly hitTest?: (x: number, y: number) => Range | null
  readonly range: Range | null
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly children: ReactNode
  readonly showHandles: boolean
  readonly showStart?: boolean
  readonly showEnd?: boolean
  readonly onUpdate: (range: Range, end: boolean) => void
  readonly onEditingChange: (editing: boolean) => void
}) {
  const pdfHandles = pdfTouch || pdfCustomHandles
  const magnifier = useRangeMagnifier()
  const latestRange = useRef(range)
  latestRange.current = range
  const recovery = useRef<{ owner: Range; restore: () => boolean } | null>(null)
  if (range && recovery.current?.owner !== range)
    recovery.current = { owner: range, restore: snapshotPdfRange(range) }
  const [rects, setRects] = useState<DOMRect[]>([])
  const [dragging, setDragging] = useState(false)
  const previewRange = useRef<{ owner: Range; value: Range } | null>(null)
  const handleElements = useRef<
    Record<'start' | 'end', HTMLButtonElement | null>
  >({ start: null, end: null })
  const syncedScroll = useRef<{ left: number; top: number } | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [popupSize, setPopupSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = popup.current
    if (!element) return
    const measure = () => {
      const box = element.getBoundingClientRect()
      setPopupSize((previous) =>
        previous.width === box.width && previous.height === box.height
          ? previous
          : { width: box.width, height: box.height }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [children, dragging, rects.length])
  useLayoutEffect(() => {
    if (!pdfHandles) return
    for (const element of Object.values(handleElements.current)) {
      if (element) element.style.transform = 'translate(-50%, -50%)'
    }
    const scroller = containerRef.current?.querySelector<HTMLElement>(
      '.hamster-reader__pdf-viewer-container'
    )
    syncedScroll.current = scroller
      ? { left: scroller.scrollLeft, top: scroller.scrollTop }
      : null
  }, [containerRef, rects, pdfHandles])
  const popupPointerTarget = useRef<Node | null>(null)
  const drag = useRef<{
    pointer: number
    end: boolean
    movingEnd: boolean
    original: Range
    current: Range
    restoreOriginal: () => boolean
    restoreCurrent: () => boolean
    valid: boolean
    element: HTMLButtonElement
    offsetX: number
    offsetY: number
    clientX: number
    clientY: number
  } | null>(null)
  const cancelDrag = useRef<() => void>(() => {})
  const startScroll = useRef<() => void>(() => {})
  const callbacks = useRef({
    onUpdate,
    onEditingChange,
    magnifier,
    onPreview,
    hitTest
  })
  callbacks.current = {
    onUpdate,
    onEditingChange,
    magnifier,
    onPreview,
    hitTest
  }
  useEffect(() => {
    const owner = containerRef.current?.ownerDocument
    if (!owner) return
    let scrollFrame = 0
    let scrollTime = 0
    let scrollRemainder = 0
    const stopScroll = () => {
      cancelAnimationFrame(scrollFrame)
      scrollFrame = 0
      scrollTime = 0
      scrollRemainder = 0
    }
    const replayRelease = (event?: PointerEvent) => {
      if (pdfTouch && event?.type === 'pointerup') move(event)
    }
    const finish = (event?: PointerEvent) => {
      const active = drag.current
      if (!active || (event && event.pointerId !== active.pointer)) return
      // The release can contain a newer point than the last pointermove.
      replayRelease(event)
      if (drag.current !== active) return
      drag.current = null
      stopScroll()
      delete containerRef.current?.dataset.pdfHandleDragging
      if (active.element.hasPointerCapture?.(active.pointer))
        active.element.releasePointerCapture(active.pointer)
      setDragging(false)
      callbacks.current.onEditingChange(false)
      callbacks.current.magnifier?.end()
      if (
        event?.type === 'pointerup' &&
        active.valid &&
        active.current.startContainer.isConnected &&
        active.current.endContainer.isConnected &&
        active.current.startContainer.nodeType === Node.TEXT_NODE &&
        active.current.endContainer.nodeType === Node.TEXT_NODE &&
        latestRange.current === range
      ) {
        if (
          active.current.compareBoundaryPoints(
            Range.START_TO_START,
            active.original
          ) ||
          active.current.compareBoundaryPoints(
            Range.END_TO_END,
            active.original
          )
        )
          callbacks.current.onUpdate(active.current, active.end)
      } else if (
        latestRange.current === range &&
        active.original.startContainer.isConnected &&
        active.original.endContainer.isConnected &&
        active.original.startContainer.nodeType === Node.TEXT_NODE &&
        active.original.endContainer.nodeType === Node.TEXT_NODE
      ) {
        if (pdfTouch) {
          previewRange.current = { owner: range!, value: active.original }
          setRects(rangeViewportRects(active.original, true))
          callbacks.current.onPreview?.(active.original)
        } else {
          const selection =
            active.original.startContainer.ownerDocument?.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(active.original)
        }
      }
    }
    cancelDrag.current = () => finish()
    const publish = (
      active: NonNullable<typeof drag.current>,
      next: Range,
      doc: Document
    ) => {
      if (pdfTouch) {
        previewRange.current = { owner: range!, value: next }
        setRects(rangeViewportRects(next, true))
        callbacks.current.onPreview?.(next)
        const point = magnifierPoint(next, active.movingEnd)
        if (point)
          callbacks.current.magnifier?.move(magnifierLayoutPoint(point, true), {
            range: next,
            end: active.movingEnd,
            color
          })
      } else {
        const selection = doc.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(next)
      }
    }
    const update = (active: NonNullable<typeof drag.current>) => {
      if (pdfTouch) {
        active.restoreOriginal()
        active.restoreCurrent()
      }
      const clientX = active.clientX + active.offsetX
      const clientY = active.clientY + active.offsetY
      if (!pdfTouch)
        callbacks.current.magnifier?.move(
          magnifierLayoutPoint({ clientX, clientY }, pdfHandles)
        )
      const doc = active.original.startContainer.ownerDocument
      if (
        !doc ||
        !active.original.startContainer.isConnected ||
        !active.original.endContainer.isConnected
      ) {
        finish()
        return
      }
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
      const localX = clientX - (frame?.left ?? 0)
      const localY = clientY - (frame?.top ?? 0)
      const caretDoc = doc as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number
        ) => { offsetNode: Node; offset: number } | null
        caretRangeFromPoint?: (x: number, y: number) => Range | null
      }
      const position = pdfTouch
        ? null
        : caretDoc.caretPositionFromPoint?.(localX, localY)
      const caret = pdfTouch
        ? callbacks.current.hitTest?.(localX, localY)
        : caretDoc.caretRangeFromPoint?.(localX, localY)
      const node = position?.offsetNode ?? caret?.startContainer
      const offset = position?.offset ?? caret?.startOffset
      if (!node || offset === undefined || node.nodeType !== Node.TEXT_NODE) {
        // Page gaps and pending text layers retain the last valid PDF range.
        if (!pdfTouch) active.valid = false
        return
      }
      let next = active.original.cloneRange()
      if (pdfTouch && caret) {
        const result = pdfHandleRange(active.original, active.end, caret)
        next = result.range
        active.movingEnd = result.end
      } else if (active.end) next.setEnd(node, offset)
      else next.setStart(node, offset)
      if (next.collapsed) {
        if (!pdfTouch) active.valid = false
        return
      }
      active.valid = true
      active.current = next
      active.restoreCurrent = snapshotPdfRange(next)
      publish(active, next, doc)
    }
    const autoScroll = (time: number) => {
      scrollFrame = 0
      const active = drag.current
      const root = containerRef.current
      const scroller = root?.querySelector<HTMLElement>(
        '.hamster-reader__pdf-viewer-container'
      )
      if (!active || !scroller || !root) return
      if (latestRange.current !== range) {
        finish()
        return
      }
      const box = scroller.getBoundingClientRect()
      const velocity = pdfHandleScrollVelocity(
        active.clientY,
        Math.max(0, box.top),
        Math.min(innerHeight, box.bottom)
      )
      const dt = scrollTime ? Math.min(32, time - scrollTime) : 16
      scrollTime = time
      // Some WebViews round each scrollTop assignment to whole CSS pixels.
      // Accumulate fractions so the slow end of the edge band still moves.
      scrollRemainder = velocity ? scrollRemainder + (velocity * dt) / 1000 : 0
      const pixels = Math.trunc(scrollRemainder)
      scroller.scrollTop += pixels
      scrollRemainder -= pixels
      // Hit-test after scrolling even when the finger hasn't moved, including
      // after PDF.js has asynchronously materialized the next text layer.
      update(active)
      if (drag.current === active)
        scrollFrame = requestAnimationFrame(autoScroll)
    }
    startScroll.current = () => {
      if (pdfTouch && !scrollFrame)
        scrollFrame = requestAnimationFrame(autoScroll)
    }
    const move = (event: PointerEvent) => {
      const active = drag.current
      if (!active || active.pointer !== event.pointerId) return
      if (latestRange.current !== range) {
        finish()
        return
      }
      event.preventDefault()
      active.clientX = event.clientX
      active.clientY = event.clientY
      update(active)
      if (pdfTouch && drag.current === active && !scrollFrame)
        scrollFrame = requestAnimationFrame(autoScroll)
    }
    const down = (event: PointerEvent) => {
      if (drag.current && event.pointerId !== drag.current.pointer) finish()
    }
    const scroller = containerRef.current?.querySelector<HTMLElement>(
      '.hamster-reader__pdf-viewer-container'
    )
    syncedScroll.current = scroller
      ? { left: scroller.scrollLeft, top: scroller.scrollTop }
      : null
    const followScroll = (event: Event) => {
      if (!pdfHandles || !scroller || event.target !== scroller) return
      const previous = syncedScroll.current
      if (!previous) return
      const offsetX = previous.left - scroller.scrollLeft
      const offsetY = previous.top - scroller.scrollTop
      for (const element of Object.values(handleElements.current)) {
        if (element)
          element.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`
      }
      const current =
        previewRange.current?.value ?? drag.current?.current ?? range
      if (current) setRects(rangeViewportRects(current, pdfTouch))
    }
    owner.addEventListener('pointermove', move, {
      capture: true,
      passive: false
    })
    owner.addEventListener('pointerdown', down, true)
    owner.addEventListener('scroll', followScroll, true)
    // Range materialization may replace the handle before pointerup.
    owner.addEventListener('pointerup', finish, true)
    owner.addEventListener('pointercancel', finish, true)
    const blur = () => finish()
    owner.defaultView?.addEventListener('blur', blur)
    return () => {
      owner.removeEventListener('pointermove', move, true)
      owner.removeEventListener('pointerdown', down, true)
      owner.removeEventListener('scroll', followScroll, true)
      owner.removeEventListener('pointerup', finish, true)
      owner.removeEventListener('pointercancel', finish, true)
      owner.defaultView?.removeEventListener('blur', blur)
      finish()
      stopScroll()
    }
  }, [containerRef, range, pdfTouch, pdfHandles, color])
  useLayoutEffect(() => {
    if (previewRange.current?.owner !== range) previewRange.current = null
    if (!range) {
      setRects([])
      return
    }
    let frame = 0
    const sync = () => {
      if (pdfTouch) {
        recovery.current?.restore()
        drag.current?.restoreOriginal()
        drag.current?.restoreCurrent()
      }
      if (
        drag.current &&
        (range.startContainer.nodeType !== Node.TEXT_NODE ||
          range.endContainer.nodeType !== Node.TEXT_NODE ||
          !range.startContainer.isConnected ||
          !range.endContainer.isConnected)
      )
        cancelDrag.current()
      const next = range.startContainer.isConnected
        ? rangeViewportRects(
            previewRange.current?.value ?? drag.current?.current ?? range,
            pdfTouch
          )
        : []
      setRects((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      )
      if (pdfHandles)
        writePdfHandlePositions(next, drag.current, handleElements.current)
      frame = requestAnimationFrame(sync)
    }
    sync()
    return () => cancelAnimationFrame(frame)
  }, [range, pdfTouch, pdfHandles])
  const box = containerRef.current?.getBoundingClientRect()
  const left = Math.max(8, box?.left ?? 8)
  const right = Math.min(innerWidth - 8, box?.right ?? innerWidth - 8)
  const top = Math.max(8, box?.top ?? 8)
  const bottom = Math.min(innerHeight - 8, box?.bottom ?? innerHeight - 8)
  const visible = (rect: DOMRect) =>
    rect.right > left &&
    rect.left < right &&
    rect.bottom > top &&
    rect.top < bottom
  const visibleRects = rects.filter(visible)
  const first = visibleRects[0] ?? (dragging ? rects[0] : undefined)
  const last = visibleRects.at(-1) ?? (dragging ? rects.at(-1) : undefined)
  if (!range || !first || !last) return null
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  const x = Math.max(left, Math.min(first.left, right - popupSize.width))
  const popupGap = pdfTouch ? 32 : 12
  const above = first.top - popupSize.height - popupGap
  const y = Math.max(
    top,
    Math.min(
      above >= top ? above : last.bottom + popupGap,
      bottom - popupSize.height
    )
  )
  const Handle = pdfHandles ? PdfTouchSelectionHandle : 'button'
  const handleLabels = pdfTouch
    ? { start: '拖动以调整选区起点', end: '拖动以调整选区终点' }
    : { start: '调整高亮起点', end: '调整高亮终点' }
  return createPortal(
    <>
      {pdfTouch && paintPreview && (
        <svg
          className='hamster-reader__pdf-selection-preview'
          aria-hidden='true'
          style={{
            position: 'fixed',
            left,
            top,
            width,
            height,
            pointerEvents: 'none',
            zIndex: 9998
          }}
        >
          <path
            fill={pdfHighlightFill(color)}
            fillRule='nonzero'
            d={visibleRects
              .map(
                (rect) =>
                  `M${rect.left - left} ${rect.top - top}h${rect.width}v${rect.height}h${-rect.width}Z`
              )
              .join('')}
          />
        </svg>
      )}
      {!dragging && children && (
        <div
          ref={popup}
          className='hsn-selection-popover hamster-reader__engine-popover'
          data-pdf-touch={pdfTouch ? 'true' : undefined}
          style={{
            position: 'fixed',
            left: x,
            top: y,
            maxWidth: width,
            maxHeight: height,
            overflow: 'auto',
            boxSizing: 'border-box',
            transform: 'none',
            margin: 0,
            zIndex: 10000
          }}
          onPointerDownCapture={(event) => {
            popupPointerTarget.current = event.target as Node
          }}
          onClickCapture={(event) => {
            // Touch confirmation can replace its button before the synthesized click.
            if (
              popupPointerTarget.current &&
              !popupPointerTarget.current.isConnected
            ) {
              event.preventDefault()
              event.stopPropagation()
            }
            popupPointerTarget.current = null
          }}
          onPointerDown={(event) => event.preventDefault()}
        >
          {children}
        </div>
      )}
      {showHandles &&
        [false, true]
          .filter((physicalEnd) => {
            if (drag.current?.end === physicalEnd) return true
            const end = drag.current ? !drag.current.movingEnd : physicalEnd
            return end
              ? showEnd && visible(rects.at(-1)!)
              : showStart && visible(rects[0])
          })
          .map((physicalEnd) => {
            let end = physicalEnd
            if (drag.current)
              end =
                drag.current.end === physicalEnd
                  ? drag.current.movingEnd
                  : !drag.current.movingEnd
            const type = end ? 'end' : 'start'
            const endpoint = end ? rects.at(-1)! : rects[0]
            const pdfHandleY = end ? endpoint.bottom + 10 : endpoint.top - 10
            return (
              <Handle
                key={String(physicalEnd)}
                ref={(element) => {
                  handleElements.current[physicalEnd ? 'end' : 'start'] =
                    element
                }}
                type='button'
                aria-label={handleLabels[type]}
                {...(pdfHandles
                  ? { end, color, lineHeight: endpoint.height }
                  : {})}
                className={`hamster-reader__engine-handle${pdfHandles ? ' hamster-reader__pdf-touch-handle' : ''}`}
                style={{
                  position: 'fixed',
                  left:
                    (end ? endpoint.right : endpoint.left) -
                    (pdfHandles ? 0 : 7),
                  top: pdfHandles ? pdfHandleY : endpoint.bottom - 7,
                  zIndex: 10001
                }}
                onLostPointerCapture={() => cancelDrag.current()}
                onContextMenu={(event) => {
                  if (pdfTouch) event.preventDefault()
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === 'touch' && !pdfTouch) return
                  if (drag.current || event.button > 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  // Re-measure from the same Range used for the current preview.
                  const current = previewRange.current?.value ?? range
                  const currentRects = rangeViewportRects(current, pdfTouch)
                  const currentEndpoint = end
                    ? currentRects.at(-1)!
                    : currentRects[0]
                  if (!currentEndpoint) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  const circle = event.currentTarget.getBoundingClientRect()
                  const original = current.cloneRange()
                  const initial = current.cloneRange()
                  drag.current = {
                    pointer: event.pointerId,
                    end,
                    movingEnd: end,
                    original,
                    current: initial,
                    restoreOriginal: snapshotPdfRange(original),
                    restoreCurrent: snapshotPdfRange(initial),
                    valid: true,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    element: event.currentTarget,
                    offsetX: pdfHandles
                      ? circle.left + circle.width / 2 - event.clientX
                      : 0,
                    offsetY: pdfHandles
                      ? currentEndpoint.top +
                        currentEndpoint.height / 2 -
                        event.clientY
                      : 0
                  }
                  setDragging(true)
                  if (pdfTouch && containerRef.current)
                    containerRef.current.dataset.pdfHandleDragging = 'true'
                  onEditingChange(true)
                  if (pdfTouch)
                    callbacks.current.onPreview?.(current.cloneRange())
                  const body =
                    range.startContainer.parentElement?.closest<HTMLElement>(
                      '.pdfViewer .page'
                    ) ?? range.startContainer.ownerDocument?.body
                  if (body) {
                    const point = pdfHandles
                      ? magnifierPoint(current, end)
                      : null
                    magnifier?.start(
                      body,
                      magnifierLayoutPoint(
                        point ?? {
                          clientX: event.clientX,
                          clientY: event.clientY
                        },
                        pdfHandles
                      ),
                      pdfTouch ? { range: current, end, color } : undefined
                    )
                  }
                  startScroll.current()
                }}
              />
            )
          })}
    </>,
    document.body
  )
}
