import { useCallback } from 'react'
import useUndo from 'use-undo'

import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryChangeSource,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue
} from '../../types/selection'

export type AnnotationHistoryApplySource = 'undo' | 'redo'

export type AnnotationHistoryApplyTargetResult =
  | {
      readonly applied: true
      readonly source: AnnotationHistoryApplySource
      readonly target: ReaderAnnotationHistoryValue
      readonly detail: ReaderAnnotationHistoryChangeDetail
    }
  | {
      readonly applied: false
      readonly source: AnnotationHistoryApplySource
      readonly target?: undefined
      readonly detail?: undefined
    }

export type AnnotationHistoryController = {
  readonly setCheckpoint: (
    next: ReaderAnnotationHistoryValue,
    source: ReaderAnnotationHistoryChangeSource
  ) => void
  readonly syncPresent: (
    next: ReaderAnnotationHistoryValue,
    source: ReaderAnnotationHistoryChangeSource
  ) => void
  readonly syncSilent: (next: ReaderAnnotationHistoryValue) => void
  readonly reset: (
    next: ReaderAnnotationHistoryValue,
    source: ReaderAnnotationHistoryChangeSource
  ) => void
  readonly undo: () => AnnotationHistoryApplyTargetResult
  readonly redo: () => AnnotationHistoryApplyTargetResult
  readonly applyTarget: (
    source: AnnotationHistoryApplySource,
    apply: (target: ReaderAnnotationHistoryValue) => void
  ) => AnnotationHistoryApplyTargetResult
  readonly applyTargetSilently: (
    source: AnnotationHistoryApplySource
  ) => AnnotationHistoryApplyTargetResult
  readonly getStatus: () => ReaderAnnotationHistoryStatus
  readonly getPresent: () => ReaderAnnotationHistoryValue
  readonly getTarget: (
    source: AnnotationHistoryApplySource
  ) => ReaderAnnotationHistoryValue | undefined
}

type UseAnnotationHistoryOptions = {
  readonly enabled: boolean
  readonly initialValue: ReaderAnnotationHistoryValue
  readonly onChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
}

const isSameAnnotationSnapshot = (
  left: ReaderAnnotationHistoryValue,
  right: ReaderAnnotationHistoryValue
) => JSON.stringify(left) === JSON.stringify(right)

const makeStatus = (
  enabled: boolean,
  pastCount: number,
  futureCount: number
): ReaderAnnotationHistoryStatus => ({
  enabled,
  canUndo: enabled && pastCount > 0,
  canRedo: enabled && futureCount > 0,
  pastCount: enabled ? pastCount : 0,
  futureCount: enabled ? futureCount : 0
})

export function useAnnotationHistory({
  enabled,
  initialValue,
  onChange
}: UseAnnotationHistoryOptions): AnnotationHistoryController {
  const [history, actions] = useUndo<ReaderAnnotationHistoryValue>(
    initialValue,
    { useCheckpoints: true }
  )

  const getStatus = useCallback(
    () => makeStatus(enabled, history.past.length, history.future.length),
    [enabled, history.future.length, history.past.length]
  )

  const notifyChange = useCallback(
    (
      next: ReaderAnnotationHistoryValue,
      source: ReaderAnnotationHistoryChangeSource,
      status: ReaderAnnotationHistoryStatus
    ) => {
      onChange?.(next, { source, status })
    },
    [onChange]
  )

  const getPresent = useCallback(() => history.present, [history.present])

  const getTarget = useCallback(
    (source: AnnotationHistoryApplySource) => {
      if (!enabled) {
        return undefined
      }

      if (source === 'undo') {
        return history.past.at(-1)
      }

      return history.future[0]
    },
    [enabled, history.future, history.past]
  )

  const setCheckpoint = useCallback(
    (
      next: ReaderAnnotationHistoryValue,
      source: ReaderAnnotationHistoryChangeSource
    ) => {
      if (!enabled || isSameAnnotationSnapshot(history.present, next)) {
        return
      }

      const status = makeStatus(enabled, history.past.length + 1, 0)

      actions.set(next, true)
      notifyChange(next, source, status)
    },
    [actions, enabled, history.past.length, history.present, notifyChange]
  )

  const syncPresent = useCallback(
    (
      next: ReaderAnnotationHistoryValue,
      source: ReaderAnnotationHistoryChangeSource
    ) => {
      if (!enabled || isSameAnnotationSnapshot(history.present, next)) {
        return
      }

      const status = makeStatus(enabled, history.past.length, 0)

      actions.set(next, false)
      notifyChange(next, source, status)
    },
    [actions, enabled, history.past.length, history.present, notifyChange]
  )

  const reset = useCallback(
    (
      next: ReaderAnnotationHistoryValue,
      source: ReaderAnnotationHistoryChangeSource
    ) => {
      if (!enabled) {
        return
      }

      const status = makeStatus(enabled, 0, 0)

      actions.reset(next)
      notifyChange(next, source, status)
    },
    [actions, enabled, notifyChange]
  )

  const syncSilent = useCallback(
    (next: ReaderAnnotationHistoryValue) => {
      if (!enabled || isSameAnnotationSnapshot(history.present, next)) {
        return
      }

      actions.set(next, false)
    },
    [actions, enabled, history.present]
  )

  const undo = useCallback((): AnnotationHistoryApplyTargetResult => {
    const target = getTarget('undo')

    if (!target) {
      return { applied: false, source: 'undo' }
    }

    const status = makeStatus(
      enabled,
      Math.max(0, history.past.length - 1),
      history.future.length + 1
    )
    const detail = {
      source: 'undo',
      status
    } satisfies ReaderAnnotationHistoryChangeDetail

    actions.undo()
    notifyChange(target, 'undo', status)

    return { applied: true, source: 'undo', target, detail }
  }, [
    actions,
    enabled,
    getTarget,
    history.future.length,
    history.past.length,
    notifyChange
  ])

  const redo = useCallback((): AnnotationHistoryApplyTargetResult => {
    const target = getTarget('redo')

    if (!target) {
      return { applied: false, source: 'redo' }
    }

    const status = makeStatus(
      enabled,
      history.past.length + 1,
      Math.max(0, history.future.length - 1)
    )
    const detail = {
      source: 'redo',
      status
    } satisfies ReaderAnnotationHistoryChangeDetail

    actions.redo()
    notifyChange(target, 'redo', status)

    return { applied: true, source: 'redo', target, detail }
  }, [
    actions,
    enabled,
    getTarget,
    history.future.length,
    history.past.length,
    notifyChange
  ])

  const applyTargetSilently = useCallback(
    (
      source: AnnotationHistoryApplySource
    ): AnnotationHistoryApplyTargetResult => {
      const target = getTarget(source)

      if (!target) {
        return { applied: false, source }
      }

      const isUndo = source === 'undo'
      const status = makeStatus(
        enabled,
        isUndo ? Math.max(0, history.past.length - 1) : history.past.length + 1,
        isUndo
          ? history.future.length + 1
          : Math.max(0, history.future.length - 1)
      )
      const detail = {
        source,
        status
      } satisfies ReaderAnnotationHistoryChangeDetail

      if (isUndo) {
        actions.undo()
      } else {
        actions.redo()
      }

      return { applied: true, source, target, detail }
    },
    [actions, enabled, getTarget, history.future.length, history.past.length]
  )

  const applyTarget = useCallback(
    (
      source: AnnotationHistoryApplySource,
      apply: (target: ReaderAnnotationHistoryValue) => void
    ) => {
      const result = source === 'undo' ? undo() : redo()

      if (result.applied) {
        apply(result.target)
      }

      return result
    },
    [redo, undo]
  )

  return {
    setCheckpoint,
    syncPresent,
    syncSilent,
    reset,
    undo,
    redo,
    applyTarget,
    applyTargetSilently,
    getStatus,
    getPresent,
    getTarget
  }
}
