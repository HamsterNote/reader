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

import { forwardHighlightPointerDown } from './forwardHighlightPointerDown'

type ItemDragStart<Item> = {
  pointerId: number
  pointerType: 'mouse' | 'touch'
  clientX: number
  clientY: number
  item: Item
  triggered: boolean
  longPressTimer: ReturnType<typeof setTimeout> | null
}

type ItemDragOptions<Item, Element extends HTMLElement> = {
  viewerRootElement: Element | null
  resolveItem: (clientX: number, clientY: number) => Item | null
  onDragItem: ((item: Item) => void) | undefined
}

const HIGHLIGHT_DRAG_MOVE_TOLERANCE = 4
const HIGHLIGHT_TOUCH_LONG_PRESS_MS = 500

export function useHighlightDrag<
  Item,
  Element extends HTMLElement = HTMLDivElement
>({
  viewerRootElement,
  resolveItem,
  onDragItem
}: ItemDragOptions<Item, Element>) {
  const dragStartRef = useRef<ItemDragStart<Item> | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const dragElementRef = useRef<HTMLElement | null>(null)
  const viewerRootElementRef = useRef(viewerRootElement)
  const onDragItemRef = useRef(onDragItem)
  viewerRootElementRef.current = viewerRootElement
  onDragItemRef.current = onDragItem
  const [activePointerType, setActivePointerType] = useState<
    ItemDragStart<Item>['pointerType'] | null
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

  const activateDrag = useCallback((dragStart: ItemDragStart<Item>) => {
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
    onDragItemRef.current?.(dragStart.item)
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
      if (!onDragItem || event.touches.length !== 1) return

      const touch = event.touches[0]
      if (!touch || !resolveItem(touch.clientX, touch.clientY)) return

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
  }, [onDragItem, resolveItem, viewerRootElement])

  const handleHighlightPointerDown = useCallback(
    (event: ReactPointerEvent<Element>) => {
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
        !onDragItem ||
        !event.isPrimary ||
        (event.pointerType !== 'mouse' && event.pointerType !== 'touch') ||
        (event.pointerType === 'mouse' && event.button !== 0)
      ) {
        return
      }
      clearDragStart()

      const item = resolveItem(event.clientX, event.clientY)
      if (!item) return

      const dragStart: ItemDragStart<Item> = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        clientX: event.clientX,
        clientY: event.clientY,
        item,
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
    [activateDrag, clearDragStart, onDragItem, resolveItem]
  )

  const handleHighlightPointerMove = useCallback(
    (event: ReactPointerEvent<Element>) => {
      handleTrackedPointerMove(event.nativeEvent)
    },
    [handleTrackedPointerMove]
  )

  const handleHighlightPointerUp = useCallback(
    (event: ReactPointerEvent<Element>): boolean => {
      const dragStart = dragStartRef.current
      if (!dragStart || event.pointerId !== dragStart.pointerId) return false

      const triggered = dragStart.triggered
      clearDragStart()
      return triggered
    },
    [clearDragStart]
  )

  const handleHighlightPointerCancel = useCallback(
    (event: ReactPointerEvent<Element>) => {
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
