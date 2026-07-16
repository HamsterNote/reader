import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  type AnnotationHistoryApplyTargetResult,
  type AnnotationHistoryController,
  useAnnotationHistory
} from '../src/components/Reader/useAnnotationHistory'
import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryValue,
  ReaderSelectionRange
} from '../src/types/selection'

const makeRange = (id: string, text: string): ReaderSelectionRange => ({
  id,
  text,
  start: { selectionId: 'page-1', offset: 0 },
  end: { selectionId: 'page-1', offset: text.length },
  createdAt: id.length,
  rectsBySelectionId: {
    'page-1': [{ x: 1, y: 2, width: 3, height: 4 }]
  }
})

const makeValue = (
  ranges: ReaderSelectionRange[],
  selectedRangeId: string | null = null
): ReaderAnnotationHistoryValue => ({
  ranges,
  rects: [],
  selectedRangeId,
  selectedRectId: null
})

const initialValue = makeValue([])
const firstValue = makeValue([makeRange('r1', 'one')], 'r1')
const secondValue = makeValue(
  [makeRange('r1', 'one'), makeRange('r2', 'two')],
  'r2'
)

function renderHistory(
  enabled = true,
  onChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
) {
  return renderHook(() =>
    useAnnotationHistory({
      enabled,
      initialValue,
      onChange
    })
  )
}

describe('useAnnotationHistory', () => {
  it('undoes and redoes two checkpoints in stack order', () => {
    const onChange = vi.fn()
    const { result } = renderHistory(true, onChange)

    act(() => {
      result.current.setCheckpoint(firstValue, 'highlight')
    })
    act(() => {
      result.current.setCheckpoint(secondValue, 'highlight')
    })

    expect(result.current.getStatus()).toMatchObject({
      canUndo: true,
      canRedo: false,
      pastCount: 2,
      futureCount: 0
    })
    expect(result.current.getPresent()).toEqual(secondValue)

    let firstUndo: AnnotationHistoryApplyTargetResult | undefined
    act(() => {
      firstUndo = result.current.undo()
    })
    expect(firstUndo).toEqual({
      applied: true,
      source: 'undo',
      target: firstValue,
      detail: {
        source: 'undo',
        status: {
          enabled: true,
          canUndo: true,
          canRedo: true,
          pastCount: 1,
          futureCount: 1
        }
      }
    })
    expect(result.current.getPresent()).toEqual(firstValue)

    let secondUndo: AnnotationHistoryApplyTargetResult | undefined
    act(() => {
      secondUndo = result.current.undo()
    })
    expect(secondUndo?.target).toEqual(initialValue)
    expect(result.current.getPresent()).toEqual(initialValue)

    let redo: AnnotationHistoryApplyTargetResult | undefined
    act(() => {
      redo = result.current.redo()
    })
    expect(redo?.target).toEqual(firstValue)
    expect(result.current.getPresent()).toEqual(firstValue)
    expect(onChange).toHaveBeenLastCalledWith(firstValue, redo?.detail)
  })

  it('does not add a checkpoint for structurally equal snapshots', () => {
    const { result } = renderHistory()

    act(() => {
      result.current.setCheckpoint(firstValue, 'highlight')
    })
    act(() => {
      result.current.setCheckpoint(
        makeValue([makeRange('r1', 'one')], 'r1'),
        'highlight'
      )
    })

    expect(result.current.getStatus().pastCount).toBe(1)
    expect(result.current.getPresent()).toEqual(firstValue)
  })

  it('syncs selection-only present updates without creating checkpoints', () => {
    const { result } = renderHistory()
    const selectedValue = makeValue([], 'r1')

    act(() => {
      result.current.syncPresent(selectedValue, 'select')
    })

    expect(result.current.getPresent()).toEqual(selectedValue)
    expect(result.current.getStatus()).toMatchObject({
      canUndo: false,
      canRedo: false,
      pastCount: 0,
      futureCount: 0
    })
  })

  it('silently syncs present state without notifying the host', () => {
    const onChange = vi.fn()
    const { result } = renderHistory(true, onChange)

    act(() => {
      result.current.setCheckpoint(firstValue, 'highlight')
    })
    const checkpointCallCount = onChange.mock.calls.length

    act(() => {
      result.current.syncSilent(secondValue)
    })

    expect(result.current.getPresent()).toEqual(secondValue)
    expect(result.current.getStatus()).toMatchObject({
      canUndo: true,
      canRedo: false,
      pastCount: 1,
      futureCount: 0
    })
    expect(onChange).toHaveBeenCalledTimes(checkpointCallCount)
  })

  it('clears undo and redo stacks on reset', () => {
    const { result } = renderHistory()

    act(() => {
      result.current.setCheckpoint(firstValue, 'highlight')
    })
    act(() => {
      result.current.undo()
    })
    act(() => {
      result.current.reset(secondValue, 'reset')
    })

    expect(result.current.getPresent()).toEqual(secondValue)
    expect(result.current.getStatus()).toMatchObject({
      canUndo: false,
      canRedo: false,
      pastCount: 0,
      futureCount: 0
    })
  })

  it('exposes the precomputed target snapshot to guarded apply callbacks', () => {
    const applied: ReaderAnnotationHistoryValue[] = []
    const { result } = renderHistory()

    act(() => {
      result.current.setCheckpoint(firstValue, 'highlight')
    })
    act(() => {
      result.current.setCheckpoint(secondValue, 'highlight')
    })

    let applyResult: AnnotationHistoryApplyTargetResult | undefined
    act(() => {
      applyResult = result.current.applyTarget(
        'undo',
        (target: ReaderAnnotationHistoryValue) => {
          applied.push(target)
        }
      )
    })

    expect(applyResult?.target).toEqual(firstValue)
    expect(applied).toEqual([firstValue])
    expect(result.current.getPresent()).toEqual(firstValue)
  })

  it('no-ops while disabled', () => {
    const onChange = vi.fn()
    const { result } = renderHistory(false, onChange)

    let undoResult: AnnotationHistoryApplyTargetResult | undefined
    act(() => {
      result.current.setCheckpoint(firstValue, 'highlight')
      result.current.syncPresent(secondValue, 'external-sync')
      result.current.reset(secondValue, 'reset')
      undoResult = result.current.undo()
    })

    expect(result.current.getStatus()).toEqual({
      enabled: false,
      canUndo: false,
      canRedo: false,
      pastCount: 0,
      futureCount: 0
    })
    expect(result.current.getPresent()).toEqual(initialValue)
    expect(undoResult).toEqual({ applied: false, source: 'undo' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('returns undefined targets when history stacks are empty', () => {
    const { result } = renderHistory()
    const controller: AnnotationHistoryController = result.current

    expect(controller.getTarget('undo')).toBeUndefined()
    expect(controller.getTarget('redo')).toBeUndefined()
    expect(controller.undo()).toEqual({ applied: false, source: 'undo' })
    expect(controller.redo()).toEqual({ applied: false, source: 'redo' })
  })
})
