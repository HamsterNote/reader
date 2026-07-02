import type {
  LinkedSelectionData,
  LinkedSelectionRange,
  MousePosition,
  OverlayRect,
  OverlayRectType,
  SelectionEndpoint
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

/**
 * Reader 公开 selection ref 接口。
 *
 * 由 Reader 自己实现，不是上游 @hamster-note/selection 的 `SelectionRef`。
 * Reader 在内部将 `highlight()` / `clear()` 分发到各页面的上游
 * `SelectionRef`，并新增 `scrollToRange()` 来滚动到指定 range。
 */
export interface ReaderSelectionRef {
  /** 执行高亮：将当前用户选中的文本确认为一个持久高亮 range。 */
  highlight: () => void
  /** 清除所有页面的高亮和选区状态。 */
  clear: () => void
  /** 滚动视图到指定 range（按 range id 查找）。实现细节留给 Reader 内部。 */
  scrollToRange: (id: string) => void
}
export type ReaderMousePosition = MousePosition
export type ReaderSelectionOverlayRectType = OverlayRectType
