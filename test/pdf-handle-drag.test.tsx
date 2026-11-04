import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import {
  pdfHandleRange,
  pdfHandleScrollVelocity
} from '../src/components/selection/pdfHandleDrag'
import { mockElementSize, setScrollContainerSize } from './setup'

vi.mock('../src/components/IntermediateDocumentViewer/RangeMagnifier', () => ({
  useRangeMagnifier: () => null
}))

it.each([true, false])(
  'keeps the anchor while the %s endpoint crosses twice',
  (end) => {
    const p = document.createElement('p')
    p.textContent = 'Alpha beta gamma'
    document.body.append(p)
    const original = document.createRange()
    original.setStart(p.firstChild!, 6)
    original.setEnd(p.firstChild!, 10)
    const caret = original.cloneRange()
    caret.setStart(p.firstChild!, end ? 2 : 14)
    caret.collapse(true)
    const crossed = pdfHandleRange(original, end, caret)
    expect(crossed.end).toBe(!end)
    expect(crossed.range.toString()).toBe(end ? 'pha ' : ' gam')
    caret.setStart(p.firstChild!, end ? 14 : 2)
    caret.collapse(true)
    const back = pdfHandleRange(original, end, caret)
    expect(back.end).toBe(end)
    expect(back.range.toString()).toBe(end ? 'beta gam' : 'pha beta')
    p.remove()
  }
)

it('accelerates symmetrically towards both viewport edges and has no velocity in the middle', () => {
  expect(pdfHandleScrollVelocity(250, 0, 500)).toBe(0)
  expect(pdfHandleScrollVelocity(499, 0, 500)).toBeGreaterThan(
    pdfHandleScrollVelocity(450, 0, 500)
  )
  expect(pdfHandleScrollVelocity(1, 0, 500)).toBe(
    -pdfHandleScrollVelocity(499, 0, 500)
  )
  expect(pdfHandleScrollVelocity(550, 0, 500)).toBe(600)
})

it.each(['pointerup', 'pointercancel'] as const)(
  're-hits a stationary finger after scrolling and stops immediately on %s',
  (release) => {
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.set(++id, cb)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((key) => {
      if (typeof key === 'number') frames.delete(key)
    })
    const tick = (time: number) =>
      act(() => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((cb) => cb(time))
      })
    const root = createRef<HTMLDivElement>()
    const text = document.createTextNode('Alpha beta gamma delta')
    const range = document.createRange()
    const hitTest = vi.fn(() => {
      const caret = document.createRange()
      caret.setStart(text, scroller.scrollTop > 1 ? 16 : 12)
      caret.collapse(true)
      return caret
    })
    const update = vi.fn()
    const original = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects'
    )
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(30, 100, 80, 20)]
    })
    const p = document.createElement('p')
    p.append(text)
    document.body.append(p)
    range.setStart(text, 6)
    range.setEnd(text, 10)
    const controls = () => (
      <div ref={root}>
        <div className='hamster-reader__pdf-viewer-container' />
        <EngineSelectionControls
          range={range}
          containerRef={root}
          showHandles
          pdfTouch
          hitTest={hitTest}
          onUpdate={update}
          onEditingChange={() => {}}
        >
          Menu
        </EngineSelectionControls>
      </div>
    )
    const view = render(controls())
    const scroller = root.current!.firstElementChild as HTMLElement
    setScrollContainerSize(scroller, {
      width: 400,
      height: 400,
      scrollHeight: 1600
    })
    mockElementSize(root.current!, { width: 400, height: 400 })
    tick(0)
    view.rerender(controls())
    try {
      const handle = screen.getByRole('button', { name: '拖动以调整选区终点' })
      handle.setPointerCapture = vi.fn()
      handle.getBoundingClientRect = () => new DOMRect(90, 110, 40, 40)
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        clientX: 110,
        clientY: 130
      })
      fireEvent.pointerMove(document, {
        pointerId: 1,
        clientX: 110,
        clientY: 399
      })
      const before = hitTest.mock.calls.length
      tick(16)
      tick(32)
      expect(scroller.scrollTop).toBeGreaterThan(10)
      expect(hitTest.mock.calls.length).toBeGreaterThan(before)
      const finish =
        release === 'pointerup' ? fireEvent.pointerUp : fireEvent.pointerCancel
      finish(document, { pointerId: 1, clientX: 110, clientY: 399 })
      const stopped = scroller.scrollTop
      tick(48)
      tick(64)
      expect(scroller.scrollTop).toBe(stopped)
      expect(root.current!.dataset.pdfHandleDragging).toBeUndefined()
      if (release === 'pointerup')
        expect(update.mock.calls[0][0].endOffset).toBe(16)
      else expect(update).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      p.remove()
      vi.restoreAllMocks()
      if (original)
        Object.defineProperty(Range.prototype, 'getClientRects', original)
      else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    }
  }
)
