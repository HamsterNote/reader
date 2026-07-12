import type {
  SelectionProps,
  SelectionRange,
  SelectionRef
} from '@hamster-note/selection'
import type { IntermediateDocument } from '@hamster-note/types'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IntermediateDocumentViewer } from '../src/components/IntermediateDocumentViewer'

type SelectionCall = {
  ranges: SelectionRange[]
  selectionId: string | undefined
}

const selectionCalls = vi.hoisted((): SelectionCall[] => [])

vi.mock('@hamster-note/selection', async () => {
  const React = await import('react')
  const Selection = React.forwardRef<SelectionRef, SelectionProps>(
    (props, ref) => {
      selectionCalls.push({
        ranges: props.ranges,
        selectionId: props.selectionId
      })

      React.useImperativeHandle(
        ref,
        () => ({
          highlight: () => {},
          confirm: () => {},
          confirmRect: () => {},
          clear: () => {}
        }),
        []
      )

      return React.createElement(
        'div',
        { 'data-testid': `mock-selection-${props.selectionId ?? 'legacy'}` },
        props.children
      )
    }
  )

  return { Selection, default: Selection }
})

vi.mock('@hamster-note/virtual-paper', async () => {
  const React = await import('react')

  return {
    DEFAULT_ENABLED_INTERACTIONS: [
      'trackpadScrollPan',
      'mouseWheelCtrlZoom',
      'touchSingleFingerPan',
      'touchTwoFingerZoom'
    ],
    VirtualPaper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-virtual-paper' },
        children
      ),
    VirtualPaperInteractionMode: {
      MouseWheelCtrlZoom: 'mouseWheelCtrlZoom',
      MouseWheelZoom: 'mouseWheelZoom',
      TouchSingleFingerPan: 'touchSingleFingerPan',
      TouchTwoFingerPan: 'touchTwoFingerPan',
      TouchTwoFingerZoom: 'touchTwoFingerZoom'
    }
  }
})

function makeText(pageNumber: number) {
  return {
    id: `text-${pageNumber}`,
    content: `Page ${pageNumber} text`,
    fontSize: 12,
    fontFamily: 'Arial',
    fontWeight: 400,
    italic: false,
    color: '#111111',
    polygon: [
      [10, 20],
      [50, 20],
      [50, 36],
      [10, 36]
    ],
    lineHeight: 16,
    ascent: 10,
    descent: 2,
    dir: 'ltr',
    skew: 0,
    isEOL: false
  }
}

function makeLazyDocument(): IntermediateDocument {
  return {
    id: 'doc-1',
    title: 'Hamster Reader Title',
    pageCount: 1,
    pageNumbers: [1],
    getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
    getPageByPageNumber: vi.fn((pageNumber: number) =>
      Promise.resolve({
        getContent: vi.fn(async () => [makeText(pageNumber)])
      })
    )
  } as unknown as IntermediateDocument
}

function lastSelectionCall(): SelectionCall {
  const call = selectionCalls[selectionCalls.length - 1]
  if (!call) {
    throw new Error('Expected the mocked Selection component to render')
  }
  return call
}

describe('IntermediateDocumentViewer selection stability', () => {
  it('keeps linked empty ranges stable across document viewer rerenders', async () => {
    selectionCalls.length = 0
    const document = makeLazyDocument()

    const { rerender } = render(
      <IntermediateDocumentViewer
        document={document}
        className='first-render'
      />
    )

    await waitFor(() => {
      expect(selectionCalls.length).toBeGreaterThan(0)
    })
    const firstRanges = lastSelectionCall().ranges
    const firstCallCount = selectionCalls.length

    rerender(
      <IntermediateDocumentViewer
        document={document}
        className='second-render'
      />
    )

    await waitFor(() => {
      expect(selectionCalls.length).toBeGreaterThan(firstCallCount)
    })
    expect(lastSelectionCall().ranges).toBe(firstRanges)
  })
})
