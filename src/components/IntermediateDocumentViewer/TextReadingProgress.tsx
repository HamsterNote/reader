import type { KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useState } from 'react'

type TextReadingProgressProps = {
  readonly currentPageNumber: number
  readonly isScrolling: boolean
  readonly maximumPageNumber: number
  readonly minimumPageNumber: number
  readonly pageCount: number
  readonly progress: number
  readonly onSeek: (progress: number) => void
}

const clampProgress = (progress: number): number =>
  Math.min(1, Math.max(0, progress))

export function TextReadingProgress({
  currentPageNumber,
  isScrolling,
  maximumPageNumber,
  minimumPageNumber,
  pageCount,
  progress,
  onSeek
}: TextReadingProgressProps) {
  const [activePointerId, setActivePointerId] = useState<number | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const seekFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const trackRect = event.currentTarget.getBoundingClientRect()
      if (trackRect.height <= 0) return
      onSeek(clampProgress((event.clientY - trackRect.top) / trackRect.height))
    },
    [onSeek]
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      event.currentTarget.setPointerCapture(event.pointerId)
      setActivePointerId(event.pointerId)
      seekFromPointer(event)
    },
    [seekFromPointer]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== activePointerId) return
      seekFromPointer(event)
    },
    [activePointerId, seekFromPointer]
  )

  const finishPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== activePointerId) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setActivePointerId(null)
    },
    [activePointerId]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const pageStep = 1 / Math.max(1, pageCount - 1)
      let nextProgress: number | null = null

      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        nextProgress = progress + pageStep
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        nextProgress = progress - pageStep
      } else if (event.key === 'Home') {
        nextProgress = 0
      } else if (event.key === 'End') {
        nextProgress = 1
      }

      if (nextProgress === null) return
      event.preventDefault()
      onSeek(clampProgress(nextProgress))
    },
    [onSeek, pageCount, progress]
  )

  const isVisible = isScrolling || activePointerId !== null || isFocused
  const safeProgress = clampProgress(progress)

  return (
    <div
      aria-label='文本阅读进度'
      aria-orientation='vertical'
      aria-valuemax={maximumPageNumber}
      aria-valuemin={minimumPageNumber}
      aria-valuenow={currentPageNumber}
      aria-valuetext={`第 ${currentPageNumber} 页`}
      className='hamster-reader__text-reading-progress'
      data-focused={isFocused}
      data-visible={isVisible}
      onBlur={() => setIsFocused(false)}
      onFocus={() => setIsFocused(true)}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      role='slider'
      tabIndex={0}
    >
      <span
        aria-hidden='true'
        className='hamster-reader__text-reading-progress-track'
      />
      <span
        className='hamster-reader__text-reading-progress-position'
        style={{
          transform: `translate3d(0, ${safeProgress * 100}%, 0)`
        }}
      >
        <span className='hamster-reader__text-reading-progress-thumb' />
        <span
          aria-hidden='true'
          className='hamster-reader__text-reading-progress-label'
          data-visible={isVisible}
        >
          第 {currentPageNumber} 页
        </span>
      </span>
    </div>
  )
}
