export {
  getNearestTextElementForPoint,
  getPageElementByPageNumber,
  getPageElementForPoint,
  resolveCaret
} from '../selection/caretResolver'
export {
  buildSavedSelection,
  denormalizePageRects,
  type NormalizedRect,
  normalizePageRects,
  resolveSavedSelection,
  type TextElementInfo,
  textHash
} from '../selection/savedSelection'
export {
  composeSelection,
  createOrderedRange
} from '../selection/selectionComposer'
export {
  buildSelectionPayload,
  getClosestTextElement,
  type ReaderSelectedTextSegment,
  type ReaderSelectionPayload,
  textElementRecords
} from '../selection/selectionPayloadSerializer'
export {
  IntermediateDocumentTextPageContent,
  type IntermediateDocumentTextPageContentProps
} from './IntermediateDocumentTextPageContent'
export {
  IntermediateDocumentTextViewer,
  type IntermediateDocumentTextViewerProps
} from './IntermediateDocumentTextViewer'
export {
  IntermediateDocumentViewer,
  type IntermediateDocumentViewerProps,
  isNonSpaceBlankText,
  mergeSelectionRects,
  type ReaderExtraOcr,
  type ReaderInteractionMode,
  type ReaderOcrOptions,
  type ReaderPageRange,
  type ReaderReadingPositionHandle,
  type ReaderSavedSelection,
  type ReaderSavedSelectionAnchor,
  type ReaderSavedSelectionComment,
  type ReaderSavedSelectionEditDetail,
  type ReaderSavedSelectionRestoreResult,
  type ReaderSavedSelectionRestoreStatus,
  type ReaderSavedSelectionSegment,
  type ReaderSavedSelectionVisualPage,
  type ReaderSelectionOverlayRect,
  type ReaderTextSelectionDetail,
  type ReaderTouchPanMode
} from './IntermediateDocumentViewer'
export type {
  ReaderIntermediateImage,
  ReaderIntermediateImageSerialized
} from './intermediateImage'
export {
  type PaginateTxtDocumentOptions,
  paginateTxtDocument,
  TXT_DOCUMENT_LINES_PER_PAGE
} from './paginateTxtDocument'
export {
  type CreateIntermediateDocumentRenderTimingOptions,
  createIntermediateDocumentRenderTiming,
  type IntermediateDocumentRenderTiming,
  type IntermediateDocumentRenderTimingCallback,
  type IntermediateDocumentRenderTimingClock,
  type IntermediateDocumentRenderTimingEntry,
  type IntermediateDocumentRenderTimingStage
} from './renderTiming'
export { getRuntimeDocument, type ReaderDocumentInput } from './runtimeDocument'
export {
  type CreateTextModeDocumentOptions,
  createTextModeDocument,
  type TextModeDocument,
  type TextModeHighlightInput,
  type TextModeHighlightUpdate,
  type TextModePage,
  type TextModePageRange
} from './textModeDocument'
