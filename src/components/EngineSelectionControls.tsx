import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useRangeMagnifier } from './IntermediateDocumentViewer/RangeMagnifier'

/** Convert iframe-local Range geometry into the outer reader's viewport. */
export function rangeViewportRects(range: Range): DOMRect[] {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
  const offset = frame?.getBoundingClientRect()
  return Array.from(range.getClientRects())
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
  onEditingChange
}: {
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
  const [rects, setRects] = useState<DOMRect[]>([])
  const [dragging, setDragging] = useState(false)
  const popupPointerTarget = useRef<Node | null>(null)
  const drag = useRef<{
    pointer: number
    end: boolean
    original: Range
    current: Range
  } | null>(null)
  const callbacks = useRef({ onUpdate, onEditingChange, magnifier })
  callbacks.current = { onUpdate, onEditingChange, magnifier }
  useEffect(() => {
    const owner = containerRef.current?.ownerDocument
    if (!owner) return
    const finish = (event?: PointerEvent) => {
      const active = drag.current
      if (!active || (event && event.pointerId !== active.pointer)) return
      drag.current = null
      setDragging(false)
      callbacks.current.onEditingChange(false)
      callbacks.current.magnifier?.end()
      if (event?.type === 'pointerup')
        callbacks.current.onUpdate(active.current, active.end)
    }
    // Range materialization may replace the handle before pointerup.
    owner.addEventListener('pointerup', finish, true)
    owner.addEventListener('pointercancel', finish, true)
    const blur = () => finish()
    owner.defaultView?.addEventListener('blur', blur)
    return () => {
      owner.removeEventListener('pointerup', finish, true)
      owner.removeEventListener('pointercancel', finish, true)
      owner.defaultView?.removeEventListener('blur', blur)
      finish()
    }
  }, [containerRef])
  useEffect(() => {
    if (!range) {
      setRects([])
      return
    }
    let frame = 0
    const sync = () => {
      const next = rangeViewportRects(drag.current?.current ?? range)
      setRects((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      )
      frame = requestAnimationFrame(sync)
    }
    sync()
    return () => cancelAnimationFrame(frame)
  }, [range])
  const first = rects[0]
  const last = rects.at(-1)
  if (!range || !first || !last) return null
  const box = containerRef.current?.getBoundingClientRect()
  const x = Math.max(
    box?.left ?? 8,
    Math.min(first.left, (box?.right ?? innerWidth) - 220)
  )
  const y = first.top > 60 ? first.top - 48 : last.bottom + 12
  return createPortal(
    <>
      {!dragging && children && (
        <div
          className='hsn-selection-popover hamster-reader__engine-popover'
          style={{
            position: 'fixed',
            left: x,
            top: y,
            maxWidth: Math.max(120, (box?.width ?? innerWidth) - 16),
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
          .filter((end) => (end ? showEnd : showStart))
          .map((end) => (
            <button
              key={String(end)}
              type='button'
              aria-label={end ? '调整高亮终点' : '调整高亮起点'}
              className='hamster-reader__engine-handle'
              style={{
                position: 'fixed',
                left: (end ? last.right : first.left) - 7,
                top: (end ? last.bottom : first.bottom) - 7,
                zIndex: 10001
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = {
                  pointer: event.pointerId,
                  end,
                  original: range.cloneRange(),
                  current: range.cloneRange()
                }
                setDragging(true)
                onEditingChange(true)
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
              onPointerMove={(event) => {
                const active = drag.current
                if (!active || active.pointer !== event.pointerId) return
                magnifier?.move({
                  clientX: event.clientX,
                  clientY: event.clientY
                })
                const doc = active.original.startContainer.ownerDocument
                if (!doc) return
                const frame =
                  doc.defaultView?.frameElement?.getBoundingClientRect()
                const localX = event.clientX - (frame?.left ?? 0)
                const localY = event.clientY - (frame?.top ?? 0)
                const caretDoc = doc as Document & {
                  caretPositionFromPoint?: (
                    x: number,
                    y: number
                  ) => { offsetNode: Node; offset: number } | null
                  caretRangeFromPoint?: (x: number, y: number) => Range | null
                }
                const position = caretDoc.caretPositionFromPoint?.(
                  localX,
                  localY
                )
                const caret = caretDoc.caretRangeFromPoint?.(localX, localY)
                const node = position?.offsetNode ?? caret?.startContainer
                const offset = position?.offset ?? caret?.startOffset
                if (
                  !node ||
                  offset === undefined ||
                  node.nodeType !== Node.TEXT_NODE
                )
                  return
                const next = active.original.cloneRange()
                if (active.end) next.setEnd(node, offset)
                else next.setStart(node, offset)
                if (next.collapsed) return
                active.current = next
                const selection = doc.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(next)
              }}
              onPointerUp={(event) => {
                const active = drag.current
                if (!active || active.pointer !== event.pointerId) return
                drag.current = null
                setDragging(false)
                onEditingChange(false)
                magnifier?.end()
                onUpdate(active.current, active.end)
              }}
              onPointerCancel={() => {
                const original = drag.current?.original
                if (original) {
                  const selection =
                    original.startContainer.ownerDocument?.getSelection()
                  selection?.removeAllRanges()
                  selection?.addRange(original)
                }
                drag.current = null
                setDragging(false)
                onEditingChange(false)
                magnifier?.end()
              }}
            />
          ))}
    </>,
    document.body
  )
}
