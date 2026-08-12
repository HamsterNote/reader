import {
  Drag,
  DragOperationType,
  type Finger,
  type Pose
} from '@system-ui-js/multi-drag'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import type { ReaderSelectionRange } from '../../types/selection'
import { forwardHighlightPointerDown } from './forwardHighlightPointerDown'

type HighlightDragStart = {
  pointerId: number
  pointerType: 'mouse' | 'touch'
  clientX: number
  clientY: number
  highlight: ReaderSelectionRange
  triggered: boolean
  longPressTimer: ReturnType<typeof setTimeout> | null
}

type HighlightDragOptions = {
  viewerRootElement: HTMLDivElement | null
  resolveHighlight: (
    clientX: number,
    clientY: number
  ) => ReaderSelectionRange | null
  onDragHighlight: ((highlight: ReaderSelectionRange) => void) | undefined
}

const HIGHLIGHT_DRAG_MOVE_TOLERANCE = 4
const HIGHLIGHT_TOUCH_LONG_PRESS_MS = 500

export function useHighlightDrag({
  viewerRootElement,
  resolveHighlight,
  onDragHighlight
}: HighlightDragOptions) {
  const dragStartRef = useRef<HighlightDragStart | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const dragElementRef = useRef<HTMLElement | null>(null)
  const viewerRootElementRef = useRef(viewerRootElement)
  const onDragHighlightRef = useRef(onDragHighlight)
  viewerRootElementRef.current = viewerRootElement
  onDragHighlightRef.current = onDragHighlight
  const [activePointerType, setActivePointerType] = useState<
    HighlightDragStart['pointerType'] | null
  >(null)
  const [suppressNativeSelection, setSuppressNativeSelection] = useState(false)

  const clearDragStart = useCallback(() => {
    const dragStart = dragStartRef.current
    if (dragStart?.longPressTimer) {
      clearTimeout(dragStart.longPressTimer)
    }
    dragStartRef.current = null
    setActivePointerType(null)
    setSuppressNativeSelection(false)
  }, [])

  const activateDrag = useCallback((dragStart: HighlightDragStart) => {
    if (dragStartRef.current !== dragStart || dragStart.triggered) return

    dragStart.triggered = true
    if (dragStart.longPressTimer) {
      clearTimeout(dragStart.longPressTimer)
      dragStart.longPressTimer = null
    }
    viewerRootElementRef.current?.ownerDocument
      .getSelection()
      ?.removeAllRanges()
    setActivePointerType(dragStart.pointerType)
    onDragHighlightRef.current?.(dragStart.highlight)
  }, [])

  const handleTrackedPointerMove = useCallback(
    (event: PointerEvent) => {
      const dragStart = dragStartRef.current
      if (!dragStart || event.pointerId !== dragStart.pointerId) return
      if (
        !dragRef.current
          ?.getFingers()
          .some((finger) => finger.pointerId === event.pointerId)
      ) {
        return
      }
      if (dragStart.triggered) {
        if (event.cancelable) event.preventDefault()
        return
      }

      const movedPastTolerance =
        Math.abs(event.clientX - dragStart.clientX) >
          HIGHLIGHT_DRAG_MOVE_TOLERANCE ||
        Math.abs(event.clientY - dragStart.clientY) >
          HIGHLIGHT_DRAG_MOVE_TOLERANCE
      if (!movedPastTolerance) return

      if (dragStart.pointerType === 'touch') {
        clearDragStart()
        return
      }

      if (event.cancelable) event.preventDefault()
      activateDrag(dragStart)
    },
    [activateDrag, clearDragStart]
  )

  useEffect(() => {
    const ownerDocument = viewerRootElement?.ownerDocument
    if (!ownerDocument) return

    const dragElement = ownerDocument.createElement('div')
    const stationaryPose: Pose = {
      position: { x: 0, y: 0 },
      width: 0,
      height: 0
    }
    const drag = new Drag(dragElement, {
      maxFingerCount: 1,
      inertial: false,
      getPose: () => stationaryPose,
      setPose: () => {},
      setPoseOnEnd: () => {}
    })
    dragRef.current = drag
    dragElementRef.current = dragElement

    const handleDragMove = (fingers: Finger[]) => {
      const dragStart = dragStartRef.current
      if (!dragStart) return
      const event = fingers
        .find((finger) => finger.pointerId === dragStart.pointerId)
        ?.getLastOperation()?.event
      if (event) handleTrackedPointerMove(event)
    }
    const handleAllDragEnd = () => clearDragStart()
    drag.addEventListener(DragOperationType.Move, handleDragMove)
    drag.addEventListener(DragOperationType.AllEnd, handleAllDragEnd)

    return () => {
      drag.removeEventListener(DragOperationType.Move, handleDragMove)
      drag.removeEventListener(DragOperationType.AllEnd, handleAllDragEnd)
      drag.destroy()
      if (dragRef.current === drag) dragRef.current = null
      if (dragElementRef.current === dragElement) dragElementRef.current = null
      clearDragStart()
    }
  }, [clearDragStart, handleTrackedPointerMove, viewerRootElement])

  useEffect(() => {
    if (!viewerRootElement) return

    const preventNativeTouchGesture = (event: TouchEvent) => {
      if (!onDragHighlight || event.touches.length !== 1) return

      const touch = event.touches[0]
      if (!touch || !resolveHighlight(touch.clientX, touch.clientY)) return

      if (event.cancelable) event.preventDefault()
    }
    viewerRootElement.addEventListener(
      'touchstart',
      preventNativeTouchGesture,
      { capture: true, passive: false }
    )

    return () => {
      viewerRootElement.removeEventListener(
        'touchstart',
        preventNativeTouchGesture,
        true
      )
    }
  }, [onDragHighlight, resolveHighlight, viewerRootElement])

  const handleHighlightPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pendingDragStart = dragStartRef.current
      if (
        pendingDragStart?.pointerType === 'touch' &&
        !pendingDragStart.triggered &&
        event.pointerType === 'touch' &&
        event.pointerId !== pendingDragStart.pointerId
      ) {
        clearDragStart()
        return
      }
      if (pendingDragStart?.triggered) return
      if (
        !onDragHighlight ||
        !event.isPrimary ||
        (event.pointerType !== 'mouse' && event.pointerType !== 'touch') ||
        (event.pointerType === 'mouse' && event.button !== 0)
      ) {
        return
      }
      clearDragStart()

      const highlight = resolveHighlight(event.clientX, event.clientY)
      if (!highlight) return

      const dragStart: HighlightDragStart = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        clientX: event.clientX,
        clientY: event.clientY,
        highlight,
        triggered: false,
        longPressTimer: null
      }
      if (event.pointerType === 'touch') {
        dragStart.longPressTimer = setTimeout(() => {
          if (dragStartRef.current !== dragStart) return
          const pointerIsTracked = dragRef.current
            ?.getFingers()
            .some((finger) => finger.pointerId === dragStart.pointerId)
          if (!pointerIsTracked) {
            clearDragStart()
            return
          }
          activateDrag(dragStart)
        }, HIGHLIGHT_TOUCH_LONG_PRESS_MS)
      }
      dragStartRef.current = dragStart
      setSuppressNativeSelection(event.pointerType === 'touch')

      if (event.cancelable) event.preventDefault()
      event.stopPropagation()

      if (!forwardHighlightPointerDown(event, dragElementRef.current)) {
        clearDragStart()
      }
    },
    [activateDrag, clearDragStart, onDragHighlight, resolveHighlight]
  )

  const handleHighlightPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      handleTrackedPointerMove(event.nativeEvent)
    },
    [handleTrackedPointerMove]
  )

  const handleHighlightPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): boolean => {
      const dragStart = dragStartRef.current
      if (!dragStart || event.pointerId !== dragStart.pointerId) return false

      const triggered = dragStart.triggered
      clearDragStart()
      return triggered
    },
    [clearDragStart]
  )

  const handleHighlightPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragStart = dragStartRef.current
      if (!dragStart || event.pointerId !== dragStart.pointerId) return

      clearDragStart()
    },
    [clearDragStart]
  )

  return {
    activePointerType,
    suppressNativeSelection,
    handleHighlightPointerDown,
    handleHighlightPointerMove,
    handleHighlightPointerUp,
    handleHighlightPointerCancel
  }
}
