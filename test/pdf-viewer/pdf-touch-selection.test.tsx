import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { expect, it } from 'vitest'
import { usePdfTouchSelection } from '../../src/pdf/pdfTouchSelection'

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
