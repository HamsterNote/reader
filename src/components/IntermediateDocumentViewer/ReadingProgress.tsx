import type { KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReaderSelectionRange } from '../../types/selection'
import { ReadingProgressHighlights } from './ReadingProgressHighlights'

type CommonReadingProgressProps = {
  readonly currentPageNumber: number
  readonly highlightColor?: string
  readonly insetBottom?: number
  readonly insetTop?: number
  readonly isMoving: boolean
  readonly onSeekPage: (pageNumber: number) => void
  readonly pageNumbers: readonly number[]
  readonly ranges: readonly ReaderSelectionRange[]
}

type TextReadingProgressProps = CommonReadingProgressProps & {
  readonly mode: 'text'
}

type LayoutReadingProgressProps = CommonReadingProgressProps & {
  readonly mode: 'layout'
  readonly baseImagesByPageNumber: ReadonlyMap<number, string>
  readonly pageSizesByPageNumber: ReadonlyMap<
    number,
    { readonly height: number; readonly width: number }
  >
  readonly onPreviewPageVisibilityChange?: (
    pageNumber: number,
    isVisible: boolean
  ) => void
  readonly previewEnabled: boolean
}

type ReadingProgressProps =
  | LayoutReadingProgressProps
  | TextReadingProgressProps

const clamp = (value: number, maximum: number): number =>
  Math.min(maximum, Math.max(0, value))

const getPagePositionPercent = (
  pageNumber: number,
  pageNumbers: readonly number[]
): number => {
  if (pageNumbers.length <= 1) return 0
  const pageIndex = Math.max(0, pageNumbers.indexOf(pageNumber))
  return (pageIndex / (pageNumbers.length - 1)) * 100
}

const canStartPointerDrag = (
  event: PointerEvent<HTMLDivElement>,
  activePointerId: number | null
): boolean => activePointerId === null && event.isPrimary && event.button <= 0

const getLayoutPreview = (
  props: ReadingProgressProps,
  pageNumber: number | null
) => {
  if (props.mode !== 'layout' || !props.previewEnabled || pageNumber === null) {
    return undefined
  }
  return {
    image: props.baseImagesByPageNumber.get(pageNumber),
    size: props.pageSizesByPageNumber.get(pageNumber)
  }
}

export function ReadingProgress(props: ReadingProgressProps) {
  const {
    currentPageNumber,
    highlightColor,
    insetBottom,
    insetTop,
    isMoving,
    onSeekPage,
    pageNumbers,
    ranges
  } = props
  const railRef = useRef<HTMLDivElement>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const activePointerTypeRef = useRef<PointerEvent['pointerType'] | null>(null)
  const [isTouchDragging, setIsTouchDragging] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [previewPageNumber, setPreviewPageNumber] = useState<number | null>(
    null
  )
  const layoutPreview = getLayoutPreview(props, previewPageNumber)
  const hasLayoutPreview = Boolean(layoutPreview?.image)
  const onPreviewPageVisibilityChange =
    props.mode === 'layout' && props.previewEnabled
      ? props.onPreviewPageVisibilityChange
      : undefined

  const resolvePageFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>): number | null => {
      const trackRect = event.currentTarget.getBoundingClientRect()
      if (trackRect.height <= 0 || pageNumbers.length === 0) return null

      const progress = clamp(
        (event.clientY - trackRect.top) / trackRect.height,
        1
      )
      const pageIndex = Math.round(progress * (pageNumbers.length - 1))
      return pageNumbers[pageIndex] ?? null
    },
    [pageNumbers]
  )

  const finishPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (event.pointerId !== activePointerIdRef.current) return

      const pointerType = activePointerTypeRef.current
      const pageNumber = resolvePageFromPointer(event)
      if (commit && pageNumber !== null) onSeekPage(pageNumber)
      activePointerIdRef.current = null
      activePointerTypeRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setIsTouchDragging(false)
      setPreviewPageNumber(pointerType === 'mouse' ? pageNumber : null)
    },
    [onSeekPage, resolvePageFromPointer]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = Math.max(0, pageNumbers.indexOf(currentPageNumber))
      let nextIndex: number | null = null

      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        nextIndex = currentIndex + 1
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        nextIndex = currentIndex - 1
      } else if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = pageNumbers.length - 1
      }

      if (nextIndex === null || pageNumbers.length === 0) return
      event.preventDefault()
      const pageNumber = pageNumbers[clamp(nextIndex, pageNumbers.length - 1)]
      if (pageNumber !== undefined) onSeekPage(pageNumber)
    },
    [currentPageNumber, onSeekPage, pageNumbers]
  )

  useEffect(() => {
    if (previewPageNumber === null || !onPreviewPageVisibilityChange) {
      return
    }

    onPreviewPageVisibilityChange(previewPageNumber, true)
    return () => {
      onPreviewPageVisibilityChange(previewPageNumber, false)
    }
  }, [onPreviewPageVisibilityChange, previewPageNumber])

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return

    const handleWheel = (event: globalThis.WheelEvent) => {
      const scrollViewport = rail.parentElement?.querySelector<HTMLElement>(
        '.virtual-paper-wrapper, .hamster-reader__intermediate-text-viewer, .hamster-reader__intermediate-text-scroll'
      )
      if (!scrollViewport) return

      event.preventDefault()
      if (
        (event.ctrlKey || event.metaKey) &&
        scrollViewport.classList.contains('virtual-paper-wrapper')
      ) {
        scrollViewport.dispatchEvent(
          new globalThis.WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
            ctrlKey: event.ctrlKey,
            deltaMode: event.deltaMode,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            metaKey: event.metaKey
          })
        )
        return
      }

      scrollViewport.scrollBy({
        behavior: 'auto',
        left: event.deltaX,
        top: event.deltaY
      })
    }

    rail.addEventListener('wheel', handleWheel, { passive: false })
    return () => rail.removeEventListener('wheel', handleWheel)
  }, [])

  const displayedPageNumber = previewPageNumber ?? currentPageNumber
  const feedbackPositionPercent = getPagePositionPercent(
    displayedPageNumber,
    pageNumbers
  )
  const previewHeight = hasLayoutPreview
    ? 104 *
        (layoutPreview?.size
          ? layoutPreview.size.height / layoutPreview.size.width
          : 4 / 3) +
      2
    : 24
  const feedbackCenterInset = previewHeight / 2
  const feedbackPositionTop = `clamp(${feedbackCenterInset}px, ${feedbackPositionPercent}%, calc(100% - ${feedbackCenterInset}px))`
  const isFeedbackVisible = isMoving || previewPageNumber !== null || isFocused

  return (
    <div
      ref={railRef}
      aria-label={props.mode === 'layout' ? '版面阅读进度' : '文本阅读进度'}
      aria-orientation='vertical'
      aria-valuemax={pageNumbers.at(-1)}
      aria-valuemin={pageNumbers[0]}
      aria-valuenow={currentPageNumber}
      aria-valuetext={`第 ${currentPageNumber} 页`}
      className='hamster-reader__reading-progress'
      data-focused={isFocused}
      data-mode={props.mode}
      data-pointer-type={isTouchDragging ? 'touch' : undefined}
      data-visible={isFeedbackVisible}
      style={{ bottom: insetBottom, top: insetTop }}
      onBlur={() => setIsFocused(false)}
      onFocus={() => setIsFocused(true)}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={(event) => {
        if (event.pointerId !== activePointerIdRef.current) return
        activePointerIdRef.current = null
        activePointerTypeRef.current = null
        setIsTouchDragging(false)
        setPreviewPageNumber(null)
      }}
      onPointerCancel={(event) => finishPointer(event, false)}
      onPointerDown={(event) => {
        if (!canStartPointerDrag(event, activePointerIdRef.current)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.pointerType !== 'touch') {
          event.currentTarget.focus({ preventScroll: true })
        }
        activePointerIdRef.current = event.pointerId
        activePointerTypeRef.current = event.pointerType
        setIsTouchDragging(event.pointerType === 'touch')
        setPreviewPageNumber(resolvePageFromPointer(event))
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerLeave={() => {
        if (activePointerIdRef.current === null) setPreviewPageNumber(null)
      }}
      onPointerMove={(event) => {
        const activeId = activePointerIdRef.current
        if (
          activeId === event.pointerId ||
          (activeId === null && event.pointerType === 'mouse')
        ) {
          setPreviewPageNumber(resolvePageFromPointer(event))
        }
      }}
      onPointerUp={(event) => finishPointer(event, true)}
      role='slider'
      tabIndex={0}
    >
      <span
        aria-hidden='true'
        className='hamster-reader__reading-progress-track'
      />
      <ReadingProgressHighlights
        highlightColor={highlightColor}
        pageNumbers={pageNumbers}
        ranges={ranges}
      />
      <span
        className='hamster-reader__reading-progress-position'
        data-page-number={displayedPageNumber}
        style={{
          top: feedbackPositionTop
        }}
      >
        <span className='hamster-reader__reading-progress-thumb' />
      </span>
      <span
        className='hamster-reader__reading-progress-feedback'
        data-has-preview={hasLayoutPreview}
        data-page-number={displayedPageNumber}
        style={{
          top: feedbackPositionTop
        }}
      >
        <span
          className='hamster-reader__reading-progress-feedback-content'
          data-visible={isFeedbackVisible}
        >
          <span
            aria-hidden='true'
            className='hamster-reader__reading-progress-label'
            data-visible={isFeedbackVisible}
          >
            第 {displayedPageNumber} 页
          </span>
          {hasLayoutPreview ? (
            <span
              aria-hidden='true'
              className='hamster-reader__reading-progress-preview'
              style={
                layoutPreview?.size
                  ? {
                      aspectRatio: `${layoutPreview.size.width}/${layoutPreview.size.height}`
                    }
                  : undefined
              }
            >
              <img
                alt=''
                data-testid={`reading-progress-preview-${previewPageNumber}`}
                draggable={false}
                src={layoutPreview?.image}
              />
            </span>
          ) : null}
        </span>
      </span>
    </div>
  )
}
