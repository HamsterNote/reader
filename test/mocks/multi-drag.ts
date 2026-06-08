// Mock for @system-ui-js/multi-drag to avoid ESM directory-import issues in Vitest/Node.
// The real drag behavior is never used in tests; createDragSelectionAdapter accepts
// a DragConstructor injection for all test scenarios.

export class Drag {
  constructor(_element: HTMLElement, _options?: unknown) {}

  addEventListener(_type: string, _callback: unknown) {}

  removeEventListener(_type: string, _callback?: unknown) {}

  destroy() {}

  getCurrentOperationType() {
    return 'allEnd'
  }
}

export const DragOperationType = {
  Start: 'start',
  Move: 'move',
  End: 'end',
  Inertial: 'inertial',
  InertialEnd: 'inertialEnd',
  AllEnd: 'allEnd'
} as const

export class Finger {
  pointerId = 0

  getLastOperation() {
    return undefined
  }
}

export const FingerOperationType = {
  Start: 'start',
  Move: 'move',
  End: 'end'
} as const

export interface Pose {
  position: { x: number; y: number }
  width: number
  height: number
}

export interface Options {
  maxFingerCount?: number
  inertial?: boolean
  passive?: boolean
  getPose?: () => Pose
  setPose?: (_pose: Pose) => void
  setPoseOnEnd?: (_pose: Pose) => void
}
