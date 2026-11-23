import { describe, expect, it } from 'vitest'

import {
  calculatePopoverPosition,
  getSelectionBounds
} from '../src/components/popoverPosition'
import { mockElementSize } from './setup'

const rect = (left: number, top: number, width: number, height: number) =>
  new DOMRectReadOnly(left, top, width, height)

describe('popover position', () => {
  it('uses the full selection bounds and clamps the preferred top position', () => {
    // Given: a multi-rect selection near the container's right edge.
    const containerElement = document.createElement('div')
    const firstRect = document.createElement('div')
    const secondRect = document.createElement('div')
    firstRect.className = 'hsn-selection-percent-rect-active'
    secondRect.className = 'hsn-selection-percent-rect-active'
    containerElement.append(firstRect, secondRect)
    mockElementSize(firstRect, { left: 250, top: 120, width: 40, height: 20 })
    mockElementSize(secondRect, { left: 280, top: 150, width: 70, height: 20 })

    // When: the active selection bounds and popover position are calculated.
    const selection = getSelectionBounds(containerElement, 'active')
    if (!selection) throw new Error('Expected active selection bounds')
    const position = calculatePopoverPosition(
      rect(100, 50, 250, 300),
      selection,
      rect(0, 0, 100, 40),
      8
    )

    // Then: all selection rects form the anchor and the popover remains inside.
    expect(selection).toMatchObject({
      left: 250,
      right: 350,
      top: 120,
      bottom: 170
    })
    expect(position).toMatchObject({ left: 242, top: 72 })
  })

  it('places the popover below when only the selection bottom is visible', () => {
    // Given: the selection starts above the visible container and ends inside it.
    const container = rect(100, 100, 300, 300)
    const selection = rect(170, 60, 80, 80)

    // When: the position is calculated.
    const position = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 40),
      8
    )

    // Then: the popover starts one gap below the selection bounds.
    expect(position).toMatchObject({ left: 160, top: 148 })
  })

  it('centers the popover when neither selection edge is visible', () => {
    // Given: a selection spanning beyond both vertical container edges.
    const container = rect(100, 100, 300, 300)
    const selection = rect(170, 50, 80, 400)

    // When: the position is calculated.
    const position = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 40),
      8
    )

    // Then: the popover is centered in the visible container.
    expect(position).toMatchObject({ left: 200, top: 230 })
  })

  it('moves a top-aligned popover inward from every container edge', () => {
    // Given: the preferred top placement would overflow the top-left corner.
    const container = rect(100, 100, 300, 300)
    const selection = rect(90, 110, 20, 20)

    // When: the position is calculated.
    const position = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 40),
      8
    )

    // Then: both axes retain the required gap from the container.
    expect(position).toMatchObject({ left: 108, top: 108 })
  })

  it('positions an oversized popover using its constrained visible size', () => {
    // Given: the popover's natural width is larger than the container's safe area.
    const container = rect(100, 100, 120, 200)
    const selection = rect(150, 200, 20, 20)

    // When: the first visible position is calculated from the natural measurement.
    const position = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 200, 40),
      8
    )

    // Then: the CSS-constrained width is used, preserving both horizontal gaps.
    expect(position).toMatchObject({ left: 108, top: 152, maxWidth: 104 })
  })

  it('flips below a selection whose top sits inside the top inset', () => {
    // Given: host chrome covers the top 65px and the first line starts at 60.
    const container = rect(0, 0, 800, 600)
    const selection = rect(100, 60, 80, 20)

    const clamped = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 38),
      8,
      false,
      0
    )
    const flipped = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 38),
      8,
      false,
      65
    )

    // Then: without an inset the popover stays above; with one it clears it,
    // landing one gap below the selection instead of under the host chrome.
    expect(clamped).toMatchObject({ left: 90, top: 14 })
    expect(flipped).toMatchObject({ left: 90, top: 88 })
  })

  it('keeps the placement unchanged when the selection is below the inset', () => {
    // Given: a selection well inside the container and away from the host chrome.
    const container = rect(0, 0, 800, 600)
    const selection = rect(100, 200, 80, 20)

    const withoutInset = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 38),
      8
    )
    const withInset = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 38),
      8,
      false,
      65
    )

    // Then: both placements are identical.
    expect(withInset).toEqual(withoutInset)
    expect(withInset).toMatchObject({ left: 90, top: 154 })
  })

  it('falls back to the collapsed midpoint when the inset exceeds the container', () => {
    // Given: a 65px inset inside a container only 40px tall.
    const container = rect(0, 0, 300, 40)
    const selection = rect(100, 10, 20, 20)

    const position = calculatePopoverPosition(
      container,
      selection,
      rect(0, 0, 100, 38),
      8,
      false,
      65
    )

    // Then: the safe top exceeds the safe bottom, so both axes keep the
    // existing degenerate midpoint fallback instead of overflowing.
    expect(position).toMatchObject({
      left: 60,
      top: 40.5,
      maxWidth: 284,
      maxHeight: 24
    })
  })
})
