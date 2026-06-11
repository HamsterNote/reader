import { describe, expect, it } from 'vitest'

import {
  armDragPreview,
  cancelDragPreview,
  createDragPreviewSession,
  finalizeDragPreview,
  geometryToOverlayRects,
  shouldShowSelectionHandles,
  updateDragPreview,
  type DragPreviewRect,
  type DragPreviewSession
} from '../src/components/selection/dragPreviewModel'

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

/** 创建一个标准的预览矩形 */
const makeRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  pageNumber: number
): DragPreviewRect => ({ x, y, width, height, pageNumber })

/** 从 idle 开始，经过 armed，到指定位置的完整会话 */
const makeArmedSession = (anchorX = 100, anchorY = 200): DragPreviewSession =>
  armDragPreview(createDragPreviewSession(), {
    clientX: anchorX,
    clientY: anchorY
  })

/** 创建已进入 dragging 状态的会话（移动超过阈值） */
const makeDraggingSession = (
  anchorX = 100,
  anchorY = 200,
  rects: DragPreviewRect[] = [makeRect(50, 100, 200, 30, 1)]
): DragPreviewSession =>
  updateDragPreview(
    makeArmedSession(anchorX, anchorY),
    { clientX: anchorX + 10, clientY: anchorY + 10 },
    rects
  )

// ---------------------------------------------------------------------------
// createDragPreviewSession
// ---------------------------------------------------------------------------

describe('createDragPreviewSession', () => {
  it('returns a session in idle state with null points and empty rects', () => {
    const session = createDragPreviewSession()

    expect(session.state).toBe('idle')
    expect(session.anchorPoint).toBeNull()
    expect(session.currentPoint).toBeNull()
    expect(session.previewRects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// armDragPreview
// ---------------------------------------------------------------------------

describe('armDragPreview', () => {
  it('transitions from idle to armed and records anchor point', () => {
    const session = armDragPreview(createDragPreviewSession(), {
      clientX: 50,
      clientY: 80
    })

    expect(session.state).toBe('armed')
    expect(session.anchorPoint).toEqual({ clientX: 50, clientY: 80 })
    expect(session.currentPoint).toEqual({ clientX: 50, clientY: 80 })
  })

  it('is a no-op when called from non-idle states', () => {
    const armed = makeArmedSession()
    const armedAgain = armDragPreview(armed, { clientX: 999, clientY: 999 })

    // 不应改变状态或锚点
    expect(armedAgain).toBe(armed)
    expect(armedAgain.anchorPoint).toEqual({ clientX: 100, clientY: 200 })

    const dragging = makeDraggingSession()
    const draggingAgain = armDragPreview(dragging, {
      clientX: 999,
      clientY: 999
    })
    expect(draggingAgain).toBe(dragging)
  })
})

// ---------------------------------------------------------------------------
// updateDragPreview — 移动阈值逻辑
// ---------------------------------------------------------------------------

describe('updateDragPreview', () => {
  it('stays armed when movement is below threshold (pointerdown-only)', () => {
    const armed = makeArmedSession(100, 200)

    // 移动 2px（阈值为 4px）
    const updated = updateDragPreview(armed, { clientX: 101, clientY: 201 })

    expect(updated.state).toBe('armed')
    expect(updated.currentPoint).toEqual({ clientX: 101, clientY: 201 })
    // previewRects 不应在 armed 阶段更新
    expect(updated.previewRects).toEqual([])
  })

  it('transitions to dragging when movement exceeds threshold', () => {
    const armed = makeArmedSession(100, 200)
    const rects = [makeRect(50, 100, 200, 30, 1)]

    // 移动 ~14px（超过 4px 阈值）
    const updated = updateDragPreview(
      armed,
      { clientX: 110, clientY: 210 },
      rects
    )

    expect(updated.state).toBe('dragging')
    expect(updated.currentPoint).toEqual({ clientX: 110, clientY: 210 })
    expect(updated.previewRects).toBe(rects)
  })

  it('continues updating in dragging state', () => {
    const dragging = makeDraggingSession()
    const newRects = [makeRect(60, 110, 180, 25, 1)]

    const updated = updateDragPreview(
      dragging,
      { clientX: 130, clientY: 230 },
      newRects
    )

    expect(updated.state).toBe('dragging')
    expect(updated.currentPoint).toEqual({ clientX: 130, clientY: 230 })
    expect(updated.previewRects).toBe(newRects)
  })

  it('is a no-op from idle state', () => {
    const idle = createDragPreviewSession()
    const updated = updateDragPreview(idle, { clientX: 50, clientY: 50 })

    expect(updated).toBe(idle)
  })

  it('is a no-op from finalizing state', () => {
    const finalizing = finalizeDragPreview(makeDraggingSession())
    const updated = updateDragPreview(
      finalizing,
      { clientX: 999, clientY: 999 },
      [makeRect(0, 0, 100, 100, 1)]
    )

    expect(updated).toBe(finalizing)
  })

  it('uses Euclidean distance for threshold check', () => {
    const armed = makeArmedSession(100, 200)

    // dx=2, dy=2 → distance ≈ 2.83 < 4 → stays armed
    const belowThreshold = updateDragPreview(armed, {
      clientX: 102,
      clientY: 202
    })
    expect(belowThreshold.state).toBe('armed')

    // dx=3, dy=3 → distance ≈ 4.24 > 4 → transitions to dragging
    const aboveThreshold = updateDragPreview(armed, {
      clientX: 103,
      clientY: 203
    })
    expect(aboveThreshold.state).toBe('dragging')
  })
})

// ---------------------------------------------------------------------------
// finalizeDragPreview
// ---------------------------------------------------------------------------

describe('finalizeDragPreview', () => {
  it('transitions from dragging to finalizing', () => {
    const dragging = makeDraggingSession()
    const finalizing = finalizeDragPreview(dragging)

    expect(finalizing.state).toBe('finalizing')
    // 保留 previewRects 和坐标
    expect(finalizing.previewRects).toEqual(dragging.previewRects)
    expect(finalizing.anchorPoint).toBe(dragging.anchorPoint)
    expect(finalizing.currentPoint).toBe(dragging.currentPoint)
  })

  it('is a no-op from non-dragging states', () => {
    const idle = createDragPreviewSession()
    expect(finalizeDragPreview(idle)).toBe(idle)

    const armed = makeArmedSession()
    expect(finalizeDragPreview(armed)).toBe(armed)

    const finalizing = finalizeDragPreview(makeDraggingSession())
    expect(finalizeDragPreview(finalizing)).toBe(finalizing)
  })
})

// ---------------------------------------------------------------------------
// cancelDragPreview — 取消路径
// ---------------------------------------------------------------------------

describe('cancelDragPreview', () => {
  it('returns idle from armed state and clears all data', () => {
    const armed = makeArmedSession()
    const cancelled = cancelDragPreview(armed)

    expect(cancelled.state).toBe('idle')
    expect(cancelled.anchorPoint).toBeNull()
    expect(cancelled.currentPoint).toBeNull()
    expect(cancelled.previewRects).toEqual([])
  })

  it('returns idle from dragging state and clears all data', () => {
    const dragging = makeDraggingSession()
    const cancelled = cancelDragPreview(dragging)

    expect(cancelled.state).toBe('idle')
    expect(cancelled.anchorPoint).toBeNull()
    expect(cancelled.currentPoint).toBeNull()
    expect(cancelled.previewRects).toEqual([])
  })

  it('returns idle from finalizing state', () => {
    const finalizing = finalizeDragPreview(makeDraggingSession())
    const cancelled = cancelDragPreview(finalizing)

    expect(cancelled.state).toBe('idle')
    expect(cancelled.anchorPoint).toBeNull()
    expect(cancelled.previewRects).toEqual([])
  })

  it('is a no-op from idle state', () => {
    const idle = createDragPreviewSession()
    expect(cancelDragPreview(idle)).toBe(idle)
  })

  it('returns a fresh session (no shared references)', () => {
    const dragging = makeDraggingSession()
    const cancelled = cancelDragPreview(dragging)

    // 确保不是同一个对象引用
    expect(cancelled).not.toBe(dragging)
    expect(cancelled.previewRects).not.toBe(dragging.previewRects)
  })
})

// ---------------------------------------------------------------------------
// shouldShowSelectionHandles
// ---------------------------------------------------------------------------

describe('shouldShowSelectionHandles', () => {
  it('returns true for idle state', () => {
    expect(shouldShowSelectionHandles('idle')).toBe(true)
  })

  it('returns true for armed state', () => {
    expect(shouldShowSelectionHandles('armed')).toBe(true)
  })

  it('returns false for dragging state', () => {
    expect(shouldShowSelectionHandles('dragging')).toBe(false)
  })

  it('returns true for finalizing state', () => {
    // finalizing 状态下手柄在一帧内可能因渲染时序不可见，
    // 但模型层面返回 true，具体可见性由渲染层控制。
    expect(shouldShowSelectionHandles('finalizing')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// geometryToOverlayRects — 几何转换
// ---------------------------------------------------------------------------

describe('geometryToOverlayRects', () => {
  it('produces a single union bounding rect for same-page anchor and focus', () => {
    const anchor = makeRect(10, 20, 50, 30, 1)
    const focus = makeRect(60, 40, 40, 20, 1)

    const rects = geometryToOverlayRects(anchor, focus)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toEqual({
      x: 10,
      y: 20,
      width: 90, // max(10+50, 60+40) - min(10, 60) = 100 - 10
      height: 40, // max(20+30, 40+20) - min(20, 40) = 60 - 20
      pageNumber: 1
    })
  })

  it('produces two rects for cross-page anchor and focus', () => {
    const anchor = makeRect(10, 20, 50, 30, 1)
    const focus = makeRect(30, 40, 60, 20, 3)

    const rects = geometryToOverlayRects(anchor, focus)

    expect(rects).toHaveLength(2)
    expect(rects[0]).toEqual(anchor)
    expect(rects[1]).toEqual(focus)
  })

  it('filters out zero-area anchor rect in cross-page scenario', () => {
    const anchor = makeRect(10, 20, 0, 30, 1) // width=0 → 零面积
    const focus = makeRect(30, 40, 60, 20, 3)

    const rects = geometryToOverlayRects(anchor, focus)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toEqual(focus)
  })

  it('filters out zero-area focus rect in cross-page scenario', () => {
    const anchor = makeRect(10, 20, 50, 30, 1)
    const focus = makeRect(30, 40, 60, 0, 3) // height=0 → 零面积

    const rects = geometryToOverlayRects(anchor, focus)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toEqual(anchor)
  })

  it('returns empty array when same-page union has zero area', () => {
    // anchor 和 focus 完全重合且零面积
    const anchor = makeRect(10, 20, 0, 0, 1)
    const focus = makeRect(10, 20, 0, 0, 1)

    const rects = geometryToOverlayRects(anchor, focus)

    expect(rects).toEqual([])
  })

  it('handles anchor entirely inside focus on same page', () => {
    const anchor = makeRect(20, 30, 10, 10, 1)
    const focus = makeRect(10, 20, 50, 40, 1)

    const rects = geometryToOverlayRects(anchor, focus)

    expect(rects).toHaveLength(1)
    // 联合包围矩形就是 focus 本身
    expect(rects[0]).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 40,
      pageNumber: 1
    })
  })

  it('returns empty when both cross-page rects have zero area', () => {
    const anchor = makeRect(10, 20, 0, 10, 1)
    const focus = makeRect(30, 40, 50, 0, 2)

    const rects = geometryToOverlayRects(anchor, focus)

    expect(rects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 完整生命周期集成测试
// ---------------------------------------------------------------------------

describe('full drag preview lifecycle', () => {
  it('idle → armed → dragging → finalizing → idle', () => {
    let session = createDragPreviewSession()
    expect(session.state).toBe('idle')

    // 1. arm
    session = armDragPreview(session, { clientX: 100, clientY: 200 })
    expect(session.state).toBe('armed')
    expect(shouldShowSelectionHandles(session.state)).toBe(true)

    // 2. small move (below threshold) — stays armed
    session = updateDragPreview(session, { clientX: 101, clientY: 201 })
    expect(session.state).toBe('armed')

    // 3. large move (above threshold) — enters dragging
    session = updateDragPreview(session, { clientX: 115, clientY: 215 }, [
      makeRect(50, 100, 200, 30, 1)
    ])
    expect(session.state).toBe('dragging')
    expect(shouldShowSelectionHandles(session.state)).toBe(false)

    // 4. finalize
    session = finalizeDragPreview(session)
    expect(session.state).toBe('finalizing')
    expect(shouldShowSelectionHandles(session.state)).toBe(true)
    expect(session.previewRects).toHaveLength(1)

    // 5. 可以从 finalizing 取消
    session = cancelDragPreview(session)
    expect(session.state).toBe('idle')
    expect(session.previewRects).toEqual([])
  })

  it('idle → armed → cancel → idle (early cancel path)', () => {
    let session = createDragPreviewSession()

    session = armDragPreview(session, { clientX: 50, clientY: 80 })
    expect(session.state).toBe('armed')

    session = cancelDragPreview(session)
    expect(session.state).toBe('idle')
    expect(session.anchorPoint).toBeNull()
  })

  it('idle → armed → dragging → cancel → idle (mid-drag cancel path)', () => {
    let session = createDragPreviewSession()

    session = armDragPreview(session, { clientX: 50, clientY: 80 })
    session = updateDragPreview(session, { clientX: 60, clientY: 90 }, [
      makeRect(10, 20, 100, 50, 1)
    ])
    expect(session.state).toBe('dragging')

    session = cancelDragPreview(session)
    expect(session.state).toBe('idle')
    expect(session.previewRects).toEqual([])
  })
})
