export {
  type BackgroundQuality,
  buildSavedSelection,
  buildSelectionPayload,
  denormalizePageRects,
  IntermediateDocumentViewer,
  type IntermediateDocumentViewerProps,
  normalizePageRects,
  resolveSavedSelection,
  type ReaderInteractionMode,
  type ReaderPageRange,
  type ReaderRenderMode,
  type ReaderSavedSelection,
  type ReaderSavedSelectionAnchor,
  type ReaderSavedSelectionComment,
  type ReaderSavedSelectionEditDetail,
  type ReaderSavedSelectionRestoreResult,
  type ReaderSavedSelectionRestoreStatus,
  type ReaderSavedSelectionSegment,
  type ReaderSavedSelectionVisualPage,
  type ReaderSelectedTextSegment,
  type ReaderSelectionOverlayRect,
  type ReaderSelectionPayload,
  type ReaderTextSelectionDetail,
  textHash,
  type NormalizedRect,
  type TextElementInfo
} from './components/IntermediateDocumentViewer'
export { Reader, type ReaderProps } from './components/Reader'

export type ReaderInteractiveProps = Pick<
  import('./components/Reader').ReaderProps,
  | 'ocr'
  | 'onSelectText'
  | 'onTextSelectionChange'
  | 'onTextSelectionEnd'
  | 'interactionMode'
>
