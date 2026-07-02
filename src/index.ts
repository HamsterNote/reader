// Selection 库类型别名直接从 @hamster-note/selection re-export，
// 绕过 IntermediateDocumentViewer 中的 type alias 转发
// （TS 5.9 在 bundler + isolatedModules 下 export type X = ExternalType 存在已知问题）
export type {
  MousePosition as ReaderMousePosition,
  OverlayRectType as ReaderSelectionOverlayRectType
} from '@hamster-note/selection'

export type {
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
  denormalizePageRects,
  IntermediateDocumentViewer,
  type IntermediateDocumentViewerProps,
  normalizePageRects,
  resolveSavedSelection,
  type ReaderInteractionMode,
  type ReaderPageRange,
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
  type TextElementInfo,
  createIntermediateDocumentRenderTiming,
  type CreateIntermediateDocumentRenderTimingOptions,
  type IntermediateDocumentRenderTiming,
  type IntermediateDocumentRenderTimingCallback,
  type IntermediateDocumentRenderTimingClock,
  type IntermediateDocumentRenderTimingEntry,
  type IntermediateDocumentRenderTimingStage
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
  | 'onLinkedDataChange'
  | 'onLinkedSelect'
  | 'onLinkedUpdateRange'
  | 'onLinkedSelectRange'
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
