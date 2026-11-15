import type { ReaderSelectionRange } from './selection'

/** Authority: WebBase openspec/changes/add-pane-highlight-drag-handoff/contracts/highlight-handoff.md */
export type ReaderHighlightDragCancelReason =
  | 'pointer-cancel'
  | 'window-exit'
  | 'invalid-drop'
  | 'blur'
  | 'source-replaced'
  | 'target-replaced'
  | 'handoff-timeout'
  | 'host-rejected'

type ClientPoint = Readonly<{ x: number; y: number }>
export type ReaderHighlightGesture =
  | {
      phase: 'start'
      pointerId: number
      pointerType: 'touch' | 'mouse'
      client: ClientPoint
      highlight: ReaderSelectionRange
    }
  | { phase: 'move' | 'end'; pointerId: number; client: ClientPoint }
  | {
      phase: 'cancel'
      pointerId: number
      reason: ReaderHighlightDragCancelReason
    }

/** 500ms recognizes intent; a further 250ms bounds bridge/host takeover latency. */
export const HIGHLIGHT_HANDOFF_TIMEOUT_MS = 250

export interface ReaderHighlightDragHandoff {
  readonly contract: 'pane-highlight-drag-v1'
  /** Retain the start acknowledgement to report ended when the host releases ownership.
   * Each acknowledgement is bound to this gesture; late replies are ignored.
   * Rejection/timeout must produce visible feedback in the host.
   */
  readonly onGesture: (
    gesture: ReaderHighlightGesture,
    acknowledge: (status: 'accepted' | 'rejected' | 'ended') => void
  ) => void
}
