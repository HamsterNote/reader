import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import { mockElementSize } from './setup'
import { EngineSelectionControls } from '../src/components/EngineSelectionControls'

vi.mock('../src/components/IntermediateDocumentViewer/RangeMagnifier', () => ({
  useRangeMagnifier: () => null
}))

it.each(['pointercancel', 'blur', 'replace', 'crossed', 'unmappable'] as const)(
  'cancels %s without committing a mouse endpoint preview',
  (reason) => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Alpha beta gamma'
    document.body.append(paragraph)
    const text = paragraph.firstChild!
    const range = document.createRange()
    range.setStart(text, 1)
    range.setEnd(text, 5)
    const previousRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects'
    )
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(40, 100, 80, 20)]
    })
    const caret = document.createRange()
    caret.setStart(text, reason === 'crossed' ? 0 : 10)
    caret.collapse(true)
    const previous = Object.getOwnPropertyDescriptor(
      document,
      'caretRangeFromPoint'
    )
    let caretVisible = true
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: () => (caretVisible ? caret : null)
    })
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const onUpdate = vi.fn(),
      onEditingChange = vi.fn()
    const root = createRef<HTMLDivElement>()
    const controls = (active: Range | null) => (
      <div ref={root}>
        <EngineSelectionControls
          range={active}
          containerRef={root}
          showHandles
          onUpdate={onUpdate}
          onEditingChange={onEditingChange}
        >
          Menu
        </EngineSelectionControls>
      </div>
    )
    const view = render(controls(range))
    mockElementSize(root.current!, { width: 400, height: 400 })
    view.rerender(controls(range))
    try {
      const handle = screen.getByRole('button', { name: '调整高亮终点' })
      handle.setPointerCapture = vi.fn()
      fireEvent.pointerDown(handle, { pointerId: 3, pointerType: 'mouse' })
      fireEvent.pointerMove(handle, {
        pointerId: 3,
        pointerType: 'mouse',
        clientX: 120,
        clientY: 110
      })
      if (reason === 'unmappable') {
        caretVisible = false
        fireEvent.pointerMove(handle, {
          pointerId: 3,
          pointerType: 'mouse',
          clientX: 300,
          clientY: 300
        })
      }
      if (reason === 'pointercancel')
        fireEvent.pointerCancel(document, { pointerId: 3 })
      else if (reason === 'blur') fireEvent(window, new Event('blur'))
      else if (reason === 'replace') view.rerender(controls(null))
      else fireEvent.pointerUp(document, { pointerId: 3 })
      expect(onUpdate).not.toHaveBeenCalled()
      expect(onEditingChange.mock.calls.at(-1)).toEqual([false])
      if (reason !== 'replace') expect(selection.toString()).toBe('lpha')
    } finally {
      view.unmount()
      if (previous)
        Object.defineProperty(document, 'caretRangeFromPoint', previous)
      else Reflect.deleteProperty(document, 'caretRangeFromPoint')
      if (previousRects)
        Object.defineProperty(Range.prototype, 'getClientRects', previousRects)
      else Reflect.deleteProperty(Range.prototype, 'getClientRects')
      paragraph.remove()
    }
  }
)
