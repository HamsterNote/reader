/** Resolve the text beneath reader controls, including menus over lower lines.
 * Only the synchronous caret query ignores them; menus remain interactive. */
export function textCaretAtPoint(
  doc: Document,
  x: number,
  y: number
): Range | null {
  const controls = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '.hamster-reader__engine-handle, .hsn-selection-handle, .hsn-selection-overlay, .hsn-selection-overlay *, .hsn-selection-percent-overlay, .hsn-selection-percent-overlay *, .hsn-selection-popover, .hsn-selection-popover *, .hamster-reader__engine-popover, .hamster-reader__engine-popover *'
    )
  )
  const previous = controls.map(({ style }) => ({
    value: style.getPropertyValue('pointer-events'),
    priority: style.getPropertyPriority('pointer-events')
  }))
  controls.forEach(({ style }) => {
    // Descendants can explicitly opt back in, including with !important.
    style.setProperty('pointer-events', 'none', 'important')
  })
  try {
    const caretDoc = doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const position = caretDoc.caretPositionFromPoint?.(x, y)
    if (position?.offsetNode.nodeType === Node.TEXT_NODE) {
      const range = doc.createRange()
      range.setStart(position.offsetNode, position.offset)
      range.collapse(true)
      return range
    }
    return caretDoc.caretRangeFromPoint?.(x, y) ?? null
  } finally {
    controls.forEach(({ style }, index) => {
      const { value, priority } = previous[index]
      if (value) style.setProperty('pointer-events', value, priority)
      else style.removeProperty('pointer-events')
    })
  }
}
