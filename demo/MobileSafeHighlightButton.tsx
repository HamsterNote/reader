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

      // 移动端 Selection 会在 touchend 清掉原生选区，必须早于合成 click 执行高亮。
      event.preventDefault()
      event.stopPropagation()
      markNextClickAsHandled()
      selectionRef.current?.highlight()
    },
    [markNextClickAsHandled, selectionRef]
  )

  const handleClick = useCallback(() => {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false
      clearResetTimer()
      return
    }

    selectionRef.current?.highlight()
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
