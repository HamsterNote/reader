export {
  getSelectionOverlayRects,
  IntermediateDocumentViewer,
  isNonSpaceBlankText,
  mergeSelectionRects,
  type BackgroundQuality,
  type IntermediateDocumentViewerProps,
  type ReaderInteractionMode,
  type ReaderPageRange,
  type ReaderSavedSelection,
  type ReaderSavedSelectionAnchor,
  type ReaderSavedSelectionComment,
  type ReaderSavedSelectionEditDetail,
  type ReaderSavedSelectionRestoreResult,
  type ReaderSavedSelectionRestoreStatus,
  type ReaderSavedSelectionSegment,
  type ReaderSavedSelectionVisualPage,
  type ReaderSelectedTextDragCallback,
  type ReaderSelectionHandlePosition,
  type ReaderSelectionHandleRenderProps,
  type ReaderSelectionOverlayOptions,
  type ReaderSelectionOverlayRect,
  type ReaderRenderMode,
  type ReaderTextSelectionDetail
} from './IntermediateDocumentViewer'
export {
  getNearestTextElementForPoint,
  getPageElementByPageNumber,
  getPageElementForPoint,
  resolveCaret
} from '../selection/caretResolver'
export {
  composeSelection,
  createOrderedRange
} from '../selection/selectionComposer'
export {
  buildSelectionPayload,
  getClosestTextElement,
  textElementRecords,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload
} from '../selection/selectionPayloadSerializer'
export {
  buildSavedSelection,
  denormalizePageRects,
  normalizePageRects,
  resolveSavedSelection,
  textHash,
  type NormalizedRect,
  type TextElementInfo
} from '../selection/savedSelection'
