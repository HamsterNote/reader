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

it.each([
  'commit-start',
  'commit-end',
  'pointercancel',
  'blur',
  'second-finger',
  'replace',
  'crossed',
  'unmappable'
] as const)(
  'PDF touch circle corrects the grab offset and %s exactly once',
  (action) => {
    const root = createRef<HTMLDivElement>()
    const node = document.createTextNode('Alpha beta gamma delta')
    const paragraph = document.createElement('p')
    paragraph.append(node)
    document.body.append(paragraph)
    const range = document.createRange()
    range.setStart(node, 6)
    range.setEnd(node, 10)
    const originalRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects'
    )
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(40, 100, 80, 20)]
    })
    const onUpdate = vi.fn(),
      onPreview = vi.fn(),
      onEditingChange = vi.fn()
    const hitTest = vi.fn(() => {
      if (action === 'unmappable') return null
      const caret = document.createRange()
      caret.setStart(
        node,
        action === 'crossed' ? 0 : action === 'commit-start' ? 0 : 16
      )
      caret.collapse(true)
      return caret
    })
    const controls = (active: Range | null) => (
      <div ref={root}>
        <EngineSelectionControls
          range={active}
          containerRef={root}
          showHandles
          pdfTouch
          color='rgba(12, 34, 56, 0.3)'
          onUpdate={onUpdate}
          onPreview={onPreview}
          hitTest={hitTest}
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
      const handle = screen.getByRole('button', {
        name:
          action === 'commit-start'
            ? '拖动以调整选区起点'
            : '拖动以调整选区终点'
      })
      expect(handle.style.width).toBe('20px')
      expect(handle.style.borderWidth).toBe('2px')
      expect(handle.style.filter).toContain('drop-shadow')
      expect(handle.style.top).toBe(
        action === 'commit-start' ? '90px' : '130px'
      )
      expect(handle.style.backgroundColor).toBe('rgb(12, 34, 56)')
      handle.getBoundingClientRect = () => new DOMRect(110, 110, 20, 20)
      handle.setPointerCapture = vi.fn()
      handle.hasPointerCapture = vi.fn(() => true)
      handle.releasePointerCapture = vi.fn()
      fireEvent.pointerDown(handle, {
        pointerId: 3,
        pointerType: 'touch',
        button: 0,
        clientX: 115,
        clientY: 115
      })
      fireEvent.pointerMove(handle, {
        pointerId: 3,
        pointerType: 'touch',
        clientX: 155,
        clientY: 115
      })
      expect(hitTest).toHaveBeenCalledWith(160, 110)
      if (action === 'pointercancel')
        fireEvent.pointerCancel(document, { pointerId: 3 })
      else if (action === 'blur') fireEvent(window, new Event('blur'))
      else if (action === 'second-finger')
        fireEvent.pointerDown(document, { pointerId: 4, pointerType: 'touch' })
      else if (action === 'replace') view.rerender(controls(null))
      fireEvent.pointerUp(document, { pointerId: 3 })
      if (action.startsWith('commit')) {
        expect(onUpdate).toHaveBeenCalledOnce()
        expect(onUpdate.mock.calls[0][0].toString()).toBe(
          action === 'commit-start' ? 'Alpha beta' : 'beta gamma'
        )
      } else {
        expect(onUpdate).not.toHaveBeenCalled()
        if (action !== 'replace')
          expect(onPreview.mock.calls.at(-1)?.[0].toString()).toBe('beta')
      }
      expect(handle.releasePointerCapture).toHaveBeenCalledWith(3)
    } finally {
      view.unmount()
      if (originalRects)
        Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
      else Reflect.deleteProperty(Range.prototype, 'getClientRects')
      paragraph.remove()
    }
  }
)

it('hides an offscreen PDF endpoint instead of moving it onto another visible line', () => {
  const root = createRef<HTMLDivElement>()
  const p = document.createElement('p')
  p.textContent = 'Alpha beta'
  document.body.append(p)
  const range = document.createRange()
  range.selectNodeContents(p)
  const previous = Object.getOwnPropertyDescriptor(
    Range.prototype,
    'getClientRects'
  )
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [new DOMRect(40, -50, 80, 20), new DOMRect(40, 100, 80, 20)]
  })
  const controls = (
    <div ref={root}>
      <EngineSelectionControls
        range={range}
        containerRef={root}
        showHandles
        pdfTouch
        onUpdate={vi.fn()}
        onEditingChange={vi.fn()}
      >
        Menu
      </EngineSelectionControls>
    </div>
  )
  const view = render(controls)
  mockElementSize(root.current!, { width: 400, height: 400 })
  view.rerender(
    <div ref={root}>
      <EngineSelectionControls
        range={range}
        containerRef={root}
        showHandles
        pdfTouch
        onUpdate={vi.fn()}
        onEditingChange={vi.fn()}
      >
        Menu
      </EngineSelectionControls>
    </div>
  )
  try {
    expect(
      screen.queryByRole('button', { name: '拖动以调整选区起点' })
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: '拖动以调整选区终点' })
    ).toBeDefined()
  } finally {
    view.unmount()
    if (previous)
      Object.defineProperty(Range.prototype, 'getClientRects', previous)
    else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    p.remove()
  }
})
