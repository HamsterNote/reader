// HAM-89 / 主线 B：PDF 切换到 pdfjs-dist 官方 viewer 的适配链路公开出口。
// 注意：本目录不从 src/index.ts 再导出（公开导出接线属集成任务 HAM-91）。

export { PdfDocumentViewer } from './PdfDocumentViewer'
export type {
  PdfDocumentViewerProps,
  PdfDocumentViewerRef,
  PdfViewerError,
  PdfViewerStatus,
  PdfViewerTool
} from './PdfDocumentViewer'

export {
  PdfDocumentOpenError,
  PdfDocumentSession,
  PdfSessionManager,
  classifyPdfOpenError
} from './pdfDocumentSession'
export type {
  OpenPdfDocumentOptions,
  PdfDocumentSource,
  PdfOpenError,
  PdfOpenErrorKind
} from './pdfDocumentSession'

export {
  assertPdfJsVersion,
  configurePdfJsWorker,
  PDFJS_DIST_VERSION,
  pdfjsApiVersion
} from './pdfjsRuntime'

export {
  buildCanonicalPageText,
  canonicalOffsetToDomPosition,
  canonicalRangeToDomRange,
  canonicalTextId,
  domPositionToCanonicalOffset,
  enhanceTextLayer,
  TEXT_LAYER_PAGE_NUMBER_ATTR,
  TEXT_LAYER_START_OFFSET_ATTR,
  TEXT_LAYER_TEXT_ID_ATTR
} from './pdfTextMapping'
export type { CanonicalPageText, CanonicalTextSpan } from './pdfTextMapping'

export {
  captureViewportRectAsStored,
  edgeCropToClipPath,
  projectStoredRectToViewport
} from './pdfOverlayGeometry'
export type {
  OverlayRectUnit,
  PageVisualSize,
  StoredOverlayRect,
  ViewportOverlayRect
} from './pdfOverlayGeometry'

export {
  deriveRectsForCanonicalRange,
  serializePdfTextSelection
} from './pdfSelectionSerializer'
export type {
  PdfPageSelectionContext,
  SerializedPdfSelection
} from './pdfSelectionSerializer'

export { createPdfTextModeDocument } from './pdfTextModeDocument'
export type { PdfTextModeDocument } from './pdfTextModeDocument'
