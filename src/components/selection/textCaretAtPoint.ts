/** Resolve the actual point through our visible handles. Making them inert
 * only for hit testing preserves their DOM, appearance and pointer capture. */
export function textCaretAtPoint(doc: Document, x: number, y: number): Range | null {
  const handles = Array.from(doc.querySelectorAll<HTMLElement>('.hamster-reader__engine-handle, .hsn-selection-handle, .hsn-selection-overlay, .hsn-selection-overlay *, .hsn-selection-percent-overlay, .hsn-selection-percent-overlay *'))
  const previous = handles.map(handle => handle.style.pointerEvents)
  handles.forEach(handle => { handle.style.pointerEvents = 'none' })
  try {
    const caretDoc = doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
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
    handles.forEach((handle, index) => { handle.style.pointerEvents = previous[index] })
  }
}
