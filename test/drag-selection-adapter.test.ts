import type { Options } from '@system-ui-js/multi-drag'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@system-ui-js/multi-drag', () => ({
  Drag: class MockedPackageDrag {},
  DragOperationType: {
    Start: 'start',
    Move: 'move',
    End: 'end',
    Inertial: 'inertial',
    InertialEnd: 'inertialEnd',
    AllEnd: 'allEnd'
  }
}))

const { DragOperationType } = await import('@system-ui-js/multi-drag')

import {
  createDragSelectionAdapter,
  type DragSelectionAdapterDragConstructor,
  type DragSelectionPointerDetail
} from '../src/components/selection/dragSelectionAdapter'

type DragOperationTypeValue =
  (typeof DragOperationType)[keyof typeof DragOperationType]

type FakeFinger = {
  pointerId: number
  getLastOperation: ReturnType<
    typeof vi.fn<
      () => { point: { x: number; y: number }; timestamp: number } | undefined
    >
  >
}

class FakeDrag {
  static readonly instances: FakeDrag[] = []

  readonly listeners = new Map<
    DragOperationTypeValue,
    Array<(fingers: FakeFinger[]) => void>
  >()
  readonly destroy = vi.fn()
  private currentOperationType: DragOperationTypeValue =
    DragOperationType.AllEnd

  constructor(
    readonly element: HTMLElement,
    readonly options?: Options
  ) {
    FakeDrag.instances.push(this)
  }

  addEventListener(
    type: DragOperationTypeValue,
    callback: (fingers: FakeFinger[]) => void
  ) {
    const callbacks = this.listeners.get(type) ?? []
    callbacks.push(callback)
    this.listeners.set(type, callbacks)
  }

  removeEventListener(
    type: DragOperationTypeValue,
    callback?: (fingers: FakeFinger[]) => void
  ) {
    if (!callback) {
      this.listeners.delete(type)
      return
    }

    const callbacks = this.listeners.get(type) ?? []
    this.listeners.set(
      type,
      callbacks.filter((listener) => listener !== callback)
    )
  }

  getCurrentOperationType() {
    return this.currentOperationType
  }

  emit(type: DragOperationTypeValue, fingers: FakeFinger[]) {
    this.currentOperationType = type
    this.listeners.get(type)?.forEach((listener) => {
      listener(fingers)
    })
  }
}

const FakeDragConstructor =
  FakeDrag as unknown as DragSelectionAdapterDragConstructor

const makeFinger = (
  pointerId: number,
  x: number,
  y: number,
  timestamp = 1
): FakeFinger => ({
  pointerId,
  getLastOperation: vi.fn(() => ({
    point: { x, y },
    timestamp
  }))
})

const makeAdapter = () => {
  const element = document.createElement('div')
  const events: string[] = []
  const adapter = createDragSelectionAdapter(element, {
    DragConstructor: FakeDragConstructor,
    onStart: (clientX, clientY) => events.push(`start:${clientX},${clientY}`),
    onMove: (clientX, clientY) => events.push(`move:${clientX},${clientY}`),
    onEnd: (clientX, clientY) => events.push(`end:${clientX},${clientY}`),
    onAllEnd: (clientX, clientY) => events.push(`allEnd:${clientX},${clientY}`)
  })
  const drag = FakeDrag.instances.at(-1)

  if (!drag) {
    throw new Error('Expected fake Drag to be constructed')
  }

  return { adapter, drag, element, events }
}

describe('createDragSelectionAdapter', () => {
  it('fires Start, Move, End, and AllEnd callbacks in order with primary coordinates', () => {
    const { adapter, drag, events } = makeAdapter()

    drag.emit(DragOperationType.Start, [makeFinger(10, 1, 2)])
    drag.emit(DragOperationType.Move, [makeFinger(10, 3, 4)])
    drag.emit(DragOperationType.End, [makeFinger(10, 5, 6)])
    drag.emit(DragOperationType.AllEnd, [makeFinger(10, 7, 8)])

    expect(events).toEqual(['start:1,2', 'move:3,4', 'end:5,6', 'allEnd:7,8'])
    expect(adapter.isActive()).toBe(false)
  })

  it('passes no-op pose callbacks so Drag never moves the element', () => {
    const { drag, element } = makeAdapter()

    expect(drag.options?.getPose?.(element)).toEqual({
      position: { x: 0, y: 0 },
      width: 0,
      height: 0
    })
    expect(() =>
      drag.options?.setPose?.(element, { position: { x: 8, y: 9 } })
    ).not.toThrow()
    expect(() =>
      drag.options?.setPoseOnEnd?.(element, { position: { x: 10, y: 11 } })
    ).not.toThrow()
    expect(element.style.transform).toBe('')
  })

  it('destroys the underlying Drag exactly once during cleanup', () => {
    const { adapter, drag } = makeAdapter()

    adapter.destroy()
    adapter.destroy()

    expect(drag.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys each instance once across React Strict Mode-style mount cycles', () => {
    const first = makeAdapter()
    first.adapter.destroy()

    const second = makeAdapter()
    second.adapter.destroy()

    expect(first.drag.destroy).toHaveBeenCalledTimes(1)
    expect(second.drag.destroy).toHaveBeenCalledTimes(1)
  })

  it('ignores secondary pointer lifecycle events while the primary pointer is active', () => {
    const { drag, events } = makeAdapter()

    drag.emit(DragOperationType.Start, [makeFinger(1, 10, 20)])
    drag.emit(DragOperationType.Start, [makeFinger(2, 30, 40)])
    drag.emit(DragOperationType.Move, [makeFinger(2, 31, 41)])
    drag.emit(DragOperationType.End, [makeFinger(2, 32, 42)])
    drag.emit(DragOperationType.Move, [makeFinger(1, 11, 21)])
    drag.emit(DragOperationType.End, [makeFinger(1, 12, 22)])
    drag.emit(DragOperationType.AllEnd, [makeFinger(1, 13, 23)])

    expect(events).toEqual([
      'start:10,20',
      'move:11,21',
      'end:12,22',
      'allEnd:13,23'
    ])
  })

  it('handles pointercancel-style End and AllEnd events gracefully', () => {
    const { adapter, drag, events } = makeAdapter()

    drag.emit(DragOperationType.Start, [makeFinger(1, 50, 60)])
    drag.emit(DragOperationType.End, [makeFinger(1, 51, 61)])
    drag.emit(DragOperationType.AllEnd, [makeFinger(1, 51, 61)])

    expect(events).toEqual(['start:50,60', 'end:51,61', 'allEnd:51,61'])
    expect(adapter.isActive()).toBe(false)
  })

  it('keeps legacy two-argument callbacks working without reading detail', () => {
    const element = document.createElement('div')
    const legacyStart = vi.fn((clientX: number, clientY: number) => {
      expect(`${clientX},${clientY}`).toBe('70,80')
    })

    createDragSelectionAdapter(element, {
      DragConstructor: FakeDragConstructor,
      onStart: legacyStart
    })

    const drag = FakeDrag.instances.at(-1)
    if (!drag) throw new Error('Expected fake Drag to be constructed')

    drag.emit(DragOperationType.Start, [makeFinger(7, 70, 80, 700)])

    expect(legacyStart).toHaveBeenCalledTimes(1)
  })

  it('passes pointer detail to Start, Move, End, and AllEnd callbacks', () => {
    const element = document.createElement('div')
    const details: DragSelectionPointerDetail[] = []
    const collectDetail = (
      _clientX: number,
      _clientY: number,
      detail?: DragSelectionPointerDetail
    ) => {
      if (!detail) throw new Error('Expected pointer detail')
      details.push(detail)
    }

    createDragSelectionAdapter(element, {
      DragConstructor: FakeDragConstructor,
      getPointerType: () => 'pen',
      onStart: collectDetail,
      onMove: collectDetail,
      onEnd: collectDetail,
      onAllEnd: collectDetail
    })

    const drag = FakeDrag.instances.at(-1)
    if (!drag) throw new Error('Expected fake Drag to be constructed')

    drag.emit(DragOperationType.Start, [makeFinger(42, 1, 2, 100)])
    drag.emit(DragOperationType.Move, [makeFinger(42, 3, 4, 200)])
    drag.emit(DragOperationType.End, [makeFinger(42, 5, 6, 300)])
    drag.emit(DragOperationType.AllEnd, [makeFinger(42, 7, 8, 400)])

    expect(details).toEqual([
      {
        pointerId: 42,
        activePointerCount: 1,
        pointerType: 'pen',
        timeStamp: 100
      },
      {
        pointerId: 42,
        activePointerCount: 1,
        pointerType: 'pen',
        timeStamp: 200
      },
      {
        pointerId: 42,
        activePointerCount: 1,
        pointerType: 'pen',
        timeStamp: 300
      },
      {
        pointerId: 42,
        activePointerCount: 1,
        pointerType: 'pen',
        timeStamp: 400
      }
    ])
  })

  it('calls getPointerType with the current primary pointer id', () => {
    const element = document.createElement('div')
    const getPointerType = vi.fn((pointerId: number) => `type-${pointerId}`)
    const onStart = vi.fn(
      (
        _clientX: number,
        _clientY: number,
        detail?: DragSelectionPointerDetail
      ) => {
        expect(detail?.pointerType).toBe('type-13')
      }
    )

    createDragSelectionAdapter(element, {
      DragConstructor: FakeDragConstructor,
      getPointerType,
      onStart
    })

    const drag = FakeDrag.instances.at(-1)
    if (!drag) throw new Error('Expected fake Drag to be constructed')

    drag.emit(DragOperationType.Start, [makeFinger(13, 11, 12, 130)])

    expect(getPointerType).toHaveBeenCalledWith(13)
  })

  it('reports activePointerCount as fingers change during multi-touch', () => {
    const element = document.createElement('div')
    const counts: number[] = []
    const onMove = vi.fn(
      (
        _clientX: number,
        _clientY: number,
        detail?: DragSelectionPointerDetail
      ) => {
        if (!detail) throw new Error('Expected pointer detail')
        counts.push(detail.activePointerCount)
      }
    )

    createDragSelectionAdapter(element, {
      DragConstructor: FakeDragConstructor,
      onStart: () => {},
      onMove
    })

    const drag = FakeDrag.instances.at(-1)
    if (!drag) throw new Error('Expected fake Drag to be constructed')

    drag.emit(DragOperationType.Start, [makeFinger(1, 10, 20, 100)])
    drag.emit(DragOperationType.Move, [
      makeFinger(1, 11, 21, 110),
      makeFinger(2, 30, 40, 111)
    ])
    drag.emit(DragOperationType.Move, [makeFinger(1, 12, 22, 120)])

    expect(counts).toEqual([2, 1])
  })
})
