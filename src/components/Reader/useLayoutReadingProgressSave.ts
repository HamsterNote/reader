import { useCallback, useEffect, useRef } from 'react'

import type { ReaderBookmark, ReaderData } from '../../types/readerData'

const SAVE_DEBOUNCE_MS = 100
const SAVE_MAX_WAIT_MS = 1000

type PendingSave = {
  readonly baselineData: ReaderData | undefined
  readonly baselineOnDataChange: ((nextData: ReaderData) => void) | undefined
  readonly layoutReadingProgress: ReaderBookmark
  readonly resetKey: unknown
}

type CurrentSaveTarget = {
  readonly data: ReaderData | undefined
  readonly onDataChange: ((nextData: ReaderData) => void) | undefined
  readonly resetKey: unknown
}

export const useLayoutReadingProgressSave = (
  resetKey: unknown,
  data: ReaderData | undefined,
  onDataChange: ((nextData: ReaderData) => void) | undefined
): ((layoutReadingProgress: ReaderBookmark) => void) => {
  const pendingSaveRef = useRef<PendingSave | null>(null)
  const currentTargetRef = useRef<CurrentSaveTarget>({
    data,
    onDataChange,
    resetKey
  })
  currentTargetRef.current = { data, onDataChange, resetKey }
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
      layoutReadingProgress: pendingSave.layoutReadingProgress
    })
  }, [])

  const schedule = useCallback(
    (layoutReadingProgress: ReaderBookmark) => {
      if (
        pendingSaveRef.current !== null &&
        pendingSaveRef.current.resetKey !== resetKey
      ) {
        flush()
      }
      pendingSaveRef.current = {
        baselineData: currentTargetRef.current.data,
        baselineOnDataChange: currentTargetRef.current.onDataChange,
        layoutReadingProgress,
        resetKey
      }

      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS)

      if (maxWaitTimerRef.current === null) {
        maxWaitTimerRef.current = setTimeout(flush, SAVE_MAX_WAIT_MS)
      }
    },
    [flush, resetKey]
  )

  useEffect(() => {
    return () => {
      if (pendingSaveRef.current?.resetKey === resetKey) {
        flush()
      }
    }
  }, [flush, resetKey])

  return schedule
}
