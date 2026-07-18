const validatedPointerMoves = new WeakSet<PointerEvent>()

export const markSelectionPointerMoveAsTextHit = (
  event: PointerEvent
): void => {
  validatedPointerMoves.add(event)
}

export const isSelectionPointerMoveTextHit = (event: PointerEvent): boolean =>
  validatedPointerMoves.has(event)
