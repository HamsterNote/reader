import { Button, Popover } from '@hamster-note/components'
import type { Ref } from 'react'
import type { ViewportNavigationState } from './navigation'

export function ViewportPaginationControls({
  navigation,
  ready,
  theme,
  controlsRef,
  className = '',
  onPrevious,
  onNext
}: {
  navigation: ViewportNavigationState
  ready: boolean
  theme: 'light' | 'dark'
  controlsRef?: Ref<HTMLDivElement>
  className?: string
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div
      ref={controlsRef}
      className={`hamster-reader__viewport-pagination ${className}`}
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
