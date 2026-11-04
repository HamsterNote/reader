import { useCallback, useEffect, useMemo, useRef } from 'react'

import type {
  ReaderBookmark,
  ReaderData,
  ReaderTextReadingProgress
} from '../../types/readerData'

export type ProgressSave<T> = ((progress: T) => void) & { flush: () => void }

const positionKey = (value: unknown): string => {
  if (!value || typeof value !== 'object') return ''
  const v = value as Record<string, unknown>
  const anchor = (v.anchor ?? v) as Record<string, unknown>
  return 'offset' in anchor
    ? `${anchor.pageNumber}:${anchor.textId}:${anchor.offset}`
    : `${v.pageNumber ?? v.currentPageNumber}:${v.verticalPercentage ?? 0}`
}

const SAVE_DEBOUNCE_MS = 100
const SAVE_MAX_WAIT_MS = 1000

type ReadingProgressField = 'layoutReadingProgress' | 'textReadingProgress'

type ReadingProgressByField = {
  readonly layoutReadingProgress: ReaderBookmark
  readonly textReadingProgress: ReaderTextReadingProgress
}

type SaveTarget = {
  readonly data: ReaderData | undefined
  readonly onDataChange: ((nextData: ReaderData) => void) | undefined
  readonly resetKey: unknown
}

type PendingSave<Field extends ReadingProgressField> = {
  readonly baselineData: ReaderData | undefined
  readonly baselineOnDataChange: ((nextData: ReaderData) => void) | undefined
  readonly progress: ReadingProgressByField[Field]
  readonly resetKey: unknown
}

const useReadingProgressSave = <Field extends ReadingProgressField>(
  field: Field,
  target: SaveTarget
): ProgressSave<ReadingProgressByField[Field]> => {
  const committed = useRef({
    resetKey: target.resetKey,
    key: positionKey(target.data?.[field])
  })
  const pendingSaveRef = useRef<PendingSave<Field> | null>(null)
  const currentTargetRef = useRef<SaveTarget>(target)
  // Keep local saves deduplicated before their echo arrives, but accept a new
  // supplied position as the baseline (including mode handoffs and removal).
  if (
    currentTargetRef.current.resetKey !== target.resetKey ||
    currentTargetRef.current.data?.[field] !== target.data?.[field]
  ) {
    committed.current = {
      resetKey: target.resetKey,
      key: positionKey(target.data?.[field])
    }
  }
  currentTargetRef.current = target
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (maxWaitTimerRef.current !== null) {
      clearTimeout(maxWaitTimerRef.current)
      maxWaitTimerRef.current = null
    }

    const pendingSave = pendingSaveRef.current
    pendingSaveRef.current = null
    if (!pendingSave) return

    const currentTarget = currentTargetRef.current
    const saveTarget =
      currentTarget.resetKey === pendingSave.resetKey
        ? currentTarget
        : {
            data: pendingSave.baselineData,
            onDataChange: pendingSave.baselineOnDataChange
          }
    if (currentTarget.resetKey === pendingSave.resetKey) {
      committed.current = {
        resetKey: pendingSave.resetKey,
        key: positionKey(pendingSave.progress)
      }
    }
    saveTarget.onDataChange?.({
      ...saveTarget.data,
      [field]: pendingSave.progress
    })
  }, [field])

  const schedule = useCallback(
    (progress: ReadingProgressByField[Field]) => {
      if (currentTargetRef.current.resetKey !== target.resetKey) return
      if (
        pendingSaveRef.current !== null &&
        pendingSaveRef.current.resetKey !== target.resetKey
      ) {
        flush()
      }
      const key = positionKey(progress)
      const pending = pendingSaveRef.current
      if (
        pending &&
        pending.resetKey === target.resetKey &&
        positionKey(pending.progress) === key
      )
        return
      if (
        !pendingSaveRef.current &&
        committed.current.resetKey === target.resetKey &&
        committed.current.key === key
      )
        return
      pendingSaveRef.current = {
        baselineData: currentTargetRef.current.data,
        baselineOnDataChange: currentTargetRef.current.onDataChange,
        progress,
        resetKey: target.resetKey
      }

      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS)

      if (maxWaitTimerRef.current === null) {
        maxWaitTimerRef.current = setTimeout(flush, SAVE_MAX_WAIT_MS)
      }
    },
    [flush, target.resetKey]
  )

  useEffect(() => {
    return () => {
      if (pendingSaveRef.current?.resetKey === target.resetKey) {
        flush()
      }
    }
  }, [flush, target.resetKey])

  return Object.assign(schedule, { flush })
}

export const useLayoutReadingProgressSave = (
  resetKey: unknown,
  data: ReaderData | undefined,
  onDataChange: ((nextData: ReaderData) => void) | undefined
): ProgressSave<ReaderBookmark> =>
  useReadingProgressSave('layoutReadingProgress', {
    data,
    onDataChange,
    resetKey
  })

export const useTextReadingProgressSave = (
  resetKey: unknown,
  data: ReaderData | undefined,
  onDataChange: ((nextData: ReaderData) => void) | undefined
): ProgressSave<ReaderTextReadingProgress> =>
  useReadingProgressSave('textReadingProgress', {
    data,
    onDataChange,
    resetKey
  })

/** Share the latest snapshot across both queues, even before React echoes a save. */
export function useReadingProgressSaves(
  resetKey: unknown,
  data: ReaderData | undefined,
  onDataChange: ((data: ReaderData) => void) | undefined
) {
  const scope = useMemo(
    () => ({ supplied: data, data, onDataChange }),
    [resetKey]
  )
  if (scope.supplied !== data) {
    scope.supplied = data
    scope.data = data
  }
  scope.onDataChange = onDataChange
  const layoutChanged = useCallback(
    (next: ReaderData) => {
      scope.data = {
        ...scope.data,
        layoutReadingProgress: next.layoutReadingProgress
      }
      scope.onDataChange?.(scope.data)
    },
    [scope]
  )
  const textChanged = useCallback(
    (next: ReaderData) => {
      scope.data = {
        ...scope.data,
        textReadingProgress: next.textReadingProgress
      }
      scope.onDataChange?.(scope.data)
    },
    [scope]
  )
  const layout = useLayoutReadingProgressSave(resetKey, data, layoutChanged)
  const text = useTextReadingProgressSave(resetKey, data, textChanged)
  return {
    resetKey,
    layout,
    text,
    getData: () => scope.data,
    flush: () => {
      layout.flush()
      text.flush()
    }
  }
}
