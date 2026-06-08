export {
  type BackgroundQuality,
  buildSelectionPayload,
  IntermediateDocumentViewer,
  type IntermediateDocumentViewerProps,
  type ReaderPageRange,
  type ReaderRenderMode,
  type ReaderSelectedTextDragCallback,
  type ReaderSelectedTextSegment,
  type ReaderSelectionHandleRenderProps,
  type ReaderSelectionOverlayOptions,
  type ReaderSelectionPayload,
  type ReaderTextSelectionDetail
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
