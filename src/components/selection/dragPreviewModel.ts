/**
 * dragPreviewModel — 纯状态/几何计算模块
 *
 * 零 React、零 DOM 依赖。提供拖拽预览的状态机和几何转换，
 * 作为 Task 3（集成到 IntermediateDocumentViewer）的基础。
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 拖拽预览状态机的四个阶段 */
export type DragPreviewState = 'idle' | 'armed' | 'dragging' | 'finalizing'

/**
 * 页面坐标系下的矩形，与 ReaderSelectionOverlayRect 结构兼容。
 * 保持独立定义以避免循环导入。
 */
export type DragPreviewRect = {
  x: number
  y: number
  width: number
  height: number
  pageNumber: number
}

/** 指针坐标点（客户端坐标系） */
export type DragPreviewPoint = {
  clientX: number
  clientY: number
}

/** 拖拽预览会话的完整快照 */
export type DragPreviewSession = {
  state: DragPreviewState
  anchorPoint: DragPreviewPoint | null
  currentPoint: DragPreviewPoint | null
  previewRects: DragPreviewRect[]
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * 移动阈值（像素）。
 * pointerdown 后移动距离小于此值保持 armed 状态，
 * 超过此值才进入 dragging。
 */
const MOVE_THRESHOLD_PX = 4

// ---------------------------------------------------------------------------
// 状态转换函数
// ---------------------------------------------------------------------------

/**
 * 创建新的拖拽预览会话，初始状态为 idle。
 */
export const createDragPreviewSession = (): DragPreviewSession => ({
  state: 'idle',
  anchorPoint: null,
  currentPoint: null,
  previewRects: []
})

/**
 * 从 idle 进入 armed 状态，记录锚点坐标。
 * 仅在 idle 状态下有效，其他状态调用返回原 session 不变。
 */
export const armDragPreview = (
  session: DragPreviewSession,
  anchorPoint: DragPreviewPoint
): DragPreviewSession => {
  if (session.state !== 'idle') return session

  return {
    ...session,
    state: 'armed',
    anchorPoint,
    currentPoint: anchorPoint
  }
}

/**
 * 更新拖拽位置。当移动距离超过阈值时从 armed 转入 dragging。
 * 在 dragging 状态下持续更新 currentPoint 和 previewRects。
 * 仅在 armed 或 dragging 状态下有效。
 */
export const updateDragPreview = (
  session: DragPreviewSession,
  currentPoint: DragPreviewPoint,
  previewRects: DragPreviewRect[] = []
): DragPreviewSession => {
  if (session.state !== 'armed' && session.state !== 'dragging') {
    return session
  }

  // armed 状态下检查是否超过移动阈值
  if (session.state === 'armed' && session.anchorPoint) {
    const dx = currentPoint.clientX - session.anchorPoint.clientX
    const dy = currentPoint.clientY - session.anchorPoint.clientY
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance < MOVE_THRESHOLD_PX) {
      // 未超过阈值，保持 armed，更新当前位置但不更新 rects
      return { ...session, currentPoint }
    }

    // 超过阈值，转入 dragging
    return {
      ...session,
      state: 'dragging',
      currentPoint,
      previewRects
    }
  }

  // dragging 状态下持续更新
  return {
    ...session,
    currentPoint,
    previewRects
  }
}

/**
 * 进入 finalizing 状态（拖拽结束，准备提交最终选区）。
 * 仅在 dragging 状态下有效。
 */
export const finalizeDragPreview = (
  session: DragPreviewSession
): DragPreviewSession => {
  if (session.state !== 'dragging') return session

  return {
    ...session,
    state: 'finalizing'
  }
}

/**
 * 取消拖拽预览，从 armed 或 dragging 返回 idle 并清空所有预览数据。
 * finalizing 状态下也可取消。
 */
export const cancelDragPreview = (
  session: DragPreviewSession
): DragPreviewSession => {
  if (session.state === 'idle') return session

  return createDragPreviewSession()
}

// ---------------------------------------------------------------------------
// UI 查询函数
// ---------------------------------------------------------------------------

/**
 * 判断当前状态是否应显示选择手柄（selection handles）。
 *
 * - idle: true（无拖拽，正常显示）
 * - armed: true（尚未开始拖动，正常显示）
 * - dragging: false（拖拽进行中，隐藏手柄以避免视觉干扰）
 * - finalizing: true（拖拽结束，恢复手柄显示）
 *
 * 注意：finalizing 状态下手柄在一帧内可能因渲染时序不可见，
 * 但模型层面返回 true，具体可见性由渲染层控制。
 */
export const shouldShowSelectionHandles = (
  state: DragPreviewState
): boolean => {
  return state !== 'dragging'
}

// ---------------------------------------------------------------------------
// 几何转换
// ---------------------------------------------------------------------------

/**
 * 将锚点矩形和焦点矩形转换为 overlay rect 数组。
 *
 * 输入的 anchor 和 focus 是页面坐标系下的矩形（与 ReaderSelectionOverlayRect 兼容）。
 * 输出数组可直接传给 rectsToUnionPolygons() 进行多边形合并。
 *
 * 策略：
 * - 同页：生成一个包含 anchor 和 focus 的联合包围矩形
 * - 跨页：为每页生成独立的包围矩形（基于 anchor/focus 各自所在的页）
 *
 * 过滤掉零面积矩形。
 */
export const geometryToOverlayRects = (
  anchor: DragPreviewRect,
  focus: DragPreviewRect
): DragPreviewRect[] => {
  if (anchor.pageNumber === focus.pageNumber) {
    // 同页：计算联合包围矩形
    const left = Math.min(anchor.x, focus.x)
    const top = Math.min(anchor.y, focus.y)
    const right = Math.max(anchor.x + anchor.width, focus.x + focus.width)
    const bottom = Math.max(anchor.y + anchor.height, focus.y + focus.height)
    const width = right - left
    const height = bottom - top

    if (width <= 0 || height <= 0) return []

    return [
      {
        x: left,
        y: top,
        width,
        height,
        pageNumber: anchor.pageNumber
      }
    ]
  }

  // 跨页：anchor 和 focus 各自保留原始矩形
  const rects: DragPreviewRect[] = []

  if (anchor.width > 0 && anchor.height > 0) {
    rects.push({ ...anchor })
  }

  if (focus.width > 0 && focus.height > 0) {
    rects.push({ ...focus })
  }

  return rects
}
