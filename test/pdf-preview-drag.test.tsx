import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, it, vi } from 'vitest'
import { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import { mockElementSize } from './setup'

vi.mock('../src/components/IntermediateDocumentViewer/RangeMagnifier', () => ({
  useRangeMagnifier: () => null
}))

it.each(['cross-anchor', 'pending-hit', 'collapsed-hit', 'release-only'])(
  'keeps the desktop PDF anchor and commits once for %s',
  (scenario) => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Alpha beta gamma delta'
    document.body.append(paragraph)
    const text = paragraph.firstChild!
    const original = document.createRange()
    original.setStart(text, 6)
    original.setEnd(text, 10)
    const previousRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects'
    )
    const previousCaret = Object.getOwnPropertyDescriptor(
      document,
      'caretRangeFromPoint'
    )
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        return [
          new DOMRect(
            40 + this.startOffset * 10,
            100,
            (this.endOffset - this.startOffset) * 10,
            20
          )
        ]
      }
    })
    // The moving 40px button or a PDF line gap can defeat the native caret API.
    const nativeCaret = vi.fn(() => null)
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: nativeCaret
    })
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(original)
    const caret = original.cloneRange()
    caret.setStart(text, scenario === 'cross-anchor' ? 2 : 16)
    caret.collapse(true)
    const hitTest = vi.fn<() => Range | null>(() => caret)
    const onUpdate = vi.fn()
    const root = createRef<HTMLDivElement>()
    const controls = () => (
      <div ref={root}>
        <EngineSelectionControls
          range={original}
          containerRef={root}
          showHandles
          pdfCustomHandles
          hitTest={hitTest}
          onUpdate={onUpdate}
          onEditingChange={() => {}}
        >
          Menu
        </EngineSelectionControls>
      </div>
    )
    const view = render(controls())
    mockElementSize(root.current!, { width: 400, height: 400 })
    view.rerender(controls())
    try {
      const handle = screen.getByRole('button', { name: '调整高亮终点' })
      handle.getBoundingClientRect = () => new DOMRect(120, 110, 40, 40)
      handle.setPointerCapture = vi.fn()
      fireEvent.pointerDown(handle, {
        pointerId: 7,
        pointerType: 'mouse',
        clientX: 149,
        clientY: 139,
        button: 0
      })
      if (scenario !== 'release-only')
        fireEvent.pointerMove(document, {
          pointerId: 7,
          clientX: 309,
          clientY: 139
        })
      if (scenario === 'pending-hit') hitTest.mockReturnValue(null)
      if (scenario === 'collapsed-hit') {
        const collapsed = original.cloneRange()
        collapsed.collapse(true)
        hitTest.mockReturnValue(collapsed)
      }
      fireEvent.pointerUp(document, {
        pointerId: 7,
        clientX: 319,
        clientY: 149
      })
      expect(nativeCaret).not.toHaveBeenCalled()
      expect(hitTest).toHaveBeenLastCalledWith(319, 149)
      expect(onUpdate).toHaveBeenCalledOnce()
      const result = onUpdate.mock.calls[0][0] as Range
      expect(result.startOffset).toBe(scenario === 'cross-anchor' ? 2 : 6)
      expect(result.endOffset).toBe(scenario === 'cross-anchor' ? 6 : 16)
      expect(selection.toString()).toBe(result.toString())
      expect(handle.setPointerCapture).toHaveBeenCalledWith(7)
    } finally {
      view.unmount()
      selection.removeAllRanges()
      paragraph.remove()
      if (previousRects)
        Object.defineProperty(Range.prototype, 'getClientRects', previousRects)
      else Reflect.deleteProperty(Range.prototype, 'getClientRects')
      if (previousCaret)
        Object.defineProperty(document, 'caretRangeFromPoint', previousCaret)
      else Reflect.deleteProperty(document, 'caretRangeFromPoint')
    }
  }
)
