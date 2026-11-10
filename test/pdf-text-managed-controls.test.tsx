import type {
  LinkedSelectionData,
  LinkedSelectionRange
} from '@hamster-note/selection'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PdfTextSelectionControls } from '../src/pdf/PdfTextSelectionControls'
import { mockElementSize } from './setup'

it.each([false, true])(
  'retains an unmounted fixed PDF endpoint (end=%s), identity and comments',
  (end) => {
    const root = document.createElement('div')
    root.innerHTML =
      '<div data-selection-id="visible"><div class="hsn-selection-content">abcdefgh</div></div>'
    document.body.append(root)
    mockElementSize(root, { width: 500, height: 500 })
    const node = root.querySelector('.hsn-selection-content')!.firstChild!
    const original = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects'
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
    const range: LinkedSelectionRange & { commentIds: string[] } = {
      id: 'saved',
      text: end ? 'previousabcd' : 'cdefghfollowing',
      createdAt: 1,
      start: { selectionId: end ? 'unmounted' : 'visible', offset: 2 },
      end: { selectionId: end ? 'visible' : 'unmounted', offset: 4 },
      markerStyle: { backgroundColor: '#ff0000' },
      rectsBySelectionId: {},
      commentIds: ['comment-1']
    }
    const data: LinkedSelectionData = {
      items: [range],
      selectedRangeId: range.id,
      selectionOrder: [],
      activeRange: null
    }
    const caret = root.ownerDocument.createRange()
    caret.setStart(node, end ? 5 : 1)
    caret.collapse(true)
    const previousCaret = Object.getOwnPropertyDescriptor(
      document,
      'caretRangeFromPoint'
    )
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: () => caret
    })
    const update = vi.fn(),
      draft = vi.fn()
    const view = render(
      <PdfTextSelectionControls
        root={root}
        data={data}
        color='#00ff00'
        onEditingChange={() => {}}
        onDraft={draft}
        onUpdate={update}
      />
    )
    try {
      const handles = screen.getAllByRole('button', { name: /调整/ })
      expect(handles).toHaveLength(1)
      expect(handles[0]).toHaveAccessibleName(
        end ? '调整高亮终点' : '调整高亮起点'
      )
      handles[0].setPointerCapture = vi.fn()
      fireEvent.pointerDown(handles[0], {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0
      })
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 50, clientY: 110 })
      expect(update).toHaveBeenCalledOnce()
      const result = update.mock.calls[0][0] as LinkedSelectionRange & {
        commentIds: string[]
      }
      expect(result[end ? 'start' : 'end']).toEqual(
        range[end ? 'start' : 'end']
      )
      expect(result[end ? 'end' : 'start']).toEqual({
        selectionId: 'visible',
        offset: end ? 5 : 1
      })
      expect(result.text).toBe(end ? 'previousabcde' : 'bcdefghfollowing')
      expect(result.id).toBe(range.id)
      expect(result.markerStyle).toEqual(range.markerStyle)
      expect(result.commentIds).toEqual(['comment-1'])
      expect(draft).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      root.remove()
      if (original)
        Object.defineProperty(Range.prototype, 'getClientRects', original)
      else Reflect.deleteProperty(Range.prototype, 'getClientRects')
      if (previousCaret)
        Object.defineProperty(document, 'caretRangeFromPoint', previousCaret)
      else Reflect.deleteProperty(document, 'caretRangeFromPoint')
    }
  }
)
