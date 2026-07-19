import type {
  HandleRenderProps,
  LinkedSelectionData
} from '@hamster-note/selection'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RangeHandle } from '../src/components/IntermediateDocumentViewer/RangeHandle'
import { RangeMagnifierProvider } from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
import { mockElementSize } from './setup'

const html2canvasMock = vi.hoisted(() => vi.fn())

vi.mock('html2canvas', () => ({ default: html2canvasMock }))

const selectionId = 'reader:test:page-1'
const handle: HandleRenderProps = {
  type: 'start',
  owner: 'persisted-range',
  rangeId: 'range-1',
  target: 'text',
  rectId: null,
  position: { x: 20, y: 30 },
  positionUnit: 'px',
  isDragging: false,
  onPointerDown: vi.fn(),
  ariaLabel: 'Drag range start',
  className: 'hsn-selection-handle',
  style: { backgroundColor: 'rgba(37, 99, 235, 0.4)' }
}
const linkedData: LinkedSelectionData = {
  items: [
    {
      id: 'range-1',
      text: 'Selected text',
      start: { selectionId, offset: 0 },
      end: { selectionId, offset: 5 },
      createdAt: 1,
      rectsBySelectionId: {
        [selectionId]: [{ x: 10, y: 20, width: 40, height: 16 }]
      }
    }
  ],
  selectedRangeId: 'range-1',
  selectionOrder: [selectionId]
}

afterEach(() => {
  vi.useRealTimers()
  html2canvasMock.mockReset()
})

describe('range magnifier screenshot debounce', () => {
  it('recaptures the latest selection after 100ms and cancels pending work on drag end', () => {
    // Given: an active magnifier whose initial page screenshot is still pending.
    vi.useFakeTimers()
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const portalHost = document.createElement('div')
    document.body.append(portalHost)
    const { container, unmount } = render(
      <RangeMagnifierProvider rootElement={portalHost}>
        <div className='hamster-reader__intermediate-page'>
          <RangeHandle
            handle={handle}
            linkedData={linkedData}
            scale={2}
            selectionId={selectionId}
          />
        </div>
      </RangeMagnifierProvider>
    )
    const page = container.querySelector<HTMLElement>(
      '.hamster-reader__intermediate-page'
    )
    const circle = screen.getByRole('button', { name: 'Drag range start' })
    if (!page) throw new Error('Expected page element')
    mockElementSize(portalHost, { left: 0, top: 0, width: 320, height: 480 })
    mockElementSize(page, { left: 20, top: 30, width: 200, height: 300 })
    mockElementSize(circle, { left: 100, top: 200, width: 20, height: 20 })
    fireEvent.pointerDown(circle, {
      pointerId: 17,
      clientX: 105,
      clientY: 205,
      buttons: 1
    })
    expect(html2canvasMock).toHaveBeenCalledTimes(1)

    // When: several selection updates arrive within one debounce window.
    fireEvent.pointerMove(document, {
      pointerId: 17,
      clientX: 115,
      clientY: 215,
      buttons: 1
    })
    vi.advanceTimersByTime(99)
    fireEvent.pointerMove(document, {
      pointerId: 17,
      clientX: 125,
      clientY: 225,
      buttons: 1
    })
    vi.advanceTimersByTime(99)
    expect(html2canvasMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)

    // Then: only the latest update recaptures, and drag end cancels later work.
    expect(html2canvasMock).toHaveBeenCalledTimes(2)
    fireEvent.pointerMove(document, {
      pointerId: 17,
      clientX: 135,
      clientY: 235,
      buttons: 1
    })
    fireEvent.pointerUp(document, { pointerId: 17 })
    vi.advanceTimersByTime(100)
    expect(html2canvasMock).toHaveBeenCalledTimes(2)

    unmount()
    portalHost.remove()
  })
})
