export type PopoverSelectionKind = 'active' | 'selected'

export type PopoverPosition = {
  readonly left: number
  readonly top: number
  readonly maxWidth: number
  readonly maxHeight: number
}

const SELECTION_RECT_SELECTORS: Record<PopoverSelectionKind, string> = {
  active: '.hsn-selection-rect--active, .hsn-selection-percent-rect-active',
  selected:
    '.hsn-selection-rect--selected, .hsn-selection-percent-rect-selected'
}

const clampToContainer = (value: number, minimum: number, maximum: number) =>
  maximum >= minimum
    ? Math.max(minimum, Math.min(maximum, value))
    : (minimum + maximum) / 2

export function getSelectionBounds(
  container: HTMLElement,
  kind: PopoverSelectionKind
): DOMRectReadOnly | null {
  const elements = container.querySelectorAll<Element>(
    SELECTION_RECT_SELECTORS[kind]
  )
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.right) ||
      !Number.isFinite(rect.bottom)
    ) {
      continue
    }

    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }

  return Number.isFinite(left)
    ? new DOMRectReadOnly(left, top, right - left, bottom - top)
    : null
}

export function calculatePopoverPosition(
  container: DOMRectReadOnly,
  selection: DOMRectReadOnly,
  popover: DOMRectReadOnly,
  gap: number,
  relative = false,
  topInset = 0
): PopoverPosition {
  const containerLeft = relative ? container.left : 0
  const containerTop = relative ? container.top : 0
  // The host may paint chrome (a header bar) over the container's top edge.
  // Treat that band as unavailable so an above-the-selection popover flips down.
  const effectiveTop = container.top + topInset
  const maxWidth = Math.max(0, container.width - gap * 2)
  const maxHeight = Math.max(0, container.height - gap * 2)
  const popoverWidth = Math.min(popover.width, maxWidth)
  const popoverHeight = Math.min(popover.height, maxHeight)
  const minimumLeft = container.left + gap - containerLeft
  const maximumLeft = container.right - gap - popoverWidth - containerLeft
  const minimumTop = effectiveTop + gap - containerTop
  const maximumTop = container.bottom - gap - popoverHeight - containerTop
  const boundedMinimumTop = container.top + gap - containerTop
  const selectionCenterLeft =
    selection.left + (selection.width - popoverWidth) / 2 - containerLeft
  const topIsVisible =
    selection.top >= effectiveTop && selection.top <= container.bottom
  const bottomIsVisible =
    selection.bottom >= container.top && selection.bottom <= container.bottom
  const fitsAbove = selection.top - gap - popoverHeight >= effectiveTop

  let preferredLeft = selectionCenterLeft
  let preferredTop = selection.top - gap - popoverHeight - containerTop
  if (!topIsVisible && bottomIsVisible) {
    preferredTop = selection.bottom + gap - containerTop
  } else if (!topIsVisible) {
    preferredLeft =
      container.left + (container.width - popoverWidth) / 2 - containerLeft
    preferredTop =
      container.top + (container.height - popoverHeight) / 2 - containerTop
  } else if (topInset > 0 && !fitsAbove && bottomIsVisible) {
    // The host bar leaves no room above a selection just under it. Flip below
    // instead of clamping the popover onto the selection line.
    preferredTop = selection.bottom + gap - containerTop
  }

  return {
    left: clampToContainer(preferredLeft, minimumLeft, maximumLeft),
    // An inset taller than the container leaves no safe band; fall back to the
    // container's own bounds instead of collapsing to an out-of-bounds midpoint.
    top:
      maximumTop >= minimumTop
        ? clampToContainer(preferredTop, minimumTop, maximumTop)
        : clampToContainer(preferredTop, boundedMinimumTop, maximumTop),
    maxWidth,
    maxHeight
  }
}
