export {
  type BackgroundQuality,
  buildSavedSelection,
  buildSelectionPayload,
  denormalizePageRects,
  IntermediateDocumentViewer,
  getSelectionOverlayRects,
  type IntermediateDocumentViewerProps,
  normalizePageRects,
  resolveSavedSelection,
  type ReaderPageRange,
  type ReaderRenderMode,
  type ReaderSavedSelection,
  type ReaderSavedSelectionAnchor,
  type ReaderSavedSelectionEditDetail,
  type ReaderSavedSelectionRestoreResult,
  type ReaderSavedSelectionRestoreStatus,
  type ReaderSavedSelectionSegment,
  type ReaderSavedSelectionVisualPage,
  type ReaderSelectedTextDragCallback,
  type ReaderSelectedTextSegment,
  type ReaderSelectionHandleRenderProps,
  type ReaderSelectionOverlayOptions,
  type ReaderSelectionOverlayRect,
  type ReaderSelectionPayload,
  type ReaderTextSelectionDetail,
  textHash,
  type NormalizedRect,
  type TextElementInfo
} from './components/IntermediateDocumentViewer'
export { Reader, type ReaderProps } from './components/Reader'

export type { ReaderSelectionOverlayPolygon } from './components/selectionGeometry'

export type ReaderInteractiveProps = Pick<
  import('./components/Reader').ReaderProps,
  | 'ocr'
  | 'onSelectText'
  | 'onTextSelectionChange'
  | 'onTextSelectionEnd'
  | 'onDragSelectedTextStart'
  | 'onDragSelectedTextMove'
  | 'onDragSelectedTextEnd'
>
