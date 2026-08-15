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
  type DefaultPopoverContext,
  DefaultRectanglePopover,
  type DefaultRectanglePopoverProps,
  DefaultSelectionPopover
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
  ReaderExtraOcr,
  ReaderInteractionMode,
  ReaderIntermediateImage,
  ReaderIntermediateImageSerialized,
  ReaderOcrOptions,
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
  HIGHLIGHT_DEBUG_STORAGE_KEY,
  type HighlightDebugEvent,
  summarizeHighlightRanges,
  traceHighlight
} from './components/IntermediateDocumentViewer/highlightDebug'
export {
  FLOW_LAYOUT_PAGE_WIDTH,
  Page,
  type PageProps,
  type ReaderFlowLayoutPage,
  type ReaderPagePaintingMap,
  type ReaderPageRectSelectionMap,
  type ReaderPageTextSelectionMap,
  type ReaderPageTool
} from './components/Page'
export {
  Reader,
  type ReaderLoadingProgress,
  type ReaderProps,
  type ReaderRenderMode
} from './components/Reader'
export type {
  ReaderComment,
  ReaderCommentChangeDetail,
  ReaderCommentChangeSource,
  ReaderCommentThreadNode
} from './types/comments'
export type { ReaderFontScale } from './types/fontScale'
export type {
  ReaderBookmark,
  ReaderData,
  ReaderEdgeCrop,
  ReaderPageEdgeCrop,
  ReaderPagePositionBookmark,
  ReaderTextAnchor,
  ReaderTextReadingProgress,
  ReaderVirtualPaperState
} from './types/readerData'
export type { ReaderColorOption } from './types/readerOptions'
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
  ReaderSelectionPopover,
  ReaderSelectionRange,
  ReaderSelectionRect,
  ReaderSelectionRef
} from './types/selection'

export type ReaderInteractiveProps = Pick<
  import('./components/Reader').ReaderProps,
  | 'data'
  | 'onDataChange'
  | 'ocr'
  | 'onOcrChange'
  | 'extraOCR'
  | 'onSelectText'
  | 'onTextSelectionChange'
  | 'onTextSelectionEnd'
  | 'interactionMode'
  | 'renderMode'
  | 'onRenderModeChange'
  | 'fontScale'
  | 'onFontScaleChange'
  | 'touchPanMode'
  | 'onTouchPanModeChange'
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
  | 'onDragHighlight'
  | 'onRemoveRange'
  | 'onHighlightColorChange'
  | 'highlightColor'
  | 'selectionColor'
  | 'showSelectionMagnifier'
  | 'selectionPopover'
  | 'queryWord'
  | 'onOpenDictionary'
  | 'highlightPopover'
  | 'onCommentHighlight'
  | 'onCommentRect'
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
  | 'bookmarks'
  | 'onToggleBookmark'
  | 'bookmarkedPageNumbers'
  | 'onTogglePageBookmark'
  | 'selectedTool'
  | 'onSelectedToolChange'
  | 'colors'
  | 'paintingTool'
  | 'drawingStrokeColor'
  | 'onDrawingStrokeColorChange'
  | 'pagePaintings'
  | 'defaultPagePaintings'
  | 'onPagePaintingChange'
  | 'onPagePaintingsChange'
  | 'edgeCropEditing'
  | 'onEdgeCropEditingChange'
  | 'bottomBar'
>
