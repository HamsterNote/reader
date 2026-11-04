import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { pdfHighlightFill, pdfRangeClientRects } from '../pdf/pdfSelectionPaint'
import { PdfTouchSelectionHandle } from './PdfTouchSelectionHandle'
import { useRangeMagnifier } from './IntermediateDocumentViewer/RangeMagnifier'

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
  color = '#ffc107',
  paintPreview = true,
  onPreview,
  hitTest
}: {
  readonly pdfTouch?: boolean
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
  const magnifier = useRangeMagnifier()
  const latestRange = useRef(range)
  latestRange.current = range
  const [rects, setRects] = useState<DOMRect[]>([])
  const [dragging, setDragging] = useState(false)
  const previewRange = useRef<{ owner: Range; value: Range } | null>(null)
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
  const popupPointerTarget = useRef<Node | null>(null)
  const drag = useRef<{
    pointer: number
    end: boolean
    original: Range
    current: Range
    valid: boolean
    element: HTMLButtonElement
    offsetX: number
    offsetY: number
  } | null>(null)
  const cancelDrag = useRef<() => void>(() => {})
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
    const move = (event: PointerEvent) => {
      const active = drag.current
      if (!active || active.pointer !== event.pointerId) return
      if (latestRange.current !== range) {
        finish()
        return
      }
      event.preventDefault()
      const clientX = event.clientX + active.offsetX
      const clientY = event.clientY + active.offsetY
      callbacks.current.magnifier?.move({ clientX, clientY })
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
        active.valid = false
        return
      }
      const next = active.original.cloneRange()
      if (active.end) next.setEnd(node, offset)
      else next.setStart(node, offset)
      active.valid = !next.collapsed
      if (!active.valid) return
      active.current = next
      if (pdfTouch) {
        previewRange.current = { owner: range!, value: next }
        setRects(rangeViewportRects(next, true))
        callbacks.current.onPreview?.(next)
      } else {
        const selection = doc.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(next)
      }
    }
    const down = (event: PointerEvent) => {
      if (drag.current && event.pointerId !== drag.current.pointer) finish()
    }
    owner.addEventListener('pointermove', move, {
      capture: true,
      passive: false
    })
    owner.addEventListener('pointerdown', down, true)
    // Range materialization may replace the handle before pointerup.
    owner.addEventListener('pointerup', finish, true)
    owner.addEventListener('pointercancel', finish, true)
    const blur = () => finish()
    owner.defaultView?.addEventListener('blur', blur)
    return () => {
      owner.removeEventListener('pointermove', move, true)
      owner.removeEventListener('pointerdown', down, true)
      owner.removeEventListener('pointerup', finish, true)
      owner.removeEventListener('pointercancel', finish, true)
      owner.defaultView?.removeEventListener('blur', blur)
      finish()
    }
  }, [containerRef, range, pdfTouch])
  useLayoutEffect(() => {
    if (previewRange.current?.owner !== range) previewRange.current = null
    if (!range) {
      setRects([])
      return
    }
    let frame = 0
    const sync = () => {
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
      frame = requestAnimationFrame(sync)
    }
    sync()
    return () => cancelAnimationFrame(frame)
  }, [range, pdfTouch])
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
  const first = visibleRects[0]
  const last = visibleRects.at(-1)
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
  const Handle = pdfTouch ? PdfTouchSelectionHandle : 'button'
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
          .filter((end) =>
            end
              ? showEnd && visible(rects.at(-1)!)
              : showStart && visible(rects[0])
          )
          .map((end) => {
            const type = end ? 'end' : 'start'
            const endpoint = end ? rects.at(-1)! : rects[0]
            const pdfHandleY = end ? endpoint.bottom + 10 : endpoint.top - 10
            return (
              <Handle
                key={String(end)}
                type='button'
                aria-label={handleLabels[type]}
                {...(pdfTouch ? { end, color } : {})}
                className={`hamster-reader__engine-handle${pdfTouch ? ' hamster-reader__pdf-touch-handle' : ''}`}
                style={{
                  position: 'fixed',
                  left:
                    (end ? endpoint.right : endpoint.left) - (pdfTouch ? 0 : 7),
                  top: pdfTouch ? pdfHandleY : endpoint.bottom - 7,
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
                  drag.current = {
                    pointer: event.pointerId,
                    end,
                    original: current.cloneRange(),
                    current: current.cloneRange(),
                    valid: true,
                    element: event.currentTarget,
                    offsetX: pdfTouch
                      ? circle.left + circle.width / 2 - event.clientX
                      : 0,
                    offsetY: pdfTouch
                      ? currentEndpoint.top +
                        currentEndpoint.height / 2 -
                        event.clientY
                      : 0
                  }
                  setDragging(true)
                  onEditingChange(true)
                  if (pdfTouch)
                    callbacks.current.onPreview?.(current.cloneRange())
                  const body =
                    range.startContainer.parentElement?.closest<HTMLElement>(
                      '.pdfViewer .page'
                    ) ?? range.startContainer.ownerDocument?.body
                  if (body)
                    magnifier?.start(body, {
                      clientX: event.clientX,
                      clientY: event.clientY
                    })
                }}
              />
            )
          })}
    </>,
    document.body
  )
}
