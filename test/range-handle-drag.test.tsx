import { act, render } from '@testing-library/react'
import { type RefObject, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

const magnifier = {
  end: vi.fn(),
  move: vi.fn(),
  registerDragCleanup: vi.fn(() => vi.fn()),
  start: vi.fn()
}

vi.mock(
  '../src/components/IntermediateDocumentViewer/RangeMagnifier',
  () => ({ useRangeMagnifier: () => magnifier })
)

import { useRangeHandleDrag } from '../src/components/IntermediateDocumentViewer/useRangeHandleDrag'

interface DragHandleProps {
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly testId: string
}

const DragHandle = ({ rootRef, testId }: DragHandleProps) => {
  const circleRef = useRef<HTMLButtonElement>(null)
  const startHandleDrag = useRangeHandleDrag({
    circleRef,
    correctPointerCoordinates: false,
    magnifierEnabled: true,
    viewerRoot: rootRef.current
  })

  return (
    <button
      ref={circleRef}
      type='button'
      className='hsn-selection-handle'
      data-range-handle-circle='start'
      data-range-id='shared-range'
      data-rect-id=''
      data-testid={testId}
      onPointerDown={(event) => startHandleDrag(event.nativeEvent)}
    />
  )
}

const TwoViewers = () => {
  const firstRootRef = useRef<HTMLDivElement>(null)
  const secondRootRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <div
        ref={firstRootRef}
        className='hamster-reader__intermediate-document-viewer'
      >
        <DragHandle rootRef={firstRootRef} testId='first-handle' />
      </div>
      <div
        ref={secondRootRef}
        className='hamster-reader__intermediate-document-viewer'
      >
        <DragHandle rootRef={secondRootRef} testId='second-handle' />
      </div>
    </>
  )
}

describe('useRangeHandleDrag', () => {
  it('starts drag only in the Reader that owns the matching handle', async () => {
    // Given: two Reader roots contain handles with identical upstream metadata.
    const view = render(<TwoViewers />)
    magnifier.start.mockClear()

    // When: the user presses the handle in the second Reader.
    await act(async () => {
      view.getByTestId('second-handle').dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          isPrimary: true,
          pointerId: 1,
          pointerType: 'mouse'
        })
      )
    })

    // Then: document capture must not redirect the gesture to the first Reader.
    expect(magnifier.start).toHaveBeenCalledTimes(1)
    expect(magnifier.start.mock.calls[0]?.[0]).toBe(
      view.getByTestId('second-handle')
    )
  })
})
