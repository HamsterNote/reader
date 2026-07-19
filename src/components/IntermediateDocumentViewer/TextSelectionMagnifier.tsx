import { useEffect, useRef } from 'react'

import { isSelectionPointerMoveTextHit } from '../selection/selectionPointerGuard'
import {
  type MagnifierPoint,
  useRangeMagnifier
} from './RangeMagnifier'

interface ActiveTextHandleDrag {
  readonly pointerId: number
  readonly offsetX: number
  readonly offsetY: number
}

interface TextSelectionMagnifierProps {
  readonly viewerRootElement: HTMLElement | null
}

/**
 * 文字选区 handle 会在 active range 开始拖动后立即被 selection 层替换。
 * 因此放大镜会话由稳定的 viewer/document 持有，而不是由 handle 组件持有。
 */
export const TextSelectionMagnifier = ({
  viewerRootElement
}: TextSelectionMagnifierProps) => {
  const magnifier = useRangeMagnifier()
  const activeDragRef = useRef<ActiveTextHandleDrag | null>(null)

  useEffect(() => {
    if (!magnifier || !viewerRootElement) return

    const ownerDocument = viewerRootElement.ownerDocument
    const finishDrag = () => {
      if (!activeDragRef.current) return
      activeDragRef.current = null
      magnifier.end()
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      const handle =
        target instanceof Element
          ? target.closest<HTMLElement>('.hsn-selection-handle')
          : null
      if (
        !handle ||
        handle.classList.contains('hsn-selection-handle-rect') ||
        !viewerRootElement.contains(handle)
      ) {
        return
      }

      finishDrag()
      const rect = handle.getBoundingClientRect()
      const offsetX = rect.left + rect.width / 2 - event.clientX
      const offsetY = rect.top + rect.height / 2 - event.clientY
      activeDragRef.current = { pointerId: event.pointerId, offsetX, offsetY }
      magnifier.start(handle, {
        clientX: event.clientX + offsetX,
        clientY: event.clientY + offsetY
      })
    }
    const handlePointerMove = (event: PointerEvent) => {
      const activeDrag = activeDragRef.current
      if (!activeDrag || activeDrag.pointerId !== event.pointerId) return

      const point: MagnifierPoint = isSelectionPointerMoveTextHit(event)
        ? { clientX: event.clientX, clientY: event.clientY }
        : {
            clientX: event.clientX + activeDrag.offsetX,
            clientY: event.clientY + activeDrag.offsetY
          }
      magnifier.move(point)
    }
    const handlePointerEnd = (event: PointerEvent) => {
      if (activeDragRef.current?.pointerId === event.pointerId) finishDrag()
    }

    ownerDocument.addEventListener('pointerdown', handlePointerDown, true)
    ownerDocument.addEventListener('pointermove', handlePointerMove, true)
    ownerDocument.addEventListener('pointerup', handlePointerEnd, true)
    ownerDocument.addEventListener('pointercancel', handlePointerEnd, true)
    ownerDocument.defaultView?.addEventListener('blur', finishDrag)

    return () => {
      ownerDocument.removeEventListener('pointerdown', handlePointerDown, true)
      ownerDocument.removeEventListener('pointermove', handlePointerMove, true)
      ownerDocument.removeEventListener('pointerup', handlePointerEnd, true)
      ownerDocument.removeEventListener('pointercancel', handlePointerEnd, true)
      ownerDocument.defaultView?.removeEventListener('blur', finishDrag)
      finishDrag()
    }
  }, [magnifier, viewerRootElement])

  return null
}
