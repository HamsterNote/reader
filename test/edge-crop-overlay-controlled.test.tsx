import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EdgeCropOverlay } from '../src/components/IntermediateDocumentViewer/EdgeCropOverlay'
import type { ReaderPageEdgeCrop } from '../src/types/readerData'
import { mockElementSize } from './setup'

const initialCrop: ReaderPageEdgeCrop = {
  all: { top: 0.1, right: 0, bottom: 0, left: 0 }
}

const updatedCrop: ReaderPageEdgeCrop = {
  all: { top: 0.4, right: 0, bottom: 0, left: 0 }
}

const finalCrop: ReaderPageEdgeCrop = {
  all: { top: 0.5, right: 0, bottom: 0, left: 0 }
}

describe('EdgeCropOverlay controlled values', () => {
  it('updates crop guides when controlled props change while idle', () => {
    // Given: an idle overlay displaying the current controlled crop.
    const { rerender } = render(
      <EdgeCropOverlay pageNumber={1} edgeCrop={initialCrop} />
    )
    const topLine = screen.getByTestId('edge-crop-line-top')
    expect(topLine).toHaveStyle({ top: '10%' })

    // When: the host replaces the controlled crop.
    rerender(<EdgeCropOverlay pageNumber={1} edgeCrop={updatedCrop} />)

    // Then: the guide reflects the latest host value.
    expect(topLine).toHaveStyle({ top: '40%' })
  })

  it('defers controlled updates until an active drag finishes', () => {
    // Given: the user is dragging a guide with a local draft value.
    const { container, rerender } = render(
      <EdgeCropOverlay pageNumber={1} edgeCrop={initialCrop} />
    )
    const overlay = container.querySelector(
      '.hamster-reader__edge-crop-overlay'
    )
    if (!(overlay instanceof HTMLElement)) {
      throw new Error('Expected the crop overlay to render')
    }
    mockElementSize(overlay, { width: 200, height: 400 })
    const topLine = screen.getByTestId('edge-crop-line-top')
    fireEvent.pointerDown(topLine, {
      clientX: 100,
      clientY: 80,
      pointerId: 1
    })
    fireEvent.pointerMove(topLine, {
      clientX: 100,
      clientY: 80,
      pointerId: 1
    })
    expect(topLine).toHaveStyle({ top: '20%' })

    // When: the host updates the crop before the pointer is released.
    rerender(<EdgeCropOverlay pageNumber={1} edgeCrop={updatedCrop} />)

    // Then: the active draft remains visible until release, then yields to the host.
    expect(topLine).toHaveStyle({ top: '20%' })
    fireEvent.pointerUp(topLine, {
      clientX: 100,
      clientY: 80,
      pointerId: 1
    })
    expect(topLine).toHaveStyle({ top: '40%' })
  })

  it('finishes an active drag when the pointer is cancelled', () => {
    // Given: a controlled update arrives while the user has an active local draft.
    const { container, rerender } = render(
      <EdgeCropOverlay pageNumber={1} edgeCrop={initialCrop} />
    )
    const overlay = container.querySelector(
      '.hamster-reader__edge-crop-overlay'
    )
    if (!(overlay instanceof HTMLElement)) {
      throw new Error('Expected the crop overlay to render')
    }
    mockElementSize(overlay, { width: 200, height: 400 })
    const topLine = screen.getByTestId('edge-crop-line-top')
    fireEvent.pointerDown(topLine, { clientX: 100, clientY: 80, pointerId: 1 })
    fireEvent.pointerMove(topLine, { clientX: 100, clientY: 80, pointerId: 1 })
    rerender(<EdgeCropOverlay pageNumber={1} edgeCrop={updatedCrop} />)
    expect(topLine).toHaveStyle({ top: '20%' })

    // When: the browser cancels the captured pointer instead of dispatching pointerup.
    fireEvent.pointerCancel(topLine, {
      clientX: 100,
      clientY: 80,
      pointerId: 1
    })

    // Then: the pending value wins and later controlled updates are no longer deferred.
    expect(topLine).toHaveStyle({ top: '40%' })
    rerender(<EdgeCropOverlay pageNumber={1} edgeCrop={finalCrop} />)
    expect(topLine).toHaveStyle({ top: '50%' })
  })
})
