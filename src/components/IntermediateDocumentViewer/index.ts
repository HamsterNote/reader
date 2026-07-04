export {
  IntermediateDocumentViewer,
  isNonSpaceBlankText,
  mergeSelectionRects,
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
  type ReaderSelectionOverlayRect,
  type ReaderTextSelectionDetail
} from './IntermediateDocumentViewer'
export {
  IntermediateDocumentTextViewer,
  type IntermediateDocumentTextViewerProps
} from './IntermediateDocumentTextViewer'
export {
  IntermediateDocumentTextPageContent,
  type IntermediateDocumentTextPageContentProps
} from './IntermediateDocumentTextPageContent'
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
export {
  createIntermediateDocumentRenderTiming,
  type CreateIntermediateDocumentRenderTimingOptions,
  type IntermediateDocumentRenderTiming,
  type IntermediateDocumentRenderTimingCallback,
  type IntermediateDocumentRenderTimingClock,
  type IntermediateDocumentRenderTimingEntry,
  type IntermediateDocumentRenderTimingStage
} from './renderTiming'
