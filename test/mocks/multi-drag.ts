export class Drag {
  private readonly callbacks = new Map<
    string,
    Array<(fingers: Finger[]) => void>
  >()
  private readonly fingers = new Map<number, Finger>()

  constructor(
    private readonly element: HTMLElement,
    private readonly options?: Options
  ) {
    element.addEventListener('pointerdown', this.handlePointerDown)
    document.addEventListener('pointermove', this.handlePointerMove)
    document.addEventListener('pointerup', this.handlePointerUp)
    document.addEventListener('pointercancel', this.handlePointerCancel)
  }

  addEventListener(type: string, callback: (fingers: Finger[]) => void) {
    this.callbacks.set(type, [...(this.callbacks.get(type) ?? []), callback])
  }

  removeEventListener(type: string, callback?: (fingers: Finger[]) => void) {
    if (!callback) {
      this.callbacks.delete(type)
      return
    }
    this.callbacks.set(
      type,
      (this.callbacks.get(type) ?? []).filter((item) => item !== callback)
    )
  }

  destroy() {
    this.element.removeEventListener('pointerdown', this.handlePointerDown)
    document.removeEventListener('pointermove', this.handlePointerMove)
    document.removeEventListener('pointerup', this.handlePointerUp)
    document.removeEventListener('pointercancel', this.handlePointerCancel)
    this.fingers.clear()
  }

  getCurrentOperationType() {
    return 'allEnd'
  }

  private trigger(type: string, fingers = [...this.fingers.values()]) {
    this.callbacks.get(type)?.forEach((callback) => {
      callback(fingers)
    })
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Drag 会覆盖 maxFingerCount 为 -1，因此这里必须接受多个指针。
    const finger = new Finger(event)
    this.fingers.set(event.pointerId, finger)
    this.trigger(DragOperationType.Start)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    const finger = this.fingers.get(event.pointerId)
    if (!finger) return
    finger.record(FingerOperationType.Move, event)
    this.options?.setPose?.(
      this.element,
      this.options.getPose?.(this.element) ?? {}
    )
    this.trigger(DragOperationType.Move)
  }

  private finishPointer(event: PointerEvent) {
    const finger = this.fingers.get(event.pointerId)
    if (!finger) return
    finger.record(FingerOperationType.End, event)
    // 真实 multi-drag 会在 End 回调前销毁并移除 finger。
    this.fingers.delete(event.pointerId)
    if (this.fingers.size === 0) {
      this.trigger(DragOperationType.AllEnd)
    }
    this.trigger(DragOperationType.End)
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    this.finishPointer(event)
  }

  private readonly handlePointerCancel = (event: PointerEvent) => {
    this.finishPointer(event)
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
  readonly pointerId: number
  private readonly path: FingerPathItem[]

  constructor(event: PointerEvent) {
    this.pointerId = event.pointerId
    this.path = [this.createPathItem(FingerOperationType.Start, event)]
  }

  record(type: string, event: PointerEvent) {
    const item = this.createPathItem(type, event)
    this.path.push(item)
    return item
  }

  getPath(type?: string) {
    return type ? this.path.filter((item) => item.type === type) : this.path
  }

  getLastOperation(type?: string) {
    return this.getPath(type).at(-1)
  }

  private createPathItem(type: string, event: PointerEvent): FingerPathItem {
    return {
      point: { x: event.clientX, y: event.clientY },
      timestamp: event.timeStamp,
      type,
      event
    }
  }
}

type FingerPathItem = {
  readonly point: { readonly x: number; readonly y: number }
  readonly timestamp: number
  readonly type: string
  readonly event: PointerEvent
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
  getPose?: (_element: HTMLElement) => Partial<Pose>
  setPose?: (_element: HTMLElement, _pose: Partial<Pose>) => void
  setPoseOnEnd?: (_element: HTMLElement, _pose: Partial<Pose>) => void
}
