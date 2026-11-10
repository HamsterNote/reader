// CSS reference pixels; deliberately independent of devicePixelRatio.
export const TEXT_LENS_SIZE_PX = 60
export const TEXT_LENS_DISTANCE_PX = 38
export const TEXT_LENS_EDGE_PX = 8
export const TEXT_LENS_MAGNIFICATION = 2
export const TEXT_LENS_MARKER_WIDTH_PX = 2
export const TEXT_LENS_BORDER_PX = 3
export const TEXT_HANDLE_SIZE_PX = 20

export const usesTouchMagnifier = (pointerType: string): boolean =>
  pointerType === 'touch'

export interface TextMagnifierFocus {
  readonly range: Range
  readonly end: boolean
  readonly color: string
  readonly valid?: boolean
}

/** A source character boundary, never the pointer or the centre of a handle. */
export function insertionRect(focus: TextMagnifierFocus): DOMRect | null {
  if (focus.valid === false) return null
  const { range, end } = focus
  const node = end ? range.endContainer : range.startContainer
  const offset = end ? range.endOffset : range.startOffset
  if (!node.isConnected || node.nodeType !== Node.TEXT_NODE) return null
  const caret = range.cloneRange()
  caret.collapse(!end)
  let rect = Array.from(caret.getClientRects()).find((box) => box.height > 0)
  let x = rect?.left
  if (!rect) {
    // WebKit sometimes reports no collapsed rect. Measure one adjacent glyph.
    const length = node.textContent?.length ?? 0
    if (!length) return null
    const before = offset === length || (end && offset > 0)
    caret.setStart(node, before ? offset - 1 : offset)
    caret.setEnd(node, before ? offset : offset + 1)
    rect = Array.from(caret.getClientRects()).find((box) => box.height > 0)
    const rtl =
      node.parentElement?.ownerDocument.defaultView?.getComputedStyle(
        node.parentElement
      ).direction === 'rtl'
    x = before !== rtl ? rect?.right : rect?.left
  }
  if (!rect || x === undefined) return null
  const frame =
    node.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect()
  return new DOMRect(
    x + (frame?.left ?? 0),
    rect.top + (frame?.top ?? 0),
    0,
    rect.height
  )
}

export function projectInsertionMarker(
  focus: TextMagnifierFocus,
  point: { clientX: number; clientY: number }
): { left: number; top: number; height: number } | null {
  const rect = insertionRect(focus)
  if (!rect) return null
  const left =
    TEXT_LENS_SIZE_PX / 2 +
    (rect.left - point.clientX) * TEXT_LENS_MAGNIFICATION
  const top =
    TEXT_LENS_SIZE_PX / 2 + (rect.top - point.clientY) * TEXT_LENS_MAGNIFICATION
  const height = rect.height * TEXT_LENS_MAGNIFICATION
  if (
    left < 0 ||
    left > TEXT_LENS_SIZE_PX ||
    top >= TEXT_LENS_SIZE_PX ||
    top + height <= 0
  )
    return null
  return { left, top, height }
}
