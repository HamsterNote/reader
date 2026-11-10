import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { EngineSelectionControls } from '../src/components/EngineSelectionControls'
import { RangeMagnifierProvider } from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
import { insertionRect, projectInsertionMarker } from '../src/components/IntermediateDocumentViewer/selectionInteraction'
import { resolveMagnifierPosition } from '../src/components/IntermediateDocumentViewer/rangeMagnifierGeometry'
import { mockElementSize } from './setup'

const screenshot = vi.hoisted(() => vi.fn())
vi.mock('html2canvas', () => ({ default: screenshot }))
afterEach(() => vi.restoreAllMocks())

const matrix = ['pdf-layout', 'epub', 'pdf-text'].flatMap(surface =>
  ['touch', 'mouse', 'pen', ''].flatMap(pointerType =>
    [false, true].flatMap(end => ['draft', 'saved'].map(target => ({ surface, pointerType, end, target }))))
)

it.each(matrix)('$surface / $pointerType / end=$end / $target uses raw hits, stable handles and a touch-only text lens', ({ surface, pointerType, end, target }) => {
  const frame = surface === 'epub' ? document.createElement('iframe') : null
  if (frame) document.body.append(frame)
  const doc = frame?.contentDocument ?? document
  const paragraph = doc.createElement('p')
  paragraph.textContent = '012345678901234567890123456789'
  doc.body.append(paragraph)
  const node = paragraph.firstChild!
  const range = doc.createRange()
  range.setStart(node, 12)
  range.setEnd(node, 17)
  const proto = Object.getPrototypeOf(range) as Range
  const previous = Object.getOwnPropertyDescriptor(proto, 'getClientRects')
  const previousBounding = Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect')
  Object.defineProperty(proto, 'getClientRects', { configurable: true, value(this: Range) {
    const offset = this.startOffset
    return [new DOMRect(40 + offset % 10 * 10, 100 + Math.floor(offset / 10) * 30,
      this.collapsed ? 0 : Math.max(10, (this.endOffset - offset) * 10), 20)]
  } })
  Object.defineProperty(proto, 'getBoundingClientRect', { configurable: true, value(this: Range) {
    return this.getClientRects()[0]
  } })
  const hit = vi.fn((x: number, y: number) => {
    const caret = doc.createRange()
    caret.setStart(node, Math.min(29, Math.max(0, Math.floor((y - 100) / 30) * 10 + Math.round((x - 40) / 10))))
    caret.collapse(true)
    return caret
  })
  Object.defineProperty(doc, 'caretRangeFromPoint', { configurable: true, value: hit })
  const root = createRef<HTMLDivElement>()
  const onUpdate = vi.fn()
  const toolbar = '#ff1234'
  const color = target === 'saved' ? '#1234ff' : toolbar
  const controls = (enabled = true, nextColor = color) => <div ref={root}>
    <RangeMagnifierProvider rootElement={root.current} enabled={enabled}>
      <EngineSelectionControls range={range} containerRef={root} showHandles
        pdfTouch={surface === 'pdf-layout'} managedText={surface !== 'pdf-layout'}
        color={nextColor} onUpdate={onUpdate} onEditingChange={() => {}} hitTest={hit}>
        Menu
      </EngineSelectionControls>
    </RangeMagnifierProvider>
  </div>
  const view = render(controls())
  mockElementSize(root.current!, { width: 500, height: 500 })
  if (frame) mockElementSize(frame, { left: 13, top: 19, width: 450, height: 400 })
  view.rerender(controls())
  const handles = screen.getAllByRole('button', { name: /调整/ })
  const handle = handles[end ? 1 : 0]
  handle.setPointerCapture = vi.fn()
  const x = end ? 120 : 50, y = 140
  const point = { clientX: x + (frame ? 13 : 0), clientY: y + (frame ? 19 : 0) }
  try {
    fireEvent.pointerDown(handle, { pointerId: 7, pointerType, button: 0, clientX: 7, clientY: 8 })
    fireEvent.pointerMove(document, { pointerId: 7, pointerType, ...point })
    expect(hit).toHaveBeenLastCalledWith(x, y)
    expect(screen.getAllByRole('button', { name: /调整/ })).toEqual(handles)
    const lens = screen.getByTestId('range-magnifier')
    expect(lens.hidden).toBe(pointerType !== 'touch')
    if (pointerType === 'touch') {
      const marker = lens.querySelector<HTMLElement>('.hamster-reader__range-magnifier-marker')!
      expect(marker.style.backgroundColor).toBe(target === 'saved' ? 'rgb(18, 52, 255)' : 'rgb(255, 18, 52)')
      const firstCopy = lens.querySelector('.hamster-reader__range-magnifier-text')!.firstChild
      const before = lens.style.left
      fireEvent.pointerMove(document, { pointerId: 7, pointerType, ...point, clientX: point.clientX + 1 })
      expect(lens.style.left).not.toBe(before)
      expect(lens.querySelector('.hamster-reader__range-magnifier-text')!.firstChild).toBe(firstCopy)
      view.rerender(controls(true, '#00ff00'))
      expect(marker.style.backgroundColor).toBe('rgb(0, 255, 0)')
    }
    // Release at a newer boundary without running another animation frame.
    fireEvent.pointerUp(document, { pointerId: 7, pointerType, ...point, clientX: point.clientX + (end ? 10 : -10) })
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate.mock.calls[0][0][end ? 'endOffset' : 'startOffset']).toBe(end ? 19 : 10)
    expect(lens.hidden).toBe(true)
    expect(screenshot).not.toHaveBeenCalled()
    // Disabling the feature cannot disable endpoint editing.
    view.rerender(controls(false))
    fireEvent.pointerDown(handle, { pointerId: 8, pointerType: 'touch', button: 0 })
    expect(screen.queryByTestId('range-magnifier')).toBeNull()
    fireEvent.pointerCancel(document, { pointerId: 8 })
  } finally {
    view.unmount()
    if (previous) Object.defineProperty(proto, 'getClientRects', previous)
    else Reflect.deleteProperty(proto, 'getClientRects')
    if (previousBounding) Object.defineProperty(proto, 'getBoundingClientRect', previousBounding)
    else Reflect.deleteProperty(proto, 'getBoundingClientRect')
    Reflect.deleteProperty(doc, 'caretRangeFromPoint')
    paragraph.remove()
    frame?.remove()
  }
})

it('positions a continuous 60px lens 38px from the finger and flips only at the top', () => {
  const root = new DOMRect(13, 19, 400, 600)
  for (const y of [200, 201, 202, 500]) {
    const p = resolveMagnifierPosition({ clientX: 140, clientY: y }, root)
    expect(p.placement).toBe('above')
    expect(p.top + root.top + 30).toBe(y - 38)
    expect(p.left + root.left + 30).toBe(140)
  }
  expect(resolveMagnifierPosition({ clientX: 140, clientY: 40 }, root).placement).toBe('below')
  expect(resolveMagnifierPosition({ clientX: 140, clientY: 200 }, root).placement).toBe('above')
  expect(resolveMagnifierPosition({ clientX: 0, clientY: 40 }, root).left).toBe(8)
})

it('anchors the marker at a source boundary while the view moves, then jumps without interpolation', () => {
  const p = document.createElement('p')
  p.textContent = 'abcd'
  document.body.append(p)
  const range = document.createRange()
  range.setStart(p.firstChild!, 0)
  range.setEnd(p.firstChild!, 1)
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value(this: Range) {
    return [new DOMRect(100 + this.startOffset * 10, 200, 0, 20)]
  } })
  const focus = { range, end: true, color: '#ff0000' }
  try {
    expect(insertionRect(focus)?.left).toBe(110)
    const first = projectInsertionMarker(focus, { clientX: 110, clientY: 210 })!
    const second = projectInsertionMarker(focus, { clientX: 112, clientY: 210 })!
    expect(first.left - second.left).toBe(4)
    expect(insertionRect(focus)?.left).toBe(110)
    act(() => range.setEnd(p.firstChild!, 2))
    expect(insertionRect(focus)?.left).toBe(120)
    expect(projectInsertionMarker({ ...focus, valid: false }, { clientX: 112, clientY: 210 })).toBeNull()
  } finally { Reflect.deleteProperty(Range.prototype, 'getClientRects'); p.remove() }
})
