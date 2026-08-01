import { act, render } from '@testing-library/react'
import { createRef, useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PopoverPortal } from '../src/components/PopoverPortal'
import { mockElementSize } from './setup'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PopoverPortal', () => {
  it('mounts a relative portal when its container ref is assigned in the same commit', () => {
    // Given: the Reader container and PopoverPortal mount in one React commit.
    function SameCommitPopover() {
      const containerRef = useRef<HTMLDivElement>(null)

      return (
        <div ref={containerRef}>
          <PopoverPortal
            containerRef={containerRef}
            selectionKind='active'
            visible
            relative
          >
            <button type='button'>Highlight</button>
          </PopoverPortal>
        </div>
      )
    }

    // When: React assigns the container ref after the initial render.
    render(<SameCommitPopover />)

    // Then: the post-commit ref assignment still creates the relative portal.
    const portal = document.querySelector('.hamster-reader-popover-portal')
    expect(portal).toBeInTheDocument()
    expect(portal?.querySelector('button')).toHaveTextContent('Highlight')
  })

  it('mounts a relative portal when a parent passive effect assigns its container ref', () => {
    // Given: the real viewer pattern assigns the shared container ref in a parent effect.
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

    function PassiveEffectContainerPopover() {
      const targetRef = useRef<HTMLDivElement>(null)
      const containerRef = useRef<HTMLElement>(null)

      useEffect(() => {
        containerRef.current = targetRef.current
      }, [])

      return (
        <div ref={targetRef}>
          <PopoverPortal
            containerRef={containerRef}
            selectionKind='active'
            visible
            relative
          >
            <button type='button'>Highlight</button>
          </PopoverPortal>
        </div>
      )
    }

    render(<PassiveEffectContainerPopover />)

    // When: the position tracker observes the ref assigned after child effects ran.
    act(() => {
      animationFrames.get(1)?.(0)
    })

    // Then: the portal mounts into the effect-assigned container instead of staying absent.
    const portal = document.querySelector('.hamster-reader-popover-portal')
    expect(portal).toBeInTheDocument()
    expect(portal?.parentElement).toHaveTextContent('Highlight')
  })

  it('moves a relative portal when the mutable container ref target changes', () => {
    // Given: a relative portal is mounted into the current Reader container.
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

    const firstContainer = document.createElement('div')
    const secondContainer = document.createElement('div')
    document.body.append(firstContainer, secondContainer)
    const containerRef = createRef<HTMLElement>()
    containerRef.current = firstContainer
    render(
      <PopoverPortal
        containerRef={containerRef}
        selectionKind='active'
        visible
        relative
      >
        <button type='button'>Highlight</button>
      </PopoverPortal>
    )
    expect(
      firstContainer.querySelector('.hamster-reader-popover-portal')
    ).toBeInTheDocument()

    // When: virtualization replaces the element referenced by the mutable ref.
    containerRef.current = secondContainer
    act(() => {
      animationFrames.get(1)?.(0)
    })

    // Then: the portal follows the new coordinate container on the tracking frame.
    expect(
      firstContainer.querySelector('.hamster-reader-popover-portal')
    ).not.toBeInTheDocument()
    expect(
      secondContainer.querySelector('.hamster-reader-popover-portal')
    ).toBeInTheDocument()
  })

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

  it('portals relative popovers into the container used as the coordinate origin', () => {
    // Given: the selection component is mounted outside an offset Reader container.
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
    const selectionRect = document.createElement('div')
    selectionRect.className = 'hsn-selection-rect--active'
    container.appendChild(selectionRect)
    document.body.appendChild(container)
    mockElementSize(container, { left: 100, top: 50, width: 250, height: 300 })
    mockElementSize(selectionRect, {
      left: 250,
      top: 120,
      width: 100,
      height: 20
    })
    const containerRef = createRef<HTMLElement>()
    containerRef.current = container
    const { container: renderHost } = render(
      <div style={{ position: 'relative', left: 30, top: 40 }}>
        <PopoverPortal
          containerRef={containerRef}
          selectionKind='active'
          visible
          relative
        >
          <button type='button'>Highlight</button>
        </PopoverPortal>
      </div>
    )
    const portal = document.querySelector('.hamster-reader-popover-portal')
    if (!(portal instanceof HTMLElement)) {
      throw new Error('Expected the relative popover portal to render')
    }
    mockElementSize(portal, { width: 100, height: 40 })

    // When: the position tracker converts viewport coordinates to container coordinates.
    act(() => {
      animationFrames.get(1)?.(0)
    })

    // Then: the coordinate origin and the absolute-position containing block are identical.
    expect(portal.parentElement).toBe(container)
    expect(renderHost).not.toContainElement(portal)
    expect(portal).toHaveStyle({
      position: 'absolute',
      left: '142px',
      top: '22px',
      visibility: 'visible'
    })
  })
})
