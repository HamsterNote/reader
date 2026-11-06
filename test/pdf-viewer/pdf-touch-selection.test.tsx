import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { expect, it, vi } from 'vitest'
import {
  pdfCaretAtPoint,
  usePdfTouchSelection
} from '../../src/pdf/pdfTouchSelection'
import { mockElementSize } from '../setup'

it('suppresses reactivated native selection including reader chrome, preserving the managed range and editors', () => {
  let selection!: ReturnType<typeof usePdfTouchSelection>
  function Harness() {
    const rootRef = useRef<HTMLDivElement>(null)
    selection = usePdfTouchSelection({
      rootRef,
      source: 'pdf',
      enabled: true,
      validate: () => true,
      onChange: () => {}
    })
    return (
      <div className='hamster-reader'>
        <div ref={rootRef}>
          <span>Alpha beta</span>
        </div>
        <button>49%</button>
        <div contentEditable suppressContentEditableWarning>
          Comment
        </div>
      </div>
    )
  }
  const view = render(<Harness />)
  const text = view.container.querySelector('span')!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 5)
  act(() => {
    selection.activate()
    selection.setRange(range)
  })
  const native = document.getSelection()!
  // Simulate WebKit bringing a selection back during/after a drag.
  const leaked = range.cloneRange()
  leaked.setEnd(view.container.querySelector('button')!.firstChild!, 2)
  native.addRange(leaked)
  fireEvent(document, new Event('selectionchange'))
  expect(native.rangeCount).toBe(0)
  expect(selection.managed.current?.toString()).toBe('Alpha')
  range.collapse(true)
  expect(selection.managed.current?.toString()).toBe('Alpha')
  expect(
    fireEvent(
      text.parentElement!,
      new Event('selectstart', { bubbles: true, cancelable: true })
    )
  ).toBe(false)
  const editor = view.container.querySelector('[contenteditable]')!
  const comment = document.createRange()
  comment.selectNodeContents(editor)
  native.addRange(comment)
  fireEvent(document, new Event('selectionchange'))
  expect(native.toString()).toBe('Comment')
  native.removeAllRanges()
  // Another reader's selection must not be cleared by this guard.
  const other = document.createElement('p')
  other.textContent = 'Other reader'
  document.body.append(other)
  const outside = document.createRange()
  outside.selectNodeContents(other)
  native.addRange(outside)
  fireEvent(document, new Event('selectionchange'))
  expect(native.toString()).toBe('Other reader')
  native.removeAllRanges()
  other.remove()
  view.unmount()
})

it('裁切页间隙拖柄不得命中隐藏页眉/页脚', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<div class="pdfViewer"><div class="page"><div class="textLayer">' +
    '<span data-selection-start-offset="0">HIDDEN HEADER</span>' +
    '<span data-selection-start-offset="14">VISIBLE BODY</span>' +
    '<span data-selection-start-offset="27">VISIBLE END</span>' +
    '<span data-selection-start-offset="39">HIDDEN FOOTER</span>' +
    '</div></div></div>'
  document.body.append(root)
  const page = root.querySelector<HTMLElement>('.page')!
  const spans = [...root.querySelectorAll<HTMLElement>('span')]
  page.style.clipPath = 'inset(100px 0px 100px 0px)'
  mockElementSize(root, { left: 0, top: 0, width: 400, height: 600 })
  mockElementSize(page, { left: 0, top: 110, width: 400, height: 400 })
  const boxes = [
    { left: 20, top: 190, width: 120, height: 20 },
    { left: 20, top: 250, width: 120, height: 20 },
    { left: 20, top: 350, width: 120, height: 20 },
    { left: 20, top: 410, width: 120, height: 20 }
  ]
  spans.forEach((span, index) => mockElementSize(span, boxes[index]!))
  const previousElements = Object.getOwnPropertyDescriptor(
    document,
    'elementsFromPoint'
  )
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => []
  })
  const previousRangeRects = Object.getOwnPropertyDescriptor(
    Range.prototype,
    'getClientRects'
  )
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: vi.fn(function (this: Range) {
      const box = this.startContainer.parentElement!.getBoundingClientRect()
      return [box] as unknown as DOMRectList
    })
  })
  try {
    expect(
      pdfCaretAtPoint(root, 25, 205, true)?.startContainer.textContent
    ).toBe('VISIBLE BODY')
    expect(
      pdfCaretAtPoint(root, 25, 415, true)?.startContainer.textContent
    ).toBe('VISIBLE END')
    spans[1]!.remove()
    spans[2]!.remove()
    spans[3]!.remove()
    expect(pdfCaretAtPoint(root, 25, 205, true)).toBeNull()
  } finally {
    if (previousRangeRects)
      Object.defineProperty(
        Range.prototype,
        'getClientRects',
        previousRangeRects
      )
    else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    if (previousElements)
      Object.defineProperty(document, 'elementsFromPoint', previousElements)
    else Reflect.deleteProperty(document, 'elementsFromPoint')
    root.remove()
  }
})

it('ignores cropped glyphs in a partially visible span even when native caret points into them', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<div class="page"><div class="textLayer"><span data-selection-start-offset="0">AB</span></div></div>'
  document.body.append(root)
  const page = root.querySelector<HTMLElement>('.page')!
  const span = root.querySelector<HTMLElement>('span')!
  page.style.clipPath = 'inset(100px 0px 100px 60px)'
  mockElementSize(root, { left: 0, top: 0, width: 400, height: 600 })
  mockElementSize(page, { left: 0, top: 110, width: 400, height: 400 })
  mockElementSize(span, { left: 20, top: 250, width: 80, height: 20 })
  const nativeCaret = document.createRange()
  nativeCaret.setStart(span.firstChild!, 0)
  nativeCaret.collapse(true)
  const descriptors = ['elementsFromPoint', 'caretRangeFromPoint'].map((key) =>
    Object.getOwnPropertyDescriptor(document, key)
  )
  const previousRects = Object.getOwnPropertyDescriptor(
    Range.prototype,
    'getClientRects'
  )
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => [span]
  })
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => nativeCaret
  })
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) {
      return [new DOMRect(20 + this.startOffset * 40, 250, 40, 20)]
    }
  })
  try {
    const caret = pdfCaretAtPoint(root, 65, 260, true)
    expect(caret?.startContainer).toBe(span.firstChild)
    expect(caret?.startOffset).toBe(1)
    expect(caret?.collapsed).toBe(true)
  } finally {
    if (previousRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', previousRects)
    } else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    const keys = ['elementsFromPoint', 'caretRangeFromPoint']
    keys.forEach((key, index) => {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(document, key, descriptor)
      else Reflect.deleteProperty(document, key)
    })
    root.remove()
  }
})
