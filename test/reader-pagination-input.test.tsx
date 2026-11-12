import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewportPaginationControls } from '../src/components/reading/ViewportPaginationControls'

function mount(ready: boolean, busy: boolean) {
  const onNext = vi.fn()
  const onPrevious = vi.fn()
  const tree = (nextReady: boolean, nextBusy: boolean) => (
    <ViewportPaginationControls
      navigation={{ busy: nextBusy, canPrevious: true, canNext: true }}
      ready={nextReady}
      theme='light'
      onPrevious={onPrevious}
      onNext={onNext}
    />
  )
  const rendered = render(tree(ready, busy))
  return {
    ...rendered,
    onNext,
    onPrevious,
    rerenderState: (nextReady: boolean, nextBusy: boolean) =>
      rendered.rerender(tree(nextReady, nextBusy))
  }
}

describe('pagination press intent', () => {
  it('replays a press that a repagination disables before click', () => {
    const h = mount(true, false)
    fireEvent.pointerDown(screen.getByLabelText('下一页'))
    // Layout repagination disables the control before the browser can click it.
    h.rerenderState(false, true)
    expect(h.onNext).not.toHaveBeenCalled()
    h.rerenderState(true, false)
    expect(h.onNext).toHaveBeenCalledOnce()
  })

  it('does not double-fire a normal pointerdown + click', () => {
    const h = mount(true, false)
    const next = screen.getByLabelText('下一页')
    fireEvent.pointerDown(next)
    fireEvent.click(next)
    expect(h.onNext).toHaveBeenCalledOnce()
    h.rerenderState(true, false)
    expect(h.onNext).toHaveBeenCalledOnce()
  })

  it('queues a second press made while the first turn is in flight', () => {
    const h = mount(true, false)
    const next = screen.getByLabelText('下一页')
    fireEvent.pointerDown(next)
    fireEvent.click(next)
    expect(h.onNext).toHaveBeenCalledOnce()
    h.rerenderState(false, true)
    fireEvent.pointerDown(screen.getByLabelText('下一页'))
    h.rerenderState(true, false)
    expect(h.onNext).toHaveBeenCalledTimes(2)
  })
})
