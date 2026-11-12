import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { IntermediateDocumentTextViewer } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import { crossPageDocument, crossPageRange } from './fixtures/pdf-cross-page'
import { clearSelectionProps, getAllSelectionProps } from './mocks/selection'
import { mockElementSize, resizeObserverMock } from './setup'

async function mount(spaced: boolean, controlled: boolean) {
  clearSelectionProps()
  const saved = crossPageRange(spaced)
  const source = crossPageDocument(spaced)
  const progress = { currentPageNumber: 2 }
  const snapshots = vi.fn()
  const updates = vi.fn()
  const removes = vi.fn()
  function Host() {
    const [ranges, setRanges] = useState([saved])
    return (
      <IntermediateDocumentTextViewer
        document={source}
        isPdf
        overlayRectType='px'
        textReadingProgress={progress}
        {...(controlled ? { ranges } : { defaultRanges: [saved] })}
        defaultSelectedRangeId={saved.id}
        onLinkedDataChange={(next) => {
          snapshots(next)
          if (controlled) setRanges(next.items)
        }}
        onUpdateRange={updates}
        onRemoveRange={removes}
      />
    )
  }
  const view = render(<Host />)
  const root = screen.getByTestId('intermediate-document-text-viewer')
  await act(async () => {
    mockElementSize(root, { width: 600, height: 400 })
    resizeObserverMock.trigger(root)
  })
  await screen.findByText(spaced ? 'def' : 'abcdefg')
  await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
  expect(screen.queryByTestId('intermediate-text-page-1')).toBeNull()
  const runtime = () => getAllSelectionProps()[0]!
  return { view, root, saved, runtime, snapshots, updates, removes }
}

afterEach(clearSelectionProps)

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true]
])(
  'commits a real end-handle edit with only page 2 mounted (spaced=%s, controlled=%s)',
  async (spaced, controlled) => {
    const originalRects = Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getClientRects'
    )
    const originalCaret = Object.getOwnPropertyDescriptor(
      document,
      'caretRangeFromPoint'
    )
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [new DOMRect(40, 100, 70, 20)]
    })
    const { view, root, saved, runtime, snapshots, updates, removes } =
      await mount(spaced, controlled)
    try {
      // The fixed start is canonical and offscreen; the mounted end must be
      // DOM 7 even when source offset is 17. Only its handle should render.
      await waitFor(() =>
        expect(runtime().linkedData?.items[0]).toMatchObject({
          id: saved.id,
          start: { selectionId: expect.stringMatching(/:page-1$/), offset: 0 },
          end: { selectionId: expect.stringMatching(/:page-2$/), offset: 7 }
        })
      )
      const handles = await screen.findAllByRole('button', { name: /调整高亮/ })
      expect(handles).toHaveLength(1)
      expect(handles[0]).toHaveAccessibleName('调整高亮终点')
      const content = root.querySelector('.hsn-selection-content')!
      const anchor = content.querySelectorAll('[data-selection-start-offset]')
      expect(
        Array.from(anchor, (node) =>
          node.getAttribute('data-selection-start-offset')
        )
      ).toEqual(spaced ? ['0', '14'] : ['0'])
      const text = anchor[anchor.length - 1]!.firstChild!
      const caret = document.createRange()
      caret.setStart(text, spaced ? 2 : 6)
      caret.collapse(true)
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: () => caret
      })
      snapshots.mockClear()
      handles[0]!.setPointerCapture = vi.fn()
      fireEvent.pointerDown(handles[0]!, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0
      })
      fireEvent.pointerUp(document, {
        pointerId: 1,
        clientX: 100,
        clientY: 110
      })
      await waitFor(() => expect(snapshots).toHaveBeenCalledOnce())
      const expected = {
        ...saved,
        text: saved.text.slice(0, -1),
        end: { selectionId: 'page-2', offset: spaced ? 16 : 6 }
      }
      expect(snapshots.mock.calls[0]![0].items).toEqual([
        expect.objectContaining({
          ...expected,
          rectsBySelectionId: expect.any(Object)
        })
      ])
      expect(updates).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          ...expected,
          rectsBySelectionId: expect.any(Object)
        })
      )
      expect(removes).not.toHaveBeenCalled()
      // Verify the host that consumes snapshots and the internal uncontrolled
      // state both retain the annotation after committing and re-rendering.
      await waitFor(() =>
        expect(runtime().linkedData?.items).toEqual([
          expect.objectContaining({
            id: saved.id,
            text: expected.text,
            start: expect.objectContaining({ offset: 0 }),
            end: { selectionId: expect.stringMatching(/:page-2$/), offset: 6 },
            selectionGroup: saved.selectionGroup
          })
        ])
      )
      expect(runtime().linkedData?.selectedRangeId).toBe(saved.id)
      await waitFor(() =>
        expect(
          screen.getAllByRole('button', { name: /调整高亮/ })
        ).toHaveLength(1)
      )
    } finally {
      view.unmount()
      if (originalRects)
        Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
      else Reflect.deleteProperty(Range.prototype, 'getClientRects')
      if (originalCaret)
        Object.defineProperty(document, 'caretRangeFromPoint', originalCaret)
      else Reflect.deleteProperty(document, 'caretRangeFromPoint')
    }
  }
)

it.each([false, true])(
  'does not publish conversion failure as deletion (controlled=%s)',
  async (controlled) => {
    const { view, saved, runtime, snapshots, removes } = await mount(
      false,
      controlled
    )
    try {
      const data = runtime().linkedData!
      const invalid = {
        ...data.items[0]!,
        end: { ...data.items[0]!.end, offset: 0 }
      }
      act(() =>
        runtime().onLinkedDataChange?.({
          ...data,
          items: [invalid],
          activeRange: invalid
        })
      )
      expect(snapshots).toHaveBeenCalled()
      expect(snapshots.mock.lastCall![0].items).toEqual([saved])
      expect(removes).not.toHaveBeenCalled()
      expect(runtime().linkedData?.items).toHaveLength(1)
    } finally {
      view.unmount()
    }
  }
)
