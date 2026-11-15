// Compiled with yarn typecheck and build:lib public declarations.
import type {
  ReaderProps,
  ReaderHighlightDragHandoff,
  ReaderSelectionRange,
  ReaderHighlightGesture
} from '../src'
const legacy: Pick<ReaderProps, 'onDragHighlight'> = {
  onDragHighlight: (_range: ReaderSelectionRange) => {}
}
const negotiated: ReaderHighlightDragHandoff = {
  contract: 'pane-highlight-drag-v1',
  onGesture(event: ReaderHighlightGesture, acknowledge) {
    if (event.phase === 'start') {
      const original: ReaderSelectionRange = event.highlight
      legacy.onDragHighlight?.(original)
      acknowledge('accepted')
      acknowledge('ended')
    }
  }
}
export const publicProps: ReaderProps = {
  ...legacy,
  highlightDragHandoff: negotiated
}
