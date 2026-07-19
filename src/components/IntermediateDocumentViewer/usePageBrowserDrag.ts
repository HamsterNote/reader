import {
  Drag,
  DragOperationType,
  type Finger,
  type Pose
} from '@system-ui-js/multi-drag'
import { type RefObject, useEffect, useState } from 'react'

const DIRECTION_LOCK_THRESHOLD_PX = 8

type DragDirection = 'pending' | 'horizontal' | 'vertical'

type PageBrowserDragOptions = {
  readonly elementRef: RefObject<HTMLElement | null>
  readonly isOpen: boolean
  readonly onDismiss: () => void
}

function getFingerDelta(finger: Finger): {
  readonly x: number
  readonly y: number
} {
  const path = finger.getPath()
  const start = path[0]?.point
  const current = path[path.length - 1]?.point
  if (!start || !current) return { x: 0, y: 0 }
  return { x: current.x - start.x, y: current.y - start.y }
}

export function usePageBrowserDrag({
  elementRef,
  isOpen,
  onDismiss
}: PageBrowserDragOptions): boolean {
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const element = elementRef.current
    if (!element || !isOpen) return

    let direction: DragDirection = 'pending'
    let offsetX = 0

    const reset = () => {
      direction = 'pending'
      offsetX = 0
      element.style.removeProperty('--hamster-reader-page-browser-drag-x')
      setIsDragging(false)
    }

    const drag = new Drag(element, {
      maxFingerCount: 1,
      inertial: false,
      getPose: () => ({
        position: { x: 0, y: 0 },
        width: element.offsetWidth,
        height: element.offsetHeight
      }),
      setPose: (_target: HTMLElement, _pose: Partial<Pose>) => undefined
    })

    element.style.touchAction = 'pan-y'

    const handleStart = () => {
      direction = 'pending'
      offsetX = 0
    }

    const handleMove = (fingers: Finger[]) => {
      const finger = fingers[0]
      if (!finger) return

      const delta = getFingerDelta(finger)
      if (direction === 'pending') {
        if (
          Math.abs(delta.x) < DIRECTION_LOCK_THRESHOLD_PX &&
          Math.abs(delta.y) < DIRECTION_LOCK_THRESHOLD_PX
        ) {
          return
        }
        direction =
          Math.abs(delta.x) > Math.abs(delta.y) ? 'horizontal' : 'vertical'
      }
      if (direction !== 'horizontal') return

      offsetX = Math.min(0, delta.x)
      element.style.setProperty(
        '--hamster-reader-page-browser-drag-x',
        `${offsetX}px`
      )
      setIsDragging(true)
    }

    const handleEnd = (fingers: Finger[]) => {
      const eventType = fingers[0]?.getLastOperation()?.event?.type
      const width = element.getBoundingClientRect().width || element.offsetWidth
      const shouldDismiss =
        eventType !== 'pointercancel' &&
        direction === 'horizontal' &&
        Math.abs(offsetX) > width / 2

      if (shouldDismiss) {
        onDismiss()
        setIsDragging(false)
        return
      }
      reset()
    }

    drag.addEventListener(DragOperationType.Start, handleStart)
    drag.addEventListener(DragOperationType.Move, handleMove)
    drag.addEventListener(DragOperationType.End, handleEnd)

    return () => {
      drag.destroy()
      element.style.removeProperty('touch-action')
      reset()
    }
  }, [elementRef, isOpen, onDismiss])

  return isDragging
}
