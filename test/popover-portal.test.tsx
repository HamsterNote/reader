import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PopoverPortal } from '../src/components/PopoverPortal'
import { mockElementSize } from './setup'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PopoverPortal', () => {
  it('renders at the clamped bounds of all active selection rectangles', () => {
    // Given: a visible Reader container with an active multi-rect selection.
    const animationFrames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      animationFrames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      animationFrames.delete(frameId)
    })

    const container = document.createElement('div')
    const firstRect = document.createElement('div')
    const secondRect = document.createElement('div')
    firstRect.className = 'hsn-selection-rect--active'
    secondRect.className = 'hsn-selection-rect--active'
    container.append(firstRect, secondRect)
    document.body.appendChild(container)
    mockElementSize(container, { left: 100, top: 50, width: 250, height: 300 })
    mockElementSize(firstRect, { left: 250, top: 120, width: 40, height: 20 })
    mockElementSize(secondRect, { left: 280, top: 150, width: 70, height: 20 })
    const containerRef = createRef<HTMLElement>()
    containerRef.current = container
    render(
      <PopoverPortal containerRef={containerRef} selectionKind='active' visible>
        <button type='button'>Highlight</button>
      </PopoverPortal>
    )
    const portal = document.querySelector('.hamster-reader-popover-portal')
    if (!(portal instanceof HTMLElement)) {
      throw new Error('Expected the popover portal to render in document.body')
    }
    mockElementSize(portal, { width: 100, height: 40 })

    // When: the portal's animation-frame position tracker runs.
    act(() => {
      animationFrames.get(1)?.(0)
    })

    // Then: the body portal uses fixed, unscaled coordinates inside the container.
    expect(portal).toHaveStyle({
      position: 'fixed',
      left: '242px',
      top: '72px',
      maxWidth: '234px',
      maxHeight: '284px',
      visibility: 'visible',
      transform: 'none'
    })
  })
})
