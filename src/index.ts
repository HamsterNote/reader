// Selection 库类型别名直接从 @hamster-note/selection re-export，
// 绕过 IntermediateDocumentViewer 中的 type alias 转发
// （TS 5.9 在 bundler + isolatedModules 下 export type X = ExternalType 存在已知问题）
export type {
  MousePosition as ReaderMousePosition,
  OverlayRectType as ReaderSelectionOverlayRectType,
  SelectionRect as ReaderSelectionRectangle,
  SelectionTool as ReaderSelectionTool
} from '@hamster-note/selection'

export type {
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderLinkedSelectionRange,
  ReaderSelectionEndpoint,
  ReaderSelectionRange,
  ReaderSelectionRect,
  ReaderSelectionRef
} from './types/selection'

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

export {
  DefaultSelectionPopover,
  DefaultHighlightPopover,
  type DefaultPopoverContext
} from './components/DefaultPopover'

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
  | 'selectionRef'
  | 'overlayRectType'
  | 'tool'
  | 'rects'
  | 'selectedRectId'
  | 'onCreateRect'
  | 'onSelectRect'
  | 'onUpdateRect'
  | 'containMarginX'
  | 'containMarginTop'
  | 'containMarginBottom'
  | 'containMarginY'
  | 'showPageBrowser'
  | 'selectedTool'
  | 'paintingTool'
  | 'pagePaintings'
  | 'defaultPagePaintings'
  | 'onPagePaintingChange'
  | 'onPagePaintingsChange'
>
