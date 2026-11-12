import { Button, Popover } from '@hamster-note/components'
import type { Ref } from 'react'
import type { ViewportNavigationState } from './navigation'
import type { PaginationDiagnostics } from '../../types/paginationDiagnostics'

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
          disabled={!ready || navigation.busy || !navigation.canPrevious}
          onClick={onPrevious}
        >
          ←
        </Button>
        <Button
          type='button'
          size='small'
          variant='ghost'
          aria-label='下一页'
          disabled={!ready || navigation.busy || !navigation.canNext}
          onClick={onNext}
        >
          →
        </Button>
      </Popover>
    </div>
  )
}
