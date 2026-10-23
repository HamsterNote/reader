import { useEffect } from 'react'
import { useHighlightDrag } from './IntermediateDocumentViewer/useHighlightDrag'
import type { ReaderSelectionRange } from '../types/selection'

/** Bind the established drag gesture to either PDF text layers or an EPUB document. */
export function EngineHighlightInteractions({
  element,
  resolveHighlight,
  onDragHighlight
}: {
  readonly element: HTMLElement | null
  readonly resolveHighlight: (
    x: number,
    y: number
  ) => ReaderSelectionRange | null
  readonly onDragHighlight: ((range: ReaderSelectionRange) => void) | undefined
}) {
  const drag = useHighlightDrag({
    viewerRootElement: element,
    resolveHighlight,
    onDragHighlight
  })
  useEffect(() => {
    if (!element) return
    const down = (event: PointerEvent) => drag.handleHighlightPointerDown(event)
    const move = (event: PointerEvent) => drag.handleHighlightPointerMove(event)
    const up = (event: PointerEvent) => drag.handleHighlightPointerUp(event)
    const cancel = (event: PointerEvent) =>
      drag.handleHighlightPointerCancel(event)
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', cancel)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', cancel)
    }
  }, [
    element,
    drag.handleHighlightPointerDown,
    drag.handleHighlightPointerMove,
    drag.handleHighlightPointerUp,
    drag.handleHighlightPointerCancel
  ])
  useEffect(() => {
    if (!element || !drag.suppressNativeSelection) return
    const previous = element.style.userSelect
    element.style.userSelect = 'none'
    return () => {
      element.style.userSelect = previous
    }
  }, [element, drag.suppressNativeSelection])
  return null
}
