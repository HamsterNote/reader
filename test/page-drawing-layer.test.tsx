import type {
  DrawingValue,
  PaintingControllerData
} from '@hamster-note/painting'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PageDrawingLayer } from '../src/components/PageDrawingLayer'

const controllerData: PaintingControllerData = {
  tool: 'pen',
  minimap: false,
  strokeColor: '#2563eb',
  strokeWidth: 3
}

describe('PageDrawingLayer', () => {
  it('commits a normal single-touch stroke', () => {
    // Given: drawing is enabled with an empty persisted drawing.
    const onChange = vi.fn<(nextValue: DrawingValue) => void>()
    render(
      <PageDrawingLayer
        enabled={true}
        pageId='page-1'
        controllerData={controllerData}
        onControllerDataChange={vi.fn()}
        value={{ strokes: [] }}
        onChange={onChange}
        cancelDrawingOnMultiTouch={true}
      />
    )
    const surface = screen.getByTestId('reader-painting-page-1')

    // When: one touch draws and lifts without another touch joining.
    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 20,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })
    fireEvent.pointerMove(document, {
      button: -1,
      clientX: 40,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })
    fireEvent.pointerUp(document, {
      clientX: 40,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })

    // Then: the single-touch stroke is persisted normally.
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0].strokes).toHaveLength(1)
  })

  it('does not commit a stroke when a second touch joins a pending first touch', () => {
    // Given: drawing is enabled and the first touch has moved below the draw threshold.
    const onChange = vi.fn<(nextValue: DrawingValue) => void>()
    render(
      <PageDrawingLayer
        enabled={true}
        pageId='page-1'
        controllerData={controllerData}
        onControllerDataChange={vi.fn()}
        value={{ strokes: [] }}
        onChange={onChange}
        cancelDrawingOnMultiTouch={true}
      />
    )
    const surface = screen.getByTestId('reader-painting-page-1')
    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 20,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })
    fireEvent.pointerMove(document, {
      button: -1,
      clientX: 24,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })

    // When: a second touch joins and both touches finish.
    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 80,
      clientY: 30,
      pointerId: 2,
      pointerType: 'touch'
    })
    fireEvent.pointerUp(document, {
      clientX: 80,
      clientY: 30,
      pointerId: 2,
      pointerType: 'touch'
    })
    fireEvent.pointerUp(document, {
      clientX: 24,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })

    // Then: the two-finger gesture leaves the persisted drawing untouched.
    expect(onChange).not.toHaveBeenCalled()
    expect(surface.querySelector('path')).toBeNull()
  })

  it('cancels an active touch stroke when drawing is disabled', () => {
    // Given: a touch stroke is active on a layer that remains mounted.
    const onChange = vi.fn<(nextValue: DrawingValue) => void>()
    const { rerender } = render(
      <PageDrawingLayer
        enabled={true}
        pageId='page-1'
        controllerData={controllerData}
        onControllerDataChange={vi.fn()}
        value={{ strokes: [] }}
        onChange={onChange}
        cancelDrawingOnMultiTouch={true}
      />
    )
    const surface = screen.getByTestId('reader-painting-page-1')
    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 20,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })
    fireEvent.pointerMove(document, {
      button: -1,
      clientX: 40,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })

    // When: drawing is disabled before the physical touch lifts.
    rerender(
      <PageDrawingLayer
        enabled={false}
        pageId='page-1'
        controllerData={controllerData}
        onControllerDataChange={vi.fn()}
        value={{ strokes: [] }}
        onChange={onChange}
        cancelDrawingOnMultiTouch={true}
      />
    )
    fireEvent.pointerUp(document, {
      clientX: 40,
      clientY: 30,
      pointerId: 1,
      pointerType: 'touch'
    })

    // Then: PaintingBoard's accepted pointer is aborted without persistence.
    expect(onChange).not.toHaveBeenCalled()
  })
})
