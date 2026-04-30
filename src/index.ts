export {
  IntermediateDocumentViewer,
  type IntermediateDocumentViewerProps,
  type ReaderTextSelectionDetail
} from './components/IntermediateDocumentViewer'
export { Reader, type ReaderProps } from './components/Reader'

export type ReaderInteractiveProps = Pick<
  import('./components/Reader').ReaderProps,
  'ocr' | 'onTextSelectionChange' | 'onTextSelectionEnd'
>
