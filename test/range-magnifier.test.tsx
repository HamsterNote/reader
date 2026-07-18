import type {
  HandleRenderProps,
  LinkedSelectionData
} from '@hamster-note/selection'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RangeHandle } from '../src/components/IntermediateDocumentViewer/RangeHandle'
import {
  RangeMagnifierProvider,
  resolveMagnifierPosition,
  resolveMagnifierSourceRect
} from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
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
  html2canvasMock.mockReset()
})

describe('range magnifier', () => {
  it('places the lens below when the handle has insufficient room above', () => {
    const position = resolveMagnifierPosition(
      { clientX: 160, clientY: 70 },
      new DOMRect(10, 20, 300, 400)
    )

    expect(position).toEqual({ left: 90, top: 68, placement: 'below' })
  })

  it('keeps the sampled source rectangle inside a short page snapshot', () => {
    // Given: a rendered page shorter than the desired 2x magnifier crop.
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = 244
    sourceCanvas.height = 16

    // When: the crop is resolved around a handle near the page center.
    const sourceRect = resolveMagnifierSourceRect(
      {
        canvas: sourceCanvas,
        sourceRect: new DOMRect(676, 450, 244, 16)
      },
      { clientX: 798, clientY: 458 }
    )

    // Then: every sampled pixel remains within the captured canvas.
    expect(sourceRect).toEqual({ x: 92, y: 0, width: 60, height: 16 })
  })

  it('shows outside virtual-paper while dragging and hides on pointer up', () => {
    // Given: a range handle inside a transformed page and a root-level portal host.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const portalHost = document.createElement('div')
    document.body.append(portalHost)

    const { container, unmount } = render(
      <RangeMagnifierProvider rootElement={portalHost}>
        <div className='virtual-paper-container'>
          <div className='hamster-reader__intermediate-page'>
            <RangeHandle
              handle={handle}
              linkedData={linkedData}
              scale={2}
              selectionId={selectionId}
            />
          </div>
        </div>
      </RangeMagnifierProvider>
    )
    const page = container.querySelector<HTMLElement>(
      '.hamster-reader__intermediate-page'
    )
    const circle = screen.getByRole('button', { name: 'Drag range start' })
    if (!page) throw new Error('Expected page element')
    mockElementSize(portalHost, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(page, { left: 30, top: 40, width: 200, height: 300 })
    mockElementSize(circle, { left: 140, top: 260, width: 20, height: 20 })

    // When: the user starts, moves, and finishes a handle drag.
    fireEvent.pointerDown(circle, {
      pointerId: 7,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })
    const magnifier = screen.getByTestId('range-magnifier')

    // Then: the lens is a root child, uses corrected center coordinates, and
    // captures only the page that owns the handle.
    expect(magnifier.parentElement).toBe(portalHost)
    expect(magnifier).not.toHaveAttribute('hidden')
    expect(magnifier).toHaveAttribute('data-placement', 'above')
    expect(magnifier).toHaveStyle({ left: '80px', top: '112px' })
    expect(
      magnifier.closest('.virtual-paper-container')
    ).not.toBeInTheDocument()
    expect(html2canvasMock).toHaveBeenCalledWith(
      page,
      expect.objectContaining({ logging: false, useCORS: true })
    )

    fireEvent.pointerMove(document, {
      pointerId: 7,
      clientX: 155,
      clientY: 275,
      buttons: 1
    })
    expect(magnifier).toHaveStyle({ left: '90px', top: '122px' })

    fireEvent.pointerUp(document, { pointerId: 7 })
    expect(magnifier).toHaveAttribute('hidden')

    unmount()
    portalHost.remove()
  })

  it('stays visible when the selection layer removes the handle during drag', async () => {
    // Given: a live drag whose selection DOM removes its handle after pointer down.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const portalHost = document.createElement('div')
    document.body.append(portalHost)
    const renderSelection = (showHandle: boolean) => (
      <RangeMagnifierProvider rootElement={portalHost}>
        <div className='hamster-reader__intermediate-page'>
          {showHandle ? (
            <RangeHandle
              handle={handle}
              linkedData={linkedData}
              scale={2}
              selectionId={selectionId}
            />
          ) : null}
        </div>
      </RangeMagnifierProvider>
    )
    const { rerender, unmount } = render(renderSelection(true))
    const circle = screen.getByRole('button', { name: 'Drag range start' })
    mockElementSize(portalHost, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(circle, { left: 140, top: 260, width: 20, height: 20 })
    fireEvent.pointerDown(circle, {
      pointerId: 9,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })
    const magnifier = screen.getByTestId('range-magnifier')

    // When: the selection renderer removes the handle while the pointer is down.
    rerender(renderSelection(false))
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.pointerMove(document, {
      pointerId: 9,
      clientX: 155,
      clientY: 275,
      buttons: 1
    })

    // Then: the active drag owns the lens until the real pointer-up boundary.
    expect(magnifier).not.toHaveAttribute('hidden')
    expect(magnifier).toHaveStyle({ left: '90px', top: '122px' })
    fireEvent.pointerUp(document, { pointerId: 9 })
    expect(magnifier).toHaveAttribute('hidden')

    unmount()
    portalHost.remove()
  })

  it('ignores pointer up from a pointer that does not own the drag', () => {
    // Given: a magnifier drag owned by pointer 11.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const portalHost = document.createElement('div')
    document.body.append(portalHost)
    const { unmount } = render(
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
    const circle = screen.getByRole('button', { name: 'Drag range start' })
    mockElementSize(portalHost, { left: 10, top: 20, width: 320, height: 480 })
    mockElementSize(circle, { left: 140, top: 260, width: 20, height: 20 })
    fireEvent.pointerDown(circle, {
      pointerId: 11,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })
    const magnifier = screen.getByTestId('range-magnifier')

    // When: another active pointer ends before the drag-owning pointer.
    fireEvent.pointerUp(document, { pointerId: 12 })

    // Then: only pointer 11 can end this drag session.
    expect(magnifier).not.toHaveAttribute('hidden')
    fireEvent.pointerUp(document, { pointerId: 11 })
    expect(magnifier).toHaveAttribute('hidden')

    unmount()
    portalHost.remove()
  })

  it('removes document drag listeners when the magnifier provider unmounts', () => {
    // Given: an active drag with document-owned move and terminal listeners.
    html2canvasMock.mockReturnValue(new Promise<HTMLCanvasElement>(() => {}))
    const portalHost = document.createElement('div')
    document.body.append(portalHost)
    const { unmount } = render(
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
    const circle = screen.getByRole('button', { name: 'Drag range start' })
    mockElementSize(circle, { left: 140, top: 260, width: 20, height: 20 })
    const addListenerSpy = vi.spyOn(document, 'addEventListener')
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener')
    fireEvent.pointerDown(circle, {
      pointerId: 13,
      clientX: 145,
      clientY: 265,
      buttons: 1
    })
    const dragListeners = addListenerSpy.mock.calls.filter(
      ([type]) =>
        type === 'pointermove' ||
        type === 'pointerup' ||
        type === 'pointercancel'
    )

    // When: the whole provider leaves the page before pointer up.
    unmount()

    // Then: every document listener owned by the drag session is released.
    for (const [type, listener, options] of dragListeners) {
      expect(removeListenerSpy).toHaveBeenCalledWith(type, listener, options)
    }

    addListenerSpy.mockRestore()
    removeListenerSpy.mockRestore()
    portalHost.remove()
  })
})
