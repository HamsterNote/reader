export const createOrderedRange = (
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): Range => {
  const ownerDocument = startNode.ownerDocument ?? globalThis.document
  const collapsedRange = ownerDocument.createRange()
  collapsedRange.setStart(startNode, startOffset)
  collapsedRange.collapse(true)

  if (endNode.ownerDocument !== ownerDocument) {
    return collapsedRange
  }

  const orderRange = ownerDocument.createRange()
  orderRange.setStart(startNode, startOffset)
  orderRange.collapse(true)

  let endIsBeforeStart = false
  try {
    endIsBeforeStart = orderRange.comparePoint(endNode, endOffset) < 0
  } catch {
    orderRange.detach()
    return collapsedRange
  }
  orderRange.detach()
  collapsedRange.detach()

  const range = ownerDocument.createRange()
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
  const ownerWindow = range.startContainer.ownerDocument?.defaultView
  const selection = ownerWindow?.getSelection()
  if (!selection) return

  selection.removeAllRanges()
  selection.addRange(range)
}
