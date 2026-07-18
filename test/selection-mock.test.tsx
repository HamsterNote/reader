import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearSelectionProps,
  getAllSelectionProps,
  getSelectionPropsById,
  Selection,
  simulateLinkedDataChange,
  simulateLinkedSelect,
  simulateLinkedSelectRange,
  simulateLinkedUpdateRange,
  simulateSelectionClear,
  simulateSelectionHighlight
} from './mocks/selection'

const linkedRange = {
  id: 'range-1',
  text: 'Linked text',
  start: { selectionId: 'reader-1:page-1', offset: 0 },
  end: { selectionId: 'reader-1:page-2', offset: 5 },
  createdAt: 1,
  rectsBySelectionId: {
    'reader-1:page-1': [{ x: 0, y: 0, width: 10, height: 10 }],
    'reader-1:page-2': [{ x: 0, y: 10, width: 10, height: 10 }]
  }
}

describe('@hamster-note/selection test mock', () => {
  afterEach(() => {
    clearSelectionProps()
  })

  it('tracks linked Selection props independently by runtime selectionId', () => {
    render(
      <>
        <Selection selectionId='reader-1:page-1' linkedMode>
          Page 1
        </Selection>
        <Selection selectionId='reader-1:page-2' linkedMode>
          Page 2
        </Selection>
        <Selection selectionId='reader-1:page-3' linkedMode>
          Page 3
        </Selection>
      </>
    )

    expect(getAllSelectionProps()).toHaveLength(3)
    expect(getSelectionPropsById('reader-1:page-1')?.selectionId).toBe(
      'reader-1:page-1'
    )
    expect(getAllSelectionProps().map((props) => props.selectionId)).toEqual([
      'reader-1:page-1',
      'reader-1:page-2',
      'reader-1:page-3'
    ])
    expect(
      Array.from(
        globalThis.document.querySelectorAll('.hsn-selection-container')
      ).map((element) => element.getAttribute('data-selection-id'))
    ).toEqual(['reader-1:page-1', 'reader-1:page-2', 'reader-1:page-3'])
    expect(screen.getAllByText(/Page/)).toHaveLength(3)
  })

  it('does not include direct render legacy instances in linked props registry', () => {
    render(<Selection>Direct content</Selection>)

    expect(getAllSelectionProps()).toHaveLength(0)
    expect(screen.getByText('Direct content')).toBeInTheDocument()
  })

  it('simulates linked callbacks and imperative helpers for one runtime id', () => {
    const onLinkedDataChange = vi.fn()
    const onLinkedSelect = vi.fn()
    const onLinkedUpdateRange = vi.fn()
    const onLinkedSelectRange = vi.fn()
    const onSelect = vi.fn()
    const onHighlight = vi.fn()

    render(
      <Selection
        selectionId='reader-1:page-1'
        linkedMode
        onLinkedDataChange={onLinkedDataChange}
        onLinkedSelect={onLinkedSelect}
        onLinkedUpdateRange={onLinkedUpdateRange}
        onLinkedSelectRange={onLinkedSelectRange}
        onSelect={onSelect}
        onHighlight={onHighlight}
      >
        Page 1
      </Selection>
    )

    const linkedData = {
      items: [linkedRange],
      selectedRangeId: 'range-1',
      selectionOrder: ['reader-1:page-1', 'reader-1:page-2'],
      overlayRectType: 'percent' as const,
      activeRange: linkedRange
    }

    simulateLinkedDataChange('reader-1:page-1', linkedData)
    simulateLinkedSelect('reader-1:page-1', linkedRange)
    simulateLinkedUpdateRange('reader-1:page-1', linkedRange)
    simulateLinkedSelectRange('reader-1:page-1', 'range-1')
    simulateSelectionHighlight('reader-1:page-1')
    simulateSelectionClear('reader-1:page-1')

    expect(onLinkedDataChange).toHaveBeenCalledWith(linkedData)
    expect(onLinkedSelect).toHaveBeenCalledWith(linkedRange)
    expect(onLinkedUpdateRange).toHaveBeenCalledWith(linkedRange)
    expect(onLinkedSelectRange).toHaveBeenCalledWith('range-1')
    expect(onSelect).not.toHaveBeenCalled()
    expect(onHighlight).not.toHaveBeenCalled()
  })
})
