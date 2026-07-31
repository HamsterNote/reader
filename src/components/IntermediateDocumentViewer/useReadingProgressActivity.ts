import { useCallback, useEffect, useRef, useState } from 'react'

const READING_PROGRESS_IDLE_DELAY_MS = 500

type ReadingProgressActivity = {
  readonly isActive: boolean
  readonly signalActivity: () => void
}

export function useReadingProgressActivity(): ReadingProgressActivity {
  const [isActive, setIsActive] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signalActivity = useCallback(() => {
    setIsActive(true)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)

    idleTimerRef.current = setTimeout(() => {
      setIsActive(false)
      idleTimerRef.current = null
    }, READING_PROGRESS_IDLE_DELAY_MS)
  }, [])

  useEffect(
    () => () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    },
    []
  )

  return { isActive, signalActivity }
}
