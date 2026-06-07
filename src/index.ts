export {
  type BackgroundQuality,
  IntermediateDocumentViewer,
  type IntermediateDocumentViewerProps,
  type ReaderPageRange,
  type ReaderRenderMode,
  type ReaderSelectionHandleRenderProps,
  type ReaderSelectionOverlayOptions,
  type ReaderTextSelectionDetail
} from './components/IntermediateDocumentViewer'
export { Reader, type ReaderProps } from './components/Reader'

export type { ReaderSelectionOverlayPolygon } from './components/selectionGeometry'

export type ReaderInteractiveProps = Pick<
  import('./components/Reader').ReaderProps,
  'ocr' | 'onTextSelectionChange' | 'onTextSelectionEnd'
>
