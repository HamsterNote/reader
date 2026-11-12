import { Button, Popover } from '@hamster-note/components'
import { useEffect, useRef, type Ref } from 'react'
import type { ViewportNavigationState } from './navigation'
import type { PaginationDiagnostics } from '../../types/paginationDiagnostics'

type Direction = 'next' | 'previous'

/**
 * Pagination buttons keep accepting the press intent across a reflow that
 * disables them before `click`. A press on an enabled button is recorded on
 * pointerdown; if the same control becomes disabled before activation (layout
 * repagination, in-flight turn) the intent is queued and replayed once the
 * control is stable again. Presses made while already busy are also queued,
 * so a rapid second click advances once after the first turn settles.
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
  const pressed = useRef<Direction | null>(null)
  const pending = useRef<Direction | null>(null)
  const nextRef = useRef(onNext)
  nextRef.current = onNext
  const previousRef = useRef(onPrevious)
  previousRef.current = onPrevious
  const disabled: Record<Direction, boolean> = {
    next: !ready || navigation.busy || !navigation.canNext,
    previous: !ready || navigation.busy || !navigation.canPrevious
  }
  // A new document must not replay a press queued for the previous one.
  const generation = useRef(diagnostics?.generation)
  if (generation.current !== diagnostics?.generation) {
    generation.current = diagnostics?.generation
    pressed.current = null
    pending.current = null
  }
  const fire = (direction: Direction) => {
    if (direction === 'next') nextRef.current()
    else previousRef.current()
  }
  useEffect(() => {
    for (const direction of ['previous', 'next'] as const) {
      if (disabled[direction] && pressed.current === direction) {
        pressed.current = null
        pending.current = direction
      }
    }
    const direction = pending.current
    if (!direction || disabled[direction]) return
    pending.current = null
    fire(direction)
    // disabled[].* derives from ready/navigation; fire reads refs.
  }, [disabled.next, disabled.previous])
  const onPointerDown = (direction: Direction) => {
    if (!disabled[direction]) pressed.current = direction
    else if (navigation.busy) pending.current = direction
  }
  const activate = (direction: Direction) => {
    pressed.current = null
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
          onPointerDown={() => onPointerDown('previous')}
          onClick={() => activate('previous')}
        >
          ←
        </Button>
        <Button
          type='button'
          size='small'
          variant='ghost'
          aria-label='下一页'
          disabled={disabled.next}
          onPointerDown={() => onPointerDown('next')}
          onClick={() => activate('next')}
        >
          →
        </Button>
      </Popover>
    </div>
  )
}
