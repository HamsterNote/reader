import { useCallback, useEffect, useRef } from 'react'

import type {
  ReaderBookmark,
  ReaderData,
  ReaderTextReadingProgress
} from '../../types/readerData'

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
): ((progress: ReadingProgressByField[Field]) => void) => {
  const pendingSaveRef = useRef<PendingSave<Field> | null>(null)
  const currentTargetRef = useRef<SaveTarget>(target)
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
    saveTarget.onDataChange?.({
      ...saveTarget.data,
      [field]: pendingSave.progress
    })
  }, [field])

  const schedule = useCallback(
    (progress: ReadingProgressByField[Field]) => {
      if (
        pendingSaveRef.current !== null &&
        pendingSaveRef.current.resetKey !== target.resetKey
      ) {
        flush()
      }
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

  return schedule
}

export const useLayoutReadingProgressSave = (
  resetKey: unknown,
  data: ReaderData | undefined,
  onDataChange: ((nextData: ReaderData) => void) | undefined
): ((layoutReadingProgress: ReaderBookmark) => void) =>
  useReadingProgressSave('layoutReadingProgress', {
    data,
    onDataChange,
    resetKey
  })

export const useTextReadingProgressSave = (
  resetKey: unknown,
  data: ReaderData | undefined,
  onDataChange: ((nextData: ReaderData) => void) | undefined
): ((textReadingProgress: ReaderTextReadingProgress) => void) =>
  useReadingProgressSave('textReadingProgress', {
    data,
    onDataChange,
    resetKey
  })
