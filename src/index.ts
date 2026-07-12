// Selection 库类型别名直接从 @hamster-note/selection re-export，
// 绕过 IntermediateDocumentViewer 中的 type alias 转发
// （TS 5.9 在 bundler + isolatedModules 下 export type X = ExternalType 存在已知问题）
export type {
  MousePosition as ReaderMousePosition,
  OverlayRectType as ReaderSelectionOverlayRectType,
  SelectionRange as ReaderSelectionRange,
  SelectionRef as ReaderSelectionRef
} from '@hamster-note/selection'

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
  | 'ranges'
  | 'selectedRangeId'
  | 'onSelect'
  | 'onSelectRange'
  | 'onUpdateRange'
  | 'onSelectionStart'
  | 'onSelectionEnd'
  | 'onHighlight'
  | 'highlightColor'
  | 'selectionColor'
  | 'selectionPopover'
  | 'selectionRef'
  | 'overlayRectType'
>
