type Box = Pick<
  DOMRect,
  'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'
>
type Insets = {
  topInset?: number
  bottomInset?: number
  horizontalInset?: number
}

/** Insets describe overlap inside this root. A host that already reserves its
 * safe area reports zero remaining overlap. Overlapping controls merge by max. */
export function readingViewport(
  box: Box,
  { topInset = 0, bottomInset = 0, horizontalInset = 0 }: Insets,
  controls?: Box
) {
  if (box.width <= 0 || box.height <= 0) return null
  const bottom =
    Math.max(bottomInset, controls?.height ? box.bottom - controls.top : 0) + 8
  const width = box.width - horizontalInset * 2
  const height = box.height - topInset - bottom
  return width > 0 && height > 0
    ? {
        left: box.left + horizontalInset,
        right: box.right - horizontalInset,
        top: box.top + topInset,
        bottom: box.bottom - bottom,
        bottomInset: bottom,
        width,
        height
      }
    : null
}
