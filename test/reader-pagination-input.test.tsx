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
  it('holds a press through a repagination and fires exactly once on release', () => {
    const h = mount(true, false)
    const next = screen.getByLabelText('下一页')
    fireEvent.pointerDown(next)
    // Layout repagination disables the control before the browser can click it.
    h.rerenderState(false, true)
    h.rerenderState(true, false)
    // The gesture is still down: nothing has happened yet.
    expect(h.onNext).not.toHaveBeenCalled()
    fireEvent.pointerUp(next)
    expect(h.onNext).toHaveBeenCalledOnce()
    // The native click that would follow the same gesture must not fire again.
    fireEvent.click(next)
    expect(h.onNext).toHaveBeenCalledOnce()
  })

  it('drops a cancelled press so a later reflow cannot page for the user', () => {
    const h = mount(true, false)
    const next = screen.getByLabelText('下一页')
    fireEvent.pointerDown(next)
    h.rerenderState(false, true)
    fireEvent.pointerCancel(document)
    h.rerenderState(true, false)
    fireEvent.pointerUp(next)
    expect(h.onNext).not.toHaveBeenCalled()
  })

  it('drops a release outside the control', () => {
    const h = mount(true, false)
    const next = screen.getByLabelText('下一页')
    next.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 10,
        bottom: 10,
        width: 10,
        height: 10
      }) as DOMRect
    fireEvent.pointerDown(next)
    h.rerenderState(false, true)
    fireEvent.pointerUp(next, { clientX: 100, clientY: 100 })
    h.rerenderState(true, false)
    expect(h.onNext).not.toHaveBeenCalled()
  })

  it('does not double-fire a normal pointerdown + click', () => {
    const h = mount(true, false)
    const next = screen.getByLabelText('下一页')
    fireEvent.pointerDown(next)
    fireEvent.pointerUp(next)
    fireEvent.click(next)
    expect(h.onNext).toHaveBeenCalledOnce()
  })

  it('queues a second press made while the first turn is in flight', () => {
    const h = mount(true, false)
    const next = screen.getByLabelText('下一页')
    fireEvent.pointerDown(next)
    fireEvent.pointerUp(next)
    fireEvent.click(next)
    expect(h.onNext).toHaveBeenCalledOnce()
    h.rerenderState(false, true)
    fireEvent.pointerDown(screen.getByLabelText('下一页'))
    fireEvent.pointerUp(screen.getByLabelText('下一页'))
    expect(h.onNext).toHaveBeenCalledOnce()
    h.rerenderState(true, false)
    expect(h.onNext).toHaveBeenCalledTimes(2)
  })
})
