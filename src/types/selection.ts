import type {
  LinkedSelectionData,
  LinkedSelectionRange,
  MousePosition,
  OverlayRect,
  OverlayRectType,
  SelectionEndpoint,
  SelectionRect,
  SelectionTool
} from '@hamster-note/selection'
import type { ReactNode } from 'react'

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

/** Reader 公开矩形框选工具类型。 */
export type ReaderSelectionTool = SelectionTool

/** Reader 公开矩形框选数据。 */
export type ReaderSelectionRectangle = SelectionRect

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

/** 已确认高亮 Popover：静态内容，或基于当前高亮原始对象渲染的内容。 */
export type ReaderHighlightPopover =
  | ReactNode
  | ((highlight: ReaderSelectionRange) => ReactNode)

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
 * `SelectionRef`，并新增 `scrollToRange()` / `scrollToRect()` / `scrollToPosition()`
 * 来滚动到指定 range、矩形或滚动偏移。
 */
export interface ReaderSelectionRef {
  /** 执行高亮：将当前用户选中的文本确认为一个持久高亮 range。 */
  highlight: () => void
  /**
   * 通用确认：根据当前 tool 模式分发。
   * - `tool='text'`（默认）时等价于 `highlight()`
   * - `tool='rect'` 时等价于 `confirmRect()`
   */
  confirm: () => void
  /**
   * 矩形确认：将当前活跃的矩形框选确认为一个持久 ReaderSelectionRectangle。
   * 内部会触发 onCreateRect 回调，然后清除活跃矩形状态。
   */
  confirmRect: () => void
  /** 清除所有页面的高亮和选区状态。 */
  clear: () => void
  /** 滚动视图到指定 range（按 range id 查找）。实现细节留给 Reader 内部。 */
  scrollToRange: (id: string) => void
  /** 滚动视图到指定矩形框选（按 rect id 查找）。实现细节留给 Reader 内部。 */
  scrollToRect: (id: string) => void
  /**
   * 滚动 VirtualPaper 到指定坐标位置。
   * - `x`/`y` 为内容区滚动偏移（单位 px），(0,0) 表示内容左上角。
   * - `scale` 可选，未提供时保持当前缩放。
   */
  scrollToPosition: (position: { x: number; y: number; scale?: number }) => void
}
export type ReaderMousePosition = MousePosition
export type ReaderSelectionOverlayRectType = OverlayRectType
