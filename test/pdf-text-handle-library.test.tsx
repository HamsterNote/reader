import type {
  HandleRenderProps,
  LinkedSelectionData,
  LinkedSelectionRange,
  SelectionRef
} from '@hamster-note/selection'
import { act, fireEvent, render } from '@testing-library/react'
import { createRequire } from 'node:module'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { Selection: LibrarySelection } = createRequire(import.meta.url)(
  '@hamster-note/selection'
) as typeof import('@hamster-note/selection')

const magnifier = vi.hoisted(() => ({
  end: vi.fn(),
  move: vi.fn(),
  registerDragCleanup: vi.fn(() => vi.fn()),
  start: vi.fn()
}))

vi.mock('../src/components/IntermediateDocumentViewer/RangeMagnifier', () => ({
  useRangeMagnifier: () => magnifier
}))

import { PdfTextHandle } from '../src/pdf/PdfTextHandle'

const selectionId = 'page-1'
const originalGetClientRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getClientRects'
)
const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getBoundingClientRect'
)
const originalCaretRangeFromPoint = Object.getOwnPropertyDescriptor(
  document,
  'caretRangeFromPoint'
)
const originalElementFromPoint = Object.getOwnPropertyDescriptor(
  document,
  'elementFromPoint'
)
let textElement: HTMLSpanElement | null = null

const characterRect = (offset: number) =>
  new DOMRect(10 + offset * 10, 40 + Math.floor(offset / 4) * 30, 10, 20)

const pointOffset = (clientX: number, clientY: number) => {
  const offset = Array.from({ length: 8 }, (_, index) => index).find(
    (index) => {
      const rect = characterRect(index)
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      )
    }
  )
  return offset ?? null
}

const makeRange = () =>
  ({
    id: 'saved-range',
    text: 'bcd',
    start: { selectionId, offset: 1 },
    end: { selectionId, offset: 4 },
    createdAt: 1,
    overlayRectType: 'px',
    rectsBySelectionId: {
      [selectionId]: [{ x: 10, y: 20, width: 30, height: 20 }]
    },
    markerStyle: { backgroundColor: 'rgba(10, 20, 30, 0.35)' },
    commentIds: ['comment-1']
  }) as LinkedSelectionRange & { commentIds: string[] }

const Harness = ({
  owner,
  selectionRef,
  onLinkedSelect,
  onLinkedUpdateRange
}: {
  owner: HandleRenderProps['owner']
  selectionRef: React.RefObject<SelectionRef | null>
  onLinkedSelect: (range: LinkedSelectionRange) => void
  onLinkedUpdateRange: (range: LinkedSelectionRange) => void
}) => {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [linkedData, setLinkedData] = useState<LinkedSelectionData>(() => {
    const range = makeRange()
    return {
      items: owner === 'persisted-range' ? [range] : [],
      selectedRangeId: owner === 'persisted-range' ? range.id : null,
      selectionOrder: [],
      activeRange: owner === 'active-selection' ? range : null
    }
  })
  return (
    <div
      ref={setRoot}
      className='hamster-reader__intermediate-document-viewer'
      data-selection-id={selectionId}
    >
      <LibrarySelection
        ref={selectionRef}
        selectionId={selectionId}
        linkedMode
        linkedData={linkedData}
        onLinkedDataChange={setLinkedData}
        onLinkedSelect={onLinkedSelect}
        onLinkedUpdateRange={onLinkedUpdateRange}
        ranges={[]}
        overlayRectType='px'
        markerStyle={{ backgroundColor: 'rgba(10, 20, 30, 0.35)' }}
        renderHandle={(handle) => (
          <PdfTextHandle
            handle={handle}
            linkedData={linkedData}
            root={root}
            selectionId={selectionId}
            width={300}
            column={0}
            magnifierEnabled
          />
        )}
      >
        <span
          ref={(element) => {
            textElement = element
          }}
          data-selection-start-offset='0'
          data-text-id='glyph'
        >
          abcdefgh
        </span>
      </LibrarySelection>
    </div>
  )
}

beforeEach(() => {
  const defaultGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (
        this.classList.contains('hsn-selection-container') ||
        this.classList.contains('hsn-selection-content')
      )
        return new DOMRect(10, 20, 300, 200)
      return defaultGetBoundingClientRect.call(this)
    }
  )
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) {
      if (this.startContainer.nodeType !== Node.TEXT_NODE)
        return Array.from({ length: 8 }, (_, offset) => characterRect(offset))
      if (this.collapsed) return [characterRect(this.startOffset)]
      return Array.from(
        { length: Math.max(1, this.endOffset - this.startOffset) },
        (_, index) => characterRect(this.startOffset + index)
      )
    }
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: Range) {
      return this.getClientRects()[0] ?? new DOMRect()
    }
  })
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: (clientX: number, clientY: number) => {
      const offset = pointOffset(clientX, clientY)
      const node = textElement?.firstChild
      if (offset === null || !node) return null
      const range = document.createRange()
      range.setStart(node, offset)
      range.collapse(true)
      return range
    }
  })
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: (clientX: number, clientY: number) =>
      pointOffset(clientX, clientY) === null
        ? textElement?.parentElement
        : textElement
  })
})

afterEach(() => {
  textElement = null
  vi.restoreAllMocks()
  const descriptors = [
    [Range.prototype, 'getClientRects', originalGetClientRects],
    [Range.prototype, 'getBoundingClientRect', originalGetBoundingClientRect],
    [document, 'caretRangeFromPoint', originalCaretRangeFromPoint],
    [document, 'elementFromPoint', originalElementFromPoint]
  ] as const
  for (const [target, key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
  Object.values(magnifier).forEach((mock) => mock.mockClear())
})

const renderLibrary = (owner: HandleRenderProps['owner']) => {
  const selectionRef = createRef<SelectionRef>()
  const onLinkedSelect = vi.fn()
  const onLinkedUpdateRange = vi.fn()
  const view = render(
    <Harness
      owner={owner}
      selectionRef={selectionRef}
      onLinkedSelect={onLinkedSelect}
      onLinkedUpdateRange={onLinkedUpdateRange}
    />
  )
  const endHandle = view.container.querySelector<HTMLElement>(
    '[data-pdf-handle-hit-target="end"]'
  )!
  return {
    ...view,
    selectionRef,
    onLinkedSelect,
    onLinkedUpdateRange,
    endHandle
  }
}

const releaseBeforeAnotherFrame = async (
  handle: Element,
  pointerType: 'mouse' | 'touch' = 'touch'
) => {
  await act(async () => {
    fireEvent.pointerDown(handle, {
      pointerId: 21,
      pointerType,
      isPrimary: true,
      clientX: 50,
      clientY: 70
    })
    fireEvent.pointerUp(document, {
      pointerId: 21,
      pointerType,
      clientX: 70,
      clientY: 90
    })
    await Promise.resolve()
  })
}

describe('PdfTextHandle linked selection integration', () => {
  it('confirms one draft using the final corrected source character', async () => {
    const view = renderLibrary('active-selection')
    const range = document.createRange()
    range.setStart(textElement!.firstChild!, 1)
    range.setEnd(textElement!.firstChild!, 4)
    window.getSelection()?.addRange(range)
    await act(async () => {
      document.dispatchEvent(new Event('selectionchange'))
      await Promise.resolve()
    })
    await releaseBeforeAnotherFrame(view.endHandle)

    expect(view.onLinkedSelect).not.toHaveBeenCalled()
    await act(async () => view.selectionRef.current?.confirm())
    expect(view.onLinkedSelect).toHaveBeenCalledTimes(1)
    expect(view.onLinkedSelect.mock.calls[0][0]).toMatchObject({
      start: { selectionId, offset: 1 },
      end: { selectionId, offset: 5 },
      markerStyle: { backgroundColor: 'rgba(10, 20, 30, 0.35)' }
    })
  })

  it('updates one saved highlight without replacing its identity or associations', async () => {
    const view = renderLibrary('persisted-range')
    await releaseBeforeAnotherFrame(view.endHandle)

    expect(view.onLinkedUpdateRange).toHaveBeenCalledTimes(1)
    expect(view.onLinkedUpdateRange.mock.calls[0][0]).toMatchObject({
      id: 'saved-range',
      end: { selectionId, offset: 5 },
      markerStyle: { backgroundColor: 'rgba(10, 20, 30, 0.35)' },
      commentIds: ['comment-1']
    })
    expect(view.onLinkedSelect).not.toHaveBeenCalled()
  })

  it('keeps desktop mouse adjustment on the same linked update path', async () => {
    const view = renderLibrary('persisted-range')
    await releaseBeforeAnotherFrame(view.endHandle, 'mouse')
    expect(view.onLinkedUpdateRange).toHaveBeenCalledTimes(1)
    expect(view.onLinkedUpdateRange.mock.calls[0][0]).toMatchObject({
      id: 'saved-range',
      end: { selectionId, offset: 5 }
    })
  })

  it('does not update or confirm a saved highlight on pointercancel', () => {
    const view = renderLibrary('persisted-range')
    act(() => {
      fireEvent.pointerDown(view.endHandle, {
        pointerId: 22,
        pointerType: 'touch',
        clientX: 50,
        clientY: 70
      })
      fireEvent.pointerCancel(document, {
        pointerId: 22,
        pointerType: 'touch',
        clientX: 70,
        clientY: 90
      })
    })

    expect(view.onLinkedUpdateRange).not.toHaveBeenCalled()
    expect(view.onLinkedSelect).not.toHaveBeenCalled()
    expect(magnifier.end).toHaveBeenCalledTimes(1)
    view.unmount()
    fireEvent.pointerMove(document, {
      pointerId: 22,
      clientX: 70,
      clientY: 90
    })
    expect(view.onLinkedUpdateRange).not.toHaveBeenCalled()
  })
})
