import type { ReaderSelectionRef } from '@hamster-note/reader'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'

const highlightButtonStyle: CSSProperties = {
  cursor: 'pointer',
  background: 'transparent',
  color: '#fff',
  border: 'none'
}

export type MobileSafeHighlightButtonProps = {
  selectionRef: {
    readonly current: ReaderSelectionRef | null
  }
}

export function MobileSafeHighlightButton({
  selectionRef
}: MobileSafeHighlightButtonProps) {
  const skipNextClickRef = useRef(false)
  const resetTimerRef = useRef<number | null>(null)

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current === null) return
    window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = null
  }, [])

  useEffect(() => clearResetTimer, [clearResetTimer])

  const markNextClickAsHandled = useCallback(() => {
    skipNextClickRef.current = true
    clearResetTimer()
    resetTimerRef.current = window.setTimeout(() => {
      skipNextClickRef.current = false
      resetTimerRef.current = null
    }, 500)
  }, [clearResetTimer])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse') return

      event.preventDefault()
      event.stopPropagation()
      markNextClickAsHandled()
      selectionRef.current?.confirm()
    },
    [markNextClickAsHandled, selectionRef]
  )

  const handleClick = useCallback(() => {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false
      clearResetTimer()
      return
    }

    selectionRef.current?.confirm()
  }, [clearResetTimer, selectionRef])

  return (
    <button
      type='button'
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      style={highlightButtonStyle}
    >
      高亮
    </button>
  )
}
