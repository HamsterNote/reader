import type {
  LinkedSelectionData,
  LinkedSelectionRange,
  MousePosition,
  OverlayRect,
  OverlayRectType,
  SelectionEndpoint,
  SelectionRef
} from '@hamster-note/selection'

/**
 * Reader 公开 linked selection 端点。
 *
 * `selectionId` 只使用稳定的公开页面 ID（例如 `page-2`）。Reader 后续在
 * 运行时传给 @hamster-note/selection 的 scoped ID 是内部 adapter 细节，
 * 不能出现在这个公开类型、回调 payload 或持久化数据里。
 */
export type ReaderSelectionEndpoint = SelectionEndpoint

/** Reader 公开 selection 矩形；linked ranges 按页面 ID 分组保存这些矩形。 */
export type ReaderSelectionRect = OverlayRect

export type ReaderLinkedSelectionRange = Omit<
  LinkedSelectionRange,
  'start' | 'end' | 'rectsBySelectionId'
> & {
  start: ReaderSelectionEndpoint
  end: ReaderSelectionEndpoint
  rectsBySelectionId: Record<string, ReaderSelectionRect[]>
}

/** html-parser highlight API 的公开 range 契约：只接受 linked/page-scoped 形状。 */
export type ReaderSelectionRange = ReaderLinkedSelectionRange & {
  readonly __readerSelectionRangeBrand?: never
}

export type ReaderLinkedSelectionData = Omit<
  LinkedSelectionData,
  'items' | 'activeRange'
> & {
  items: ReaderLinkedSelectionRange[]
  activeRange?: ReaderLinkedSelectionRange | null
}

export type ReaderSelectionRef = SelectionRef
export type ReaderMousePosition = MousePosition
export type ReaderSelectionOverlayRectType = OverlayRectType
