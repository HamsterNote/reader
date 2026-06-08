import {
  Drag,
  DragOperationType,
  type Finger,
  type Options,
  type Pose
} from '@system-ui-js/multi-drag'

export type DragSelectionAdapterCallback = (
  clientX: number,
  clientY: number
) => void

export type DragSelectionAdapterDrag = Pick<
  InstanceType<typeof Drag>,
  | 'addEventListener'
  | 'removeEventListener'
  | 'destroy'
  | 'getCurrentOperationType'
>

export type DragSelectionAdapterDragConstructor = new (
  element: HTMLElement,
  options?: Options
) => DragSelectionAdapterDrag

export type DragSelectionAdapterOptions = {
  onStart: DragSelectionAdapterCallback
  onMove: DragSelectionAdapterCallback
  onEnd: DragSelectionAdapterCallback
  onAllEnd: DragSelectionAdapterCallback
  DragConstructor?: DragSelectionAdapterDragConstructor
}

export type DragSelectionAdapterState = {
  active: boolean
  primaryPointerId: number | null
}

export type DragSelectionAdapter = {
  destroy: () => void
  isActive: () => boolean
  getState: () => DragSelectionAdapterState
}

type PointerPoint = {
  clientX: number
  clientY: number
}

const noopPose: Pose = {
  position: { x: 0, y: 0 },
  width: 0,
  height: 0
}

const noopDragOptions: Pick<Options, 'getPose' | 'setPose' | 'setPoseOnEnd'> = {
  // multi-drag normally writes transforms from pose changes. These no-ops keep
  // selection gestures imperative-only and prevent DOM movement.
  getPose: () => noopPose,
  setPose: () => {},
  setPoseOnEnd: () => {}
}

const getFingerPoint = (finger: Finger | undefined): PointerPoint | null => {
  const lastOperation = finger?.getLastOperation()
  const point = lastOperation?.point

  if (!point) return null

  return {
    clientX: point.x,
    clientY: point.y
  }
}

const findPrimaryFinger = (
  fingers: Finger[],
  primaryPointerId: number | null
) => {
  if (primaryPointerId === null) return fingers[0]
  return fingers.find((finger) => finger.pointerId === primaryPointerId)
}

export const createDragSelectionAdapter = (
  element: HTMLElement,
  options: DragSelectionAdapterOptions
): DragSelectionAdapter => {
  const DragConstructor = options.DragConstructor ?? Drag
  const drag = new DragConstructor(element, {
    maxFingerCount: 2,
    inertial: false,
    passive: false,
    ...noopDragOptions
  })
  const state: DragSelectionAdapterState = {
    active: false,
    primaryPointerId: null
  }
  let lastPrimaryPoint: PointerPoint | null = null
  let destroyed = false

  const resetPrimary = () => {
    state.active = false
    state.primaryPointerId = null
    lastPrimaryPoint = null
  }

  const handleStart = (fingers: Finger[]) => {
    if (state.primaryPointerId !== null) return

    const finger = fingers[0]
    const point = getFingerPoint(finger)
    if (!finger || !point) return

    state.active = true
    state.primaryPointerId = finger.pointerId
    lastPrimaryPoint = point
    options.onStart(point.clientX, point.clientY)
  }

  const handleMove = (fingers: Finger[]) => {
    if (!state.active || state.primaryPointerId === null) return

    const point = getFingerPoint(
      findPrimaryFinger(fingers, state.primaryPointerId)
    )
    if (!point) return

    lastPrimaryPoint = point
    options.onMove(point.clientX, point.clientY)
  }

  const handleEnd = (fingers: Finger[]) => {
    if (state.primaryPointerId === null) return

    const point = getFingerPoint(
      findPrimaryFinger(fingers, state.primaryPointerId)
    )
    if (!point) return

    lastPrimaryPoint = point
    state.active = false
    options.onEnd(point.clientX, point.clientY)
  }

  const handleAllEnd = (fingers: Finger[]) => {
    const point =
      getFingerPoint(findPrimaryFinger(fingers, state.primaryPointerId)) ??
      lastPrimaryPoint
    if (!point) {
      resetPrimary()
      return
    }

    options.onAllEnd(point.clientX, point.clientY)
    resetPrimary()
  }

  drag.addEventListener(DragOperationType.Start, handleStart)
  drag.addEventListener(DragOperationType.Move, handleMove)
  drag.addEventListener(DragOperationType.End, handleEnd)
  drag.addEventListener(DragOperationType.AllEnd, handleAllEnd)

  return {
    destroy: () => {
      if (destroyed) return
      destroyed = true
      resetPrimary()
      drag.removeEventListener(DragOperationType.Start, handleStart)
      drag.removeEventListener(DragOperationType.Move, handleMove)
      drag.removeEventListener(DragOperationType.End, handleEnd)
      drag.removeEventListener(DragOperationType.AllEnd, handleAllEnd)
      drag.destroy()
    },
    isActive: () => state.active,
    getState: () => ({ ...state })
  }
}
