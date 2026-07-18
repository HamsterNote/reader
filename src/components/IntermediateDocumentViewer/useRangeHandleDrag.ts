import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef
} from 'react'

import { isPointOnSelectionText } from '../selection/caretResolver'
import { markSelectionPointerMoveAsTextHit } from '../selection/selectionPointerGuard'
import { useRangeMagnifier } from './RangeMagnifier'

interface ActiveRangeHandleDragSession {
  readonly sourceElement: HTMLElement
  readonly stopPointerCorrection: () => void
  readonly finishDrag: () => void
}

interface RangeHandleDragOptions {
  readonly circleRef: RefObject<HTMLButtonElement | null>
  readonly correctPointerCoordinates: boolean
  readonly viewerRoot?: HTMLElement | null
}

const activeDragSessions = new WeakMap<Document, ActiveRangeHandleDragSession>()
const handledPointerDownEvents = new WeakSet<PointerEvent>()

const copyPointerEvent = (
  event: PointerEvent,
  clientX: number,
  clientY: number
): PointerEvent =>
  new PointerEvent(event.type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: event.view,
    detail: event.detail,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX,
    clientY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
    pointerId: event.pointerId,
    width: event.width,
    height: event.height,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary
  })

export const useRangeHandleDrag = ({
  circleRef,
  correctPointerCoordinates,
  viewerRoot
}: RangeHandleDragOptions): ((event: PointerEvent) => void) => {
  const magnifier = useRangeMagnifier()
  const latestStartHandleDragRef = useRef<
    ((event: PointerEvent) => void) | null
  >(null)

  const startHandleDrag = useCallback(
    (event: PointerEvent) => {
      const currentCircle = circleRef.current
      const eventTarget =
        event.target instanceof HTMLButtonElement ? event.target : null
      const circle = currentCircle?.isConnected
        ? currentCircle
        : (eventTarget ?? currentCircle)
      if (!circle || handledPointerDownEvents.has(event)) return
      handledPointerDownEvents.add(event)

      const ownerDocument = circle.ownerDocument
      activeDragSessions.get(ownerDocument)?.finishDrag()

      // 放大镜始终跟随手柄中心；自定义文本圆柄还会把依赖收到的
      // pointermove 坐标修正到圆心，避免从圆柄边缘抓取时端点偏移。
      const circleRect = circle.getBoundingClientRect()
      const offsetX = circleRect.left + circleRect.width / 2 - event.clientX
      const offsetY = circleRect.top + circleRect.height / 2 - event.clientY
      const forwardedEvents = new WeakSet<PointerEvent>()
      let pointerCorrectionActive = correctPointerCoordinates
      let dragFinished = false
      let unregisterMagnifierCleanup: (() => void) | null = null
      magnifier?.start(circle, {
        clientX: event.clientX + offsetX,
        clientY: event.clientY + offsetY
      })

      const trackMagnifierMove = (moveEvent: PointerEvent) => {
        if (
          forwardedEvents.has(moveEvent) ||
          moveEvent.pointerId !== event.pointerId
        ) {
          return
        }

        magnifier?.move({
          clientX: moveEvent.clientX + offsetX,
          clientY: moveEvent.clientY + offsetY
        })
      }
      const stopPointerCorrection = () => {
        if (!pointerCorrectionActive) return
        pointerCorrectionActive = false
        ownerDocument.removeEventListener(
          'pointermove',
          correctPointerMove,
          true
        )
      }
      const finishDrag = () => {
        if (dragFinished) return
        dragFinished = true
        stopPointerCorrection()
        ownerDocument.removeEventListener(
          'pointermove',
          trackMagnifierMove,
          true
        )
        ownerDocument.removeEventListener('pointerup', finishPointerDrag, true)
        ownerDocument.removeEventListener(
          'pointercancel',
          finishPointerDrag,
          true
        )
        ownerDocument.defaultView?.removeEventListener('blur', finishDrag)
        unregisterMagnifierCleanup?.()
        unregisterMagnifierCleanup = null
        magnifier?.end()
        if (activeDragSessions.get(ownerDocument)?.finishDrag === finishDrag) {
          activeDragSessions.delete(ownerDocument)
        }
      }
      const finishPointerDrag = (terminalEvent: PointerEvent) => {
        if (terminalEvent.pointerId === event.pointerId) finishDrag()
      }
      const correctPointerMove = (moveEvent: PointerEvent) => {
        if (
          forwardedEvents.has(moveEvent) ||
          moveEvent.pointerId !== event.pointerId
        ) {
          return
        }

        const selectionRoot =
          circle.closest<HTMLElement>(
            '.hamster-reader__intermediate-document-viewer'
          ) ?? viewerRoot
        if (
          !selectionRoot ||
          !isPointOnSelectionText(
            moveEvent.clientX,
            moveEvent.clientY,
            selectionRoot,
            ownerDocument
          )
        ) {
          moveEvent.preventDefault()
          moveEvent.stopImmediatePropagation()
          return
        }

        moveEvent.preventDefault()
        moveEvent.stopImmediatePropagation()
        const correctedEvent = copyPointerEvent(
          moveEvent,
          moveEvent.clientX + offsetX,
          moveEvent.clientY + offsetY
        )
        markSelectionPointerMoveAsTextHit(correctedEvent)
        forwardedEvents.add(correctedEvent)
        ownerDocument.dispatchEvent(correctedEvent)
      }

      const session: ActiveRangeHandleDragSession = {
        sourceElement: circle,
        stopPointerCorrection,
        finishDrag
      }
      if (magnifier) {
        unregisterMagnifierCleanup = magnifier.registerDragCleanup(finishDrag)
        ownerDocument.addEventListener('pointermove', trackMagnifierMove, true)
      }
      if (correctPointerCoordinates) {
        ownerDocument.addEventListener('pointermove', correctPointerMove, true)
      }
      ownerDocument.addEventListener('pointerup', finishPointerDrag, true)
      ownerDocument.addEventListener('pointercancel', finishPointerDrag, true)
      ownerDocument.defaultView?.addEventListener('blur', finishDrag)
      activeDragSessions.set(ownerDocument, session)
    },
    [circleRef, correctPointerCoordinates, magnifier, viewerRoot]
  )

  useLayoutEffect(() => {
    latestStartHandleDragRef.current = startHandleDrag
  }, [startHandleDrag])

  useEffect(() => {
    const sourceElement = circleRef.current
    const ownerDocument = sourceElement?.ownerDocument ?? document
    const capturePointerDown = (event: PointerEvent) => {
      const circle = circleRef.current
      const target = event.target
      if (
        circle &&
        target instanceof HTMLButtonElement &&
        (target === circle ||
          (target.className === circle.className &&
            target.dataset.rangeHandleCircle ===
              circle.dataset.rangeHandleCircle &&
            target.dataset.rangeId === circle.dataset.rangeId &&
            target.dataset.rectId === circle.dataset.rectId))
      ) {
        latestStartHandleDragRef.current?.(event)
      }
    }
    ownerDocument.addEventListener('pointerdown', capturePointerDown, true)

    return () => {
      ownerDocument.removeEventListener('pointerdown', capturePointerDown, true)
      const activeSession = activeDragSessions.get(ownerDocument)
      if (!activeSession || activeSession.sourceElement !== sourceElement) {
        return
      }
      activeSession.finishDrag()
    }
  }, [circleRef])

  return startHandleDrag
}
