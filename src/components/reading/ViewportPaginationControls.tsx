import { Button, Popover } from '@hamster-note/components'
import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref
} from 'react'
import type { ViewportNavigationState } from './navigation'
import type { PaginationDiagnostics } from '../../types/paginationDiagnostics'

type Direction = 'next' | 'previous'

/**
 * One pointer gesture produces at most one page turn.
 *
 * Activation happens on release inside the control. If a repagination or an
 * in-flight turn disables the control between down and up, the completed press
 * is replayed once when the control is stable; the native click is suppressed
 * so the same gesture cannot fire twice. Cancel, leaving the control, or
 * releasing outside drop the intent. A completed press on a control that is
 * already busy queues one follow-up turn for a rapid second click.
 */
export function ViewportPaginationControls({
  navigation,
  ready,
  theme,
  controlsRef,
  className = '',
  diagnostics,
  onPrevious,
  onNext
}: {
  navigation: ViewportNavigationState
  ready: boolean
  theme: 'light' | 'dark'
  controlsRef?: Ref<HTMLDivElement>
  className?: string
  /** Read-only snapshot for host failure capture; does not affect behavior. */
  diagnostics?: PaginationDiagnostics
  onPrevious: () => void
  onNext: () => void
}) {
  const gesture = useRef<{
    direction: Direction
    pointerId: number | undefined
    element: HTMLButtonElement
  } | null>(null)
  const pending = useRef<Direction | null>(null)
  const suppressClick = useRef<Direction | null>(null)
  const nextRef = useRef(onNext)
  nextRef.current = onNext
  const previousRef = useRef(onPrevious)
  previousRef.current = onPrevious
  const disabled: Record<Direction, boolean> = {
    next: !ready || navigation.busy || !navigation.canNext,
    previous: !ready || navigation.busy || !navigation.canPrevious
  }
  const fire = (direction: Direction) => {
    if (direction === 'next') nextRef.current()
    else previousRef.current()
  }
  const latest = useRef({ disabled, fire })
  latest.current = { disabled, fire }
  // A new document must not replay an intent from the previous one.
  const generation = useRef(diagnostics?.generation)
  if (generation.current !== diagnostics?.generation) {
    generation.current = diagnostics?.generation
    gesture.current = null
    pending.current = null
    suppressClick.current = null
  }
  useEffect(() => {
    const release = (event: PointerEvent) => {
      const active = gesture.current
      if (!active) return
      if (
        active.pointerId !== undefined &&
        event.pointerId !== undefined &&
        active.pointerId !== event.pointerId
      )
        return
      gesture.current = null
      if (!isInside(active.element, event)) {
        pending.current = null
        return
      }
      const state = latest.current
      if (state.disabled[active.direction]) {
        // Hold through the reflow and replay once stable.
        pending.current = active.direction
        return
      }
      suppressClick.current = active.direction
      state.fire(active.direction)
    }
    const cancel = (event: PointerEvent) => {
      const active = gesture.current
      if (!active) return
      if (
        active.pointerId !== undefined &&
        event.pointerId !== undefined &&
        active.pointerId !== event.pointerId
      )
        return
      gesture.current = null
      pending.current = null
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', cancel, true)
    return () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
  }, [])
  useEffect(() => {
    const direction = pending.current
    if (!direction || disabled[direction]) return
    pending.current = null
    suppressClick.current = direction
    fire(direction)
    // disabled[].* derives from ready/navigation; fire reads refs.
  }, [disabled.next, disabled.previous])
  const onPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: Direction
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    suppressClick.current = null
    gesture.current = {
      direction,
      pointerId: event.pointerId,
      element: event.currentTarget
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const dropGesture = () => {
    gesture.current = null
    pending.current = null
  }
  const onClick = (direction: Direction) => {
    if (suppressClick.current === direction) {
      suppressClick.current = null
      return
    }
    pending.current = null
    fire(direction)
  }
  return (
    <div
      ref={controlsRef}
      className={`hamster-reader__viewport-pagination ${className}`}
      data-pdf-text-generation={diagnostics?.generation}
      data-pdf-text-revision={diagnostics?.revision}
      data-pdf-text-ready={diagnostics ? String(diagnostics.ready) : undefined}
      data-pdf-text-busy={diagnostics ? String(diagnostics.busy) : undefined}
      data-pdf-text-gate={diagnostics ? String(diagnostics.gate) : undefined}
      data-pdf-text-target-page={diagnostics?.targetPageNumber}
      data-pdf-text-turn-sequence={diagnostics?.turnSequence}
      data-pdf-text-last-turn-page={
        diagnostics?.lastTurnPageNumber ?? undefined
      }
      data-pdf-text-error={diagnostics?.error}
    >
      <Popover
        relative
        theme={theme}
        role='group'
        aria-label='翻页'
        style={{ position: 'static', transform: 'none' }}
      >
        <Button
          type='button'
          size='small'
          variant='ghost'
          aria-label='上一页'
          disabled={disabled.previous}
          onPointerDown={(event) => onPointerDown(event, 'previous')}
          onPointerCancel={dropGesture}
          onPointerLeave={dropGesture}
          onClick={() => onClick('previous')}
        >
          ←
        </Button>
        <Button
          type='button'
          size='small'
          variant='ghost'
          aria-label='下一页'
          disabled={disabled.next}
          onPointerDown={(event) => onPointerDown(event, 'next')}
          onPointerCancel={dropGesture}
          onPointerLeave={dropGesture}
          onClick={() => onClick('next')}
        >
          →
        </Button>
      </Popover>
    </div>
  )
}

/** jsdom reports a zero-size rect; treat that as inside for unit fixtures. */
function isInside(element: HTMLElement, event: PointerEvent): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return true
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}
