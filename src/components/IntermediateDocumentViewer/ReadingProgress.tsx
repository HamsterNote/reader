import { Loading } from '@hamster-note/components'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReaderSelectionRange } from '../../types/selection'
import { ReadingProgressHighlights } from './ReadingProgressHighlights'
import {
  resolveTextPageFromProgress,
  resolveTextPageSegmentPosition
} from './textPageWindow'

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
  readonly onUserScrollIntent?: () => void
  readonly pageProgress: number
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

// 光标在轨道内的原始进度（0..1），不做页码量化，
// 供位置指示横线平滑跟随光标使用。
const resolveProgressFromPointer = (
  event: PointerEvent<HTMLDivElement>
): number | null => {
  const trackRect = event.currentTarget.getBoundingClientRect()
  if (trackRect.height <= 0) return null
  return clamp((event.clientY - trackRect.top) / trackRect.height, 1)
}

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

const getTextPageProgress = (
  props: ReadingProgressProps,
  previewPageNumber: number | null
): number => {
  if (props.mode !== 'text') return 0
  return previewPageNumber === null ? props.pageProgress : 0.5
}

const getPointerPositionPercent = (
  props: ReadingProgressProps,
  displayedPageNumber: number,
  pointerProgress: number | null,
  previewPageNumber: number | null
): number => {
  if (pointerProgress !== null) return pointerProgress * 100
  if (props.mode === 'text') {
    return resolveTextPageSegmentPosition(
      props.pageNumbers,
      displayedPageNumber,
      getTextPageProgress(props, previewPageNumber)
    )
  }
  return getPagePositionPercent(displayedPageNumber, props.pageNumbers)
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
  // hover/拖拽时光标的原始轨道进度（0..1），null 表示光标不在轨道上。
  // 与量化后的 previewPageNumber 分开，保证位置指示横线平滑跟随光标。
  const [pointerProgress, setPointerProgress] = useState<number | null>(null)
  const layoutPreview = getLayoutPreview(props, previewPageNumber)
  const showsLayoutPreview = layoutPreview !== undefined
  const hasLayoutPreview = Boolean(layoutPreview?.image)
  const onPreviewPageVisibilityChange =
    props.mode === 'layout' && props.previewEnabled
      ? props.onPreviewPageVisibilityChange
      : undefined

  const resolvePageFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>): number | null => {
      const progress = resolveProgressFromPointer(event)
      if (progress === null || pageNumbers.length === 0) return null

      if (props.mode === 'text') {
        return resolveTextPageFromProgress(pageNumbers, progress)
      }

      const pageIndex = Math.round(progress * (pageNumbers.length - 1))
      return pageNumbers[pageIndex] ?? null
    },
    [pageNumbers, props.mode]
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
      // 鼠标释放后光标通常还停留在轨道上，保留进度让横线停在释放位置；
      // 触摸结束则手指已离开，直接清除。
      setPointerProgress(
        pointerType === 'mouse' ? resolveProgressFromPointer(event) : null
      )
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
      if (props.mode === 'text') props.onUserScrollIntent?.()
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
  }, [props])

  const displayedPageNumber = previewPageNumber ?? currentPageNumber
  // 光标在轨道上时用原始进度（平滑跟随光标），
  // 否则回落到量化后的页码位置（滚动/键盘导航时指示当前页）。
  const pointerPositionPercent = getPointerPositionPercent(
    props,
    displayedPageNumber,
    pointerProgress,
    previewPageNumber
  )
  const layoutPreviewRatio = layoutPreview?.size
    ? layoutPreview.size.height / layoutPreview.size.width
    : 4 / 3
  const previewHeight = showsLayoutPreview ? 104 * layoutPreviewRatio + 2 : 24
  const feedbackCenterInset = previewHeight / 2
  const feedbackPositionTop = `clamp(${feedbackCenterInset}px, ${pointerPositionPercent}%, calc(100% - ${feedbackCenterInset}px))`
  // 横线高 2px，clamp 1px 防止贴边溢出轨道；与 feedback 分开计算，
  // 使横线尽量贴近光标实际位置，不受预览卡片 inset 的限制。
  const thumbPositionTop = `clamp(1px, ${pointerPositionPercent}%, calc(100% - 1px))`
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
        setPointerProgress(null)
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
        setPointerProgress(resolveProgressFromPointer(event))
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerLeave={() => {
        if (activePointerIdRef.current === null) {
          setPreviewPageNumber(null)
          setPointerProgress(null)
        }
      }}
      onPointerMove={(event) => {
        const activeId = activePointerIdRef.current
        if (
          activeId === event.pointerId ||
          (activeId === null && event.pointerType === 'mouse')
        ) {
          setPreviewPageNumber(resolvePageFromPointer(event))
          setPointerProgress(resolveProgressFromPointer(event))
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
        mode={props.mode}
        pageNumbers={pageNumbers}
        ranges={ranges}
      />
      <span
        className='hamster-reader__reading-progress-position'
        data-page-number={displayedPageNumber}
        style={{
          top: thumbPositionTop
        }}
      >
        <span className='hamster-reader__reading-progress-thumb' />
      </span>
      <span
        className='hamster-reader__reading-progress-feedback'
        data-has-preview={showsLayoutPreview}
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
          {showsLayoutPreview ? (
            <span
              className='hamster-reader__reading-progress-preview'
              style={
                layoutPreview?.size
                  ? {
                      aspectRatio: `${layoutPreview.size.width}/${layoutPreview.size.height}`
                    }
                  : undefined
              }
            >
              {hasLayoutPreview ? (
                <img
                  alt=''
                  data-testid={`reading-progress-preview-${previewPageNumber}`}
                  draggable={false}
                  src={layoutPreview?.image}
                />
              ) : (
                <Loading size='small' />
              )}
            </span>
          ) : null}
        </span>
      </span>
    </div>
  )
}
