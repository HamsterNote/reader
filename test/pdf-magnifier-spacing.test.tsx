import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import { mockElementSize } from './setup'
import { markSelectionPointerMoveAsTextHit } from '../src/components/selection/selectionPointerGuard'

const magnifier = vi.hoisted(() => ({
  start: vi.fn(),
  move: vi.fn(),
  end: vi.fn()
}))
vi.mock('../src/components/IntermediateDocumentViewer/RangeMagnifier', () => ({
  useRangeMagnifier: () => magnifier
}))

it.each(['mouse', 'touch'])(
  'samples the physical PDF %s pointer without grab correction',
  (pointerType) => {
    Object.values(magnifier).forEach((mock) => mock.mockClear())
    const root = createRef<HTMLDivElement>()
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Alpha beta gamma'
    document.body.append(paragraph)
    const range = document.createRange()
    range.setStart(paragraph.firstChild!, 0)
    range.setEnd(paragraph.firstChild!, 10)
    const previous = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects'
    )
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(20, 220, 80, 20)]
    })
    const hitTest = vi.fn<() => Range | null>(() => {
      const caret = range.cloneRange()
      caret.collapse(false)
      return caret
    })
    const controls = () => (
      <div ref={root}>
        <EngineSelectionControls
          range={range}
          containerRef={root}
          showHandles
          pdfCustomHandles
          pdfTouch={pointerType === 'touch'}
          onUpdate={() => {}}
          onEditingChange={() => {}}
          hitTest={hitTest}
        >
          Menu
        </EngineSelectionControls>
      </div>
    )
    const view = render(controls())
    mockElementSize(root.current!, { width: 400, height: 400 })
    view.rerender(controls())
    try {
      const handle = screen.getByRole('button', {
        name: pointerType === 'touch' ? '拖动以调整选区终点' : '调整高亮终点'
      })
      handle.setPointerCapture = vi.fn()
      handle.getBoundingClientRect = () => new DOMRect(80, 230, 40, 40)
      fireEvent.pointerDown(handle, {
        pointerId: 9,
        pointerType,
        button: 0,
        clientX: 100,
        clientY: 250
      })
      if (pointerType === 'touch')
        expect(magnifier.start).toHaveBeenCalledWith(
          expect.any(HTMLElement),
          { clientX: 100, clientY: 250 },
          expect.objectContaining({ end: true }),
          'touch'
        )
      else expect(magnifier.start).not.toHaveBeenCalled()
      fireEvent.pointerMove(document, {
        pointerId: 9,
        pointerType,
        clientX: 120,
        clientY: 280
      })
      if (pointerType === 'touch')
        expect(magnifier.move).toHaveBeenLastCalledWith(
          { clientX: 120, clientY: 280 },
          expect.objectContaining({ end: true })
        )
      else expect(magnifier.move).not.toHaveBeenCalled()
      const moves = magnifier.move.mock.calls.length
      const forwarded = new PointerEvent('pointermove', {
        pointerId: 9,
        clientX: 120,
        clientY: 260
      })
      markSelectionPointerMoveAsTextHit(forwarded)
      fireEvent(document, forwarded)
      fireEvent.pointerMove(document, { pointerId: 10, clientX: 9, clientY: 9 })
      fireEvent.lostPointerCapture(handle, { pointerId: 10 })
      expect(magnifier.move).toHaveBeenCalledTimes(moves)
      expect(magnifier.end).not.toHaveBeenCalled()
      hitTest.mockReturnValue(null)
      fireEvent.pointerMove(document, {
        pointerId: 9,
        clientX: 140,
        clientY: 300
      })
      if (pointerType === 'touch')
        expect(magnifier.move).toHaveBeenLastCalledWith(
          { clientX: 140, clientY: 300 },
          expect.objectContaining({ end: true, valid: false })
        )
      else expect(magnifier.move).not.toHaveBeenCalled()
      fireEvent.pointerCancel(document, { pointerId: 9 })
      expect(magnifier.end).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
      paragraph.remove()
      if (previous)
        Object.defineProperty(Range.prototype, 'getClientRects', previous)
      else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    }
  }
)
