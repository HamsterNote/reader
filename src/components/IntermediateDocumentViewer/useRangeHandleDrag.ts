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
import { usesTouchMagnifier } from './selectionInteraction'

interface ActiveRangeHandleDragSession {
  readonly sourceElement: HTMLElement
  readonly stopPointerCorrection: () => void
  readonly finishDrag: () => void
}

interface RangeHandleDragOptions {
  readonly circleRef: RefObject<HTMLButtonElement | null>
  readonly correctPointerCoordinates: boolean
  readonly magnifierEnabled: boolean
  readonly viewerRoot?: HTMLElement | null
  readonly pointerTarget?: {
    readonly clientX: number
    readonly clientY: number
  }
}

const activeDragSessions = new WeakMap<Document, ActiveRangeHandleDragSession>()
const handledPointerDownEvents = new WeakSet<PointerEvent>()

const copyPointerEvent = (
  event: PointerEvent,
  clientX: number,
  clientY: number,
  type = event.type
): PointerEvent =>
  new PointerEvent(type, {
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
  magnifierEnabled,
  viewerRoot,
  pointerTarget
}: RangeHandleDragOptions): ((event: PointerEvent) => void) => {
  const magnifier = useRangeMagnifier()
  const activeMagnifier = magnifierEnabled ? magnifier : null
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

      // Text hit tests use the actual pointer; rectangle grabs keep their offset.
      const circleRect = circle.getBoundingClientRect()
      const isText =
        !circle.dataset.rectId &&
        !circle.classList.contains('hsn-selection-handle-rect')
      const offsetX = isText
        ? 0
        : circleRect.left + circleRect.width / 2 - event.clientX
      const offsetY = isText
        ? 0
        : circleRect.top + circleRect.height / 2 - event.clientY
      const sessionMagnifier =
        !isText || usesTouchMagnifier(event.pointerType)
          ? activeMagnifier
          : null
      const forwardedEvents = new WeakSet<PointerEvent>()
      let pointerCorrectionActive = correctPointerCoordinates
      let dragFinished = false
      let unregisterMagnifierCleanup: (() => void) | null = null
      sessionMagnifier?.start(circle, {
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

        sessionMagnifier?.move({
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
        sessionMagnifier?.end()
        if (activeDragSessions.get(ownerDocument)?.finishDrag === finishDrag) {
          activeDragSessions.delete(ownerDocument)
        }
      }
      const finishPointerDrag = (terminalEvent: PointerEvent) => {
        if (terminalEvent.pointerId !== event.pointerId) return
        if (
          terminalEvent.type === 'pointerup' &&
          pointerTarget &&
          correctPointerCoordinates
        ) {
          correctPointerMove(
            copyPointerEvent(
              terminalEvent,
              terminalEvent.clientX,
              terminalEvent.clientY,
              'pointermove'
            )
          )
        }
        finishDrag()
      }
      const correctPointerMove = (moveEvent: PointerEvent) => {
        if (
          forwardedEvents.has(moveEvent) ||
          moveEvent.pointerId !== event.pointerId
        ) {
          return
        }

        const correctedClientX = moveEvent.clientX + offsetX
        const correctedClientY = moveEvent.clientY + offsetY
        const selectionRoot =
          circle.closest<HTMLElement>(
            '.hamster-reader__intermediate-document-viewer'
          ) ?? viewerRoot
        if (
          !selectionRoot ||
          !isPointOnSelectionText(
            pointerTarget ? correctedClientX : moveEvent.clientX,
            pointerTarget ? correctedClientY : moveEvent.clientY,
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
          correctedClientX,
          correctedClientY
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
      if (activeMagnifier) {
        unregisterMagnifierCleanup =
          activeMagnifier.registerDragCleanup(finishDrag)
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
    [
      activeMagnifier,
      circleRef,
      correctPointerCoordinates,
      pointerTarget,
      viewerRoot
    ]
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
      const circleRoot =
        viewerRoot ??
        circle?.closest('.hamster-reader__intermediate-document-viewer')
      const targetRoot =
        target instanceof HTMLButtonElement
          ? target.closest('.hamster-reader__intermediate-document-viewer')
          : null
      const isSameViewer = circleRoot ? targetRoot === circleRoot : !targetRoot
      if (
        circle &&
        target instanceof HTMLButtonElement &&
        (target === circle ||
          (isSameViewer &&
            target.className === circle.className &&
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
  }, [circleRef, viewerRoot])

  return startHandleDrag
}
