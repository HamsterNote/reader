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

const handle: HandleRenderProps = {
  type: 'start',
  owner: 'persisted-range',
  rangeId: 'range-1',
  rectId: null,
  target: 'text',
  position: { x: 40, y: 50 },
  positionUnit: 'px',
  isDragging: false,
  onPointerDown: vi.fn(),
  ariaLabel: 'Drag selection start',
  className: 'hsn-selection-handle hsn-selection-handle--start',
  style: { left: '40px', top: '50px' }
}

const linkedData: LinkedSelectionData = {
  items: [],
  selectedRangeId: null,
  selectionOrder: []
}

afterEach(() => {
  html2canvasMock.mockReset()
  vi.mocked(handle.onPointerDown).mockReset()
})

describe('range magnifier event ordering', () => {
  it('starts after an earlier selection listener replaces the handle', () => {
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const portalHost = document.createElement('div')
    document.body.append(portalHost)

    const { unmount } = render(
      <RangeMagnifierProvider rootElement={portalHost}>
        <div className='hamster-reader__intermediate-page'>
          <RangeHandle
            handle={handle}
            linkedData={linkedData}
            scale={1}
            selectionId='reader:test:page-1'
          />
        </div>
      </RangeMagnifierProvider>
    )

    const originalHandle = screen.getByRole('button', {
      name: 'Drag selection start'
    })
    const page = originalHandle.closest<HTMLElement>(
      '.hamster-reader__intermediate-page'
    )
    if (!page) throw new Error('missing page')
    mockElementSize(portalHost, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(page, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(originalHandle, { left: 140, top: 260, width: 20, height: 20 })

    const currentHandle = originalHandle.cloneNode(true) as HTMLButtonElement
    page.replaceChild(currentHandle, originalHandle)
    mockElementSize(currentHandle, { left: 140, top: 260, width: 20, height: 20 })

    fireEvent.pointerDown(currentHandle, {
      pointerId: 17,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })

    expect(screen.getByTestId('range-magnifier')).not.toHaveAttribute('hidden')

    page.replaceChild(originalHandle, currentHandle)
    fireEvent.pointerUp(document, { pointerId: 17 })
    unmount()
    portalHost.remove()
  })
})
