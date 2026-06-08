export const createOrderedRange = (
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): Range => {
  const orderRange = globalThis.document.createRange()
  orderRange.setStart(startNode, startOffset)
  orderRange.collapse(true)

  const endIsBeforeStart = orderRange.comparePoint(endNode, endOffset) < 0
  orderRange.detach()

  const range = globalThis.document.createRange()
  if (endIsBeforeStart) {
    range.setStart(endNode, endOffset)
    range.setEnd(startNode, startOffset)
  } else {
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
  }

  return range
}

export const composeSelection = (range: Range): void => {
  const selection = window.getSelection()
  if (!selection) return

  selection.removeAllRanges()
  selection.addRange(range)
}
