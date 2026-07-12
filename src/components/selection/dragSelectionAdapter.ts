import {
  Drag,
  DragOperationType,
  type Finger,
  type Options,
  type Pose
} from '@system-ui-js/multi-drag'

export type DragSelectionPointerDetail = {
  pointerId: number
  activePointerCount: number
  pointerType?: string
  timeStamp: number
}

export type DragSelectionCallback = (
  clientX: number,
  clientY: number,
  detail?: DragSelectionPointerDetail
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
  onStart?: DragSelectionCallback
  onMove?: DragSelectionCallback
  onEnd?: DragSelectionCallback
  onAllEnd?: DragSelectionCallback
  getPointerType?: (pointerId: number) => string | undefined
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

type PointerSnapshot = {
  point: PointerPoint
  detail: DragSelectionPointerDetail
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

const getFingerSnapshot = (
  finger: Finger | undefined,
  activePointerCount: number,
  getPointerType?: (pointerId: number) => string | undefined
): PointerSnapshot | null => {
  if (!finger) return null

  const lastOperation = finger?.getLastOperation()
  const point = lastOperation?.point

  if (!point) return null

  // Finger 类型定义暴露 readonly pointerId，时间戳在最后一次操作的 timestamp 字段中。
  const pointerId = finger.pointerId

  return {
    point: {
      clientX: point.x,
      clientY: point.y
    },
    detail: {
      pointerId,
      activePointerCount,
      pointerType: getPointerType?.(pointerId),
      timeStamp: lastOperation.timestamp
    }
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
  let lastPrimaryDetail: DragSelectionPointerDetail | null = null
  let destroyed = false

  const resetPrimary = () => {
    state.active = false
    state.primaryPointerId = null
    lastPrimaryPoint = null
    lastPrimaryDetail = null
  }

  const rememberPrimary = (snapshot: PointerSnapshot) => {
    lastPrimaryPoint = snapshot.point
    lastPrimaryDetail = snapshot.detail
  }

  const handleStart = (fingers: Finger[]) => {
    if (state.primaryPointerId !== null) return

    const finger = fingers[0]
    const snapshot = getFingerSnapshot(
      finger,
      fingers.length,
      options.getPointerType
    )
    if (!finger || !snapshot) return

    state.active = true
    state.primaryPointerId = finger.pointerId
    rememberPrimary(snapshot)
    options.onStart?.(
      snapshot.point.clientX,
      snapshot.point.clientY,
      snapshot.detail
    )
  }

  const handleMove = (fingers: Finger[]) => {
    if (!state.active || state.primaryPointerId === null) return

    const snapshot = getFingerSnapshot(
      findPrimaryFinger(fingers, state.primaryPointerId),
      fingers.length,
      options.getPointerType
    )
    if (!snapshot) return

    rememberPrimary(snapshot)
    options.onMove?.(
      snapshot.point.clientX,
      snapshot.point.clientY,
      snapshot.detail
    )
  }

  const handleEnd = (fingers: Finger[]) => {
    if (state.primaryPointerId === null) return

    const snapshot = getFingerSnapshot(
      findPrimaryFinger(fingers, state.primaryPointerId),
      fingers.length,
      options.getPointerType
    )
    if (!snapshot) return

    rememberPrimary(snapshot)
    state.active = false
    options.onEnd?.(
      snapshot.point.clientX,
      snapshot.point.clientY,
      snapshot.detail
    )
  }

  const handleAllEnd = (fingers: Finger[]) => {
    const snapshot = getFingerSnapshot(
      findPrimaryFinger(fingers, state.primaryPointerId),
      fingers.length,
      options.getPointerType
    )
    const point = snapshot?.point ?? lastPrimaryPoint
    const detail = snapshot?.detail ?? lastPrimaryDetail
    if (!point) {
      resetPrimary()
      return
    }

    options.onAllEnd?.(point.clientX, point.clientY, detail ?? undefined)
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
