import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import { mockElementSize } from './setup'

const magnifier = vi.hoisted(() => ({
  start: vi.fn(),
  move: vi.fn(),
  end: vi.fn()
}))
vi.mock('../src/components/IntermediateDocumentViewer/RangeMagnifier', () => ({
  useRangeMagnifier: () => magnifier
}))

it.each(['mouse', 'touch'])(
  'lifts only PDF %s lens layout and retains its sampled point',
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
          hitTest={() => {
            const caret = range.cloneRange()
            caret.collapse(false)
            return caret
          }}
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
      expect(magnifier.start).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        {
          clientX: 100,
          clientY: 230,
          lensPoint: { clientX: 100, clientY: 222 }
        },
        pointerType === 'touch'
          ? expect.objectContaining({ end: true })
          : undefined
      )
      fireEvent.pointerMove(document, {
        pointerId: 9,
        pointerType,
        clientX: 120,
        clientY: 280
      })
      expect(magnifier.move).toHaveBeenLastCalledWith(
        pointerType === 'touch'
          ? {
              clientX: 100,
              clientY: 230,
              lensPoint: { clientX: 100, clientY: 222 }
            }
          : {
              clientX: 120,
              clientY: 260,
              lensPoint: { clientX: 120, clientY: 252 }
            },
        ...(pointerType === 'touch'
          ? [expect.objectContaining({ end: true })]
          : [])
      )
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
