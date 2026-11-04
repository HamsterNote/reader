/** Screen-pixel velocity, independent of PDF scale and display refresh rate. */
export function pdfHandleScrollVelocity(
  y: number,
  top: number,
  bottom: number
): number {
  const band = Math.min(72, Math.max(0, (bottom - top) / 3))
  if (!band) return 0
  const speed = (distance: number) =>
    600 * Math.min(1, Math.max(0, 1 - distance / band)) ** 2
  if (y < top + band) return -speed(y - top)
  if (y > bottom - band) return speed(bottom - y)
  return 0
}

/** The anchor stays fixed even when the moving endpoint crosses it twice. */
export function pdfHandleRange(
  original: Range,
  originalEnd: boolean,
  caret: Range
) {
  const anchor = original.cloneRange()
  anchor.collapse(originalEnd)
  const end = caret.compareBoundaryPoints(Range.START_TO_START, anchor) >= 0
  const range = original.cloneRange()
  if (end) {
    range.setStart(anchor.startContainer, anchor.startOffset)
    range.setEnd(caret.startContainer, caret.startOffset)
  } else {
    range.setStart(caret.startContainer, caret.startOffset)
    range.setEnd(anchor.startContainer, anchor.startOffset)
  }
  return { range, end }
}
