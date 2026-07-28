import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReaderEdgeCrop, ReaderPageEdgeCrop } from '../../types/readerData'
import { resolvePageEdgeCrop } from './pageDisplay'

/**
 * 单轴最大裁切比例，与 pageDisplay.ts 中 getPageCropGeometry 保持一致。
 * 每条边的裁切比例取值范围为 0..MAX_AXIS_CROP，且对边之和不超过 MAX_AXIS_CROP。
 */
const MAX_AXIS_CROP = 0.99

/** 四条可拖拽的裁切边 */
type Edge = 'top' | 'right' | 'bottom' | 'left'

type EdgeCropOverlayProps = {
  /** 当前页码（1-based），用于从 edgeCrop.pages 中解析该页的初始裁切值 */
  pageNumber: number
  /**
   * 真实的 ReaderPageEdgeCrop（来自 Reader props，未经编辑模式过滤）。
   * 覆盖层初始化时通过 resolvePageEdgeCrop 解析当前页的裁切值。
   */
  edgeCrop: ReaderPageEdgeCrop | undefined
  /**
   * 应用裁切回调。
   * - `pageNumber` 为具体页码时：将 crop 应用到该页（写入 edgeCrop.pages）。
   * - `pageNumber` 为 `null` 时：将 crop 应用到所有页面（写入 edgeCrop.all）。
   */
  onApply?: (pageNumber: number | null, crop: ReaderEdgeCrop) => void
}

/**
 * 边缘裁切编辑覆盖层（每页独立实例）。
 *
 * 仅在 edgeCropEditing 为 true 时由 IntermediateDocumentPages 渲染。
 * 渲染 4 条可拖拽的虚线（上/下/左/右），用户拖拽时实时更新本地裁切比例。
 * 提供两个按钮：
 * - 「应用到当前页」：将当前裁切值应用到当前页（onApply(pageNumber, crop)）。
 * - 「应用到全部」：将当前裁切值应用到所有页（onApply(null, crop)）。
 *
 * 使用 setPointerCapture 捕获指针，避免拖拽过程中 VirtualPaper 接收事件。
 * 本地状态由 resolvePageEdgeCrop(edgeCrop, pageNumber) 初始化，
 * 各页之间互不影响。
 */
export function EdgeCropOverlay({
  pageNumber,
  edgeCrop,
  onApply
}: EdgeCropOverlayProps) {
  // 从真实 edgeCrop 解析当前页的裁切值，作为本地编辑初始状态
  const [localCrop, setLocalCrop] = useState<ReaderEdgeCrop>(
    () =>
      resolvePageEdgeCrop(edgeCrop, pageNumber) ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      }
  )

  // 容器引用，用于计算指针相对位置
  const containerRef = useRef<HTMLDivElement>(null)
  // 拖拽状态：记录正在拖拽的边、指针 ID、拖拽起始时的容器矩形
  const dragRef = useRef<{
    edge: Edge
    pointerId: number
    rect: DOMRect
  } | null>(null)

  /**
   * 裁切比例约束：
   * - 0 ≤ ratio ≤ MAX_AXIS_CROP
   * - 对边之和 ≤ MAX_AXIS_CROP（top+bottom, left+right）
   */
  const clampRatio = useCallback(
    (edge: Edge, ratio: number, current: ReaderEdgeCrop): number => {
      const clamped = Math.max(0, Math.min(MAX_AXIS_CROP, ratio))
      // 对边的当前值（top↔bottom, left↔right）
      let opposite: number
      if (edge === 'top') {
        opposite = current.bottom ?? 0
      } else if (edge === 'bottom') {
        opposite = current.top ?? 0
      } else if (edge === 'left') {
        opposite = current.right ?? 0
      } else {
        opposite = current.left ?? 0
      }
      // 确保对边之和不超过 MAX_AXIS_CROP
      return Math.min(clamped, MAX_AXIS_CROP - opposite)
    },
    []
  )

  // pointerdown 必须用原生监听：VirtualPaper 在未启用 MouseDragPan 时，
  // 会在其 container 上注册原生 pointerdown 监听器并 stopPropagation，
  // React 合成事件（从根容器派发）无法冒泡到覆盖层，导致拖拽失效。
  // 原生监听器注册在覆盖层根元素（VirtualPaper container 的后代），先于拦截执行。
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const handleNativePointerDown = (event: PointerEvent) => {
      const line =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-edge]')
          : null
      if (!line) return
      const edge = line.dataset.edge as Edge | undefined
      if (!edge) return
      // 阻止 VirtualPaper 的鼠标拦截与 DragBase 手势处理竞争本次拖拽
      event.stopPropagation()
      const rect = root.getBoundingClientRect()
      dragRef.current = { edge, pointerId: event.pointerId, rect }
      line.setPointerCapture(event.pointerId)
    }
    root.addEventListener('pointerdown', handleNativePointerDown)
    return () => {
      root.removeEventListener('pointerdown', handleNativePointerDown)
    }
  }, [])

  // 指针移动：计算新比例并更新本地状态
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      e.stopPropagation()

      const { edge, rect } = drag
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      // 根据边的方向计算裁切比例
      let ratio: number
      switch (edge) {
        case 'top':
          ratio = y / rect.height
          break
        case 'bottom':
          ratio = (rect.height - y) / rect.height
          break
        case 'left':
          ratio = x / rect.width
          break
        case 'right':
          ratio = (rect.width - x) / rect.width
          break
      }

      const clamped = clampRatio(edge, ratio, localCrop)
      setLocalCrop((prev) => ({ ...prev, [edge]: clamped }))
    },
    [localCrop, clampRatio]
  )

  // 指针抬起：释放捕获，清除拖拽状态
  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      if (e.pointerId !== drag.pointerId) return
      e.stopPropagation()
      e.currentTarget.releasePointerCapture(e.pointerId)
      dragRef.current = null
    },
    []
  )

  // 应用到当前页：将当前本地裁切值应用到当前页码
  const handleApplyPage = useCallback(() => {
    onApply?.(pageNumber, localCrop)
  }, [pageNumber, localCrop, onApply])

  // 应用到全部：将当前本地裁切值应用到所有页面
  const handleApplyAll = useCallback(() => {
    onApply?.(null, localCrop)
  }, [localCrop, onApply])

  // 各边线条位置（百分比）
  const topPct = (localCrop.top ?? 0) * 100
  const bottomPct = (1 - (localCrop.bottom ?? 0)) * 100
  const leftPct = (localCrop.left ?? 0) * 100
  const rightPct = (1 - (localCrop.right ?? 0)) * 100

  return (
    <div ref={containerRef} className='hamster-reader__edge-crop-overlay'>
      {/* 上边裁切线（水平） */}
      <div
        className='hamster-reader__edge-crop-line hamster-reader__edge-crop-line--horizontal'
        data-testid='edge-crop-line-top'
        data-edge='top'
        style={{ top: `${topPct}%` }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* 下边裁切线（水平） */}
      <div
        className='hamster-reader__edge-crop-line hamster-reader__edge-crop-line--horizontal'
        data-testid='edge-crop-line-bottom'
        data-edge='bottom'
        style={{ top: `${bottomPct}%` }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* 左边裁切线（垂直） */}
      <div
        className='hamster-reader__edge-crop-line hamster-reader__edge-crop-line--vertical'
        data-testid='edge-crop-line-left'
        data-edge='left'
        style={{ left: `${leftPct}%` }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* 右边裁切线（垂直） */}
      <div
        className='hamster-reader__edge-crop-line hamster-reader__edge-crop-line--vertical'
        data-testid='edge-crop-line-right'
        data-edge='right'
        style={{ left: `${rightPct}%` }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {/* 每页操作按钮区域 */}
      <div className='hamster-reader__edge-crop-actions'>
        <button
          type='button'
          className='hamster-reader__edge-crop-action hamster-reader__edge-crop-action--page'
          data-testid='edge-crop-apply-page'
          onClick={handleApplyPage}
        >
          应用到当前页
        </button>
        <button
          type='button'
          className='hamster-reader__edge-crop-action hamster-reader__edge-crop-action--all'
          data-testid='edge-crop-apply-all'
          onClick={handleApplyAll}
        >
          应用到全部
        </button>
      </div>
    </div>
  )
}
