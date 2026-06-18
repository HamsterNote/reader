/**
 * 手势路由 — 纯逻辑决策层。
 *
 * 根据 `interactionMode`（default / stylus）和 `pointerType`（mouse / touch / pen）
 * 决定某个输入事件应该被路由到哪种行为：
 * - 文本选择（selection）
 * - 长按等待（long-press timer）
 * - 空白点击（blank click）
 *
 * 视口平移/缩放已由 VirtualPaper 处理，本文件不再负责 pan/pinch/wheel 路由。
 * 本文件不维护任何状态，也不操作 DOM；所有决策仅依赖调用方传入的瞬时上下文。
 */

import type { ReaderInteractionMode } from './IntermediateDocumentViewer'

/** 调用方已识别的指针类型。 */
export type ReaderPointerType = 'mouse' | 'touch' | 'pen' | 'unknown'

/**
 * 将 PointerEvent.pointerType 归一化为 ReaderPointerType。
 *
 * @param pointerType - PointerEvent.pointerType 值
 * @returns 归一化后的 ReaderPointerType
 */
export function toReaderPointerType(
  pointerType: string | undefined
): ReaderPointerType {
  if (
    pointerType === 'mouse' ||
    pointerType === 'touch' ||
    pointerType === 'pen'
  ) {
    return pointerType
  }
  return 'unknown'
}

/**
 * pointerdown 时是否应该立即启动文本选择（非长按路径）。
 *
 * - default 模式：鼠标和手写笔在文本上立即选择；触摸走长按路径。
 * - stylus 模式：只有手写笔在文本上立即选择。
 *
 * @param args.interactionMode - 当前交互模式
 * @param args.pointerType - 当前指针类型
 * @param args.isOnText - 落点是否在可选文本上
 * @returns 是否允许立即开始选择
 */
export function shouldStartSelectionOnPointerDown(args: {
  interactionMode: ReaderInteractionMode
  pointerType: ReaderPointerType
  isOnText: boolean
}): boolean {
  if (!args.isOnText) return false

  if (args.interactionMode === 'stylus') {
    // stylus 模式：仅 pen 可选中文本
    return args.pointerType === 'pen'
  }

  // default 模式：鼠标、手写笔都可立即选择；触摸走长按
  return args.pointerType === 'mouse' || args.pointerType === 'pen'
}

/**
 * pointerdown 时是否应该启用手长按定时器。
 *
 * 仅在 default 模式且为单指触摸时启用。
 *
 * @param args.interactionMode - 当前交互模式
 * @param args.pointerType - 当前指针类型
 * @returns 是否启用手长按
 */
export function shouldArmLongPress(args: {
  interactionMode: ReaderInteractionMode
  pointerType: ReaderPointerType
}): boolean {
  return args.interactionMode === 'default' && args.pointerType === 'touch'
}

/**
 * pointerdown 时是否应该将事件视为“空白点击”（清除选择但不触发 pan）。
 *
 * 所有模式下，鼠标/触摸/手写笔点击空白区域都属于空白点击。
 *
 * @param args.isOnText - 落点是否在可选文本上
 * @returns 是否视为空白点击
 */
export function isBlankClick(args: { isOnText: boolean }): boolean {
  return !args.isOnText
}

/**
 * 在 stylus 模式下，是否应该阻止鼠标和触摸的文本选择能力。
 *
 * 这是一个聚合判断，方便上层在 onStart 中快速拦截。
 *
 * @param interactionMode - 当前交互模式
 * @param pointerType - 当前指针类型
 * @returns 是否应该强制阻止选择
 */
export function shouldForceBlockSelection(
  interactionMode: ReaderInteractionMode,
  pointerType: ReaderPointerType
): boolean {
  if (interactionMode !== 'stylus') return false
  return pointerType !== 'pen'
}
