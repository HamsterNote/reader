// Selection 库类型别名直接从 @hamster-note/selection re-export，
// 绕过 IntermediateDocumentViewer 中的 type alias 转发
// （TS 5.9 在 bundler + isolatedModules 下 export type X = ExternalType 存在已知问题）
export type {
  MousePosition as ReaderMousePosition,
  OverlayRectType as ReaderSelectionOverlayRectType,
  SelectionRect as ReaderSelectionRectangle,
  SelectionTool as ReaderSelectionTool
} from '@hamster-note/selection'
export {
  buildReaderCommentTree,
  getCommentCountByHighlightId,
  getCommentsByHighlightId
} from './comments'
export {
  DefaultHighlightPopover,
  DefaultRectanglePopover,
  DefaultSelectionPopover,
  type DefaultPopoverContext,
  type DefaultRectanglePopoverProps
} from './components/DefaultPopover'
export type {
  CreateIntermediateDocumentRenderTimingOptions,
  IntermediateDocumentRenderTiming,
  IntermediateDocumentRenderTimingCallback,
  IntermediateDocumentRenderTimingClock,
  IntermediateDocumentRenderTimingEntry,
  IntermediateDocumentRenderTimingStage,
  IntermediateDocumentViewerProps,
  NormalizedRect,
  ReaderInteractionMode,
  ReaderPageRange,
  ReaderSavedSelection,
  ReaderSavedSelectionAnchor,
  ReaderSavedSelectionComment,
  ReaderSavedSelectionEditDetail,
  ReaderSavedSelectionRestoreResult,
  ReaderSavedSelectionRestoreStatus,
  ReaderSavedSelectionSegment,
  ReaderSavedSelectionVisualPage,
  ReaderSelectedTextSegment,
  ReaderSelectionOverlayRect,
  ReaderSelectionPayload,
  ReaderTextSelectionDetail,
  ReaderTouchPanMode,
  TextElementInfo
} from './components/IntermediateDocumentViewer'
export {
  buildSavedSelection,
  buildSelectionPayload,
  createIntermediateDocumentRenderTiming,
  denormalizePageRects,
  IntermediateDocumentViewer,
  normalizePageRects,
  resolveSavedSelection,
  textHash
} from './components/IntermediateDocumentViewer'
export {
  Page,
  type PageProps,
  type ReaderPagePaintingMap,
  type ReaderPageRectSelectionMap,
  type ReaderPageTextSelectionMap,
  type ReaderPageTool
} from './components/Page'
export {
  Reader,
  type ReaderProps,
  type ReaderRenderMode
} from './components/Reader'
export type {
  ReaderComment,
  ReaderCommentChangeDetail,
  ReaderCommentChangeSource,
  ReaderCommentThreadNode
} from './types/comments'
export type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryChangeSource,
  ReaderAnnotationHistoryOptions,
  ReaderAnnotationHistoryStatus,
  ReaderAnnotationHistoryValue,
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderLinkedSelectionRange,
  ReaderRectanglePopover,
  ReaderSelectionEndpoint,
  ReaderSelectionRange,
  ReaderSelectionRect,
  ReaderSelectionRef
} from './types/selection'

export type ReaderInteractiveProps = Pick<
  import('./components/Reader').ReaderProps,
  | 'ocr'
  | 'onSelectText'
  | 'onTextSelectionChange'
  | 'onTextSelectionEnd'
  | 'interactionMode'
  | 'touchPanMode'
  | 'ranges'
  | 'selectedRangeId'
  | 'onSelect'
  | 'onLinkedDataChange'
  | 'onLinkedSelect'
  | 'onLinkedUpdateRange'
  | 'onLinkedSelectRange'
  | 'onSelectRange'
  | 'onUpdateRange'
  | 'onSelectionStart'
  | 'onSelectionEnd'
  | 'onHighlight'
  | 'onRemoveRange'
  | 'onHighlightColorChange'
  | 'highlightColor'
  | 'selectionColor'
  | 'selectionPopover'
  | 'highlightPopover'
  | 'onCommentHighlight'
  | 'comments'
  | 'onCommentsChange'
  | 'selectionRef'
  | 'overlayRectType'
  | 'tool'
  | 'rects'
  | 'selectedRectId'
  | 'rectPopover'
  | 'onCreateRect'
  | 'onSelectRect'
  | 'onUpdateRect'
  | 'onRemoveRect'
  | 'annotationHistory'
  | 'onAnnotationHistoryChange'
  | 'containMarginX'
  | 'containMarginTop'
  | 'containMarginBottom'
  | 'containMarginY'
  | 'showPageBrowser'
  | 'onPageBrowserClose'
  | 'bookmarkedPageNumbers'
  | 'onTogglePageBookmark'
  | 'selectedTool'
  | 'paintingTool'
  | 'drawingStrokeColor'
  | 'pagePaintings'
  | 'defaultPagePaintings'
  | 'onPagePaintingChange'
  | 'onPagePaintingsChange'
>
