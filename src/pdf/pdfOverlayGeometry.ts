// HAM-89 / tasks.md 3.3：reader 高亮/矩形/绘图叠加层与官方 viewer viewport
// 之间的坐标适配。存储坐标系契约（sample-manifest.md / interaction-matrix.md）：
// - `overlayRectType: 'px'`：scale=1 可视页（旋转后尺寸）左上角原点、y 向下；
// - `overlayRectType: 'percent'`：可视页宽高的 0-100 百分比。
// pdf.js PageViewport 同时封装缩放与旋转：存储坐标先经 scale-1 viewport 的
// convertToPdfPoint 落到 PDF user space（y 向上），再经当前 viewport 投回
// 显示坐标，因此旋转/缩放样本下叠加自动对齐，持久化坐标不变。

import type { PageViewport } from './pdfjsRuntime'

export type StoredOverlayRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type OverlayRectUnit = 'px' | 'percent'

export type ViewportOverlayRect = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export type PageVisualSize = {
  readonly width: number
  readonly height: number
}

const storedToScaleOneVisual = (
  rect: StoredOverlayRect,
  unit: OverlayRectUnit,
  visual: PageVisualSize
): StoredOverlayRect =>
  unit === 'percent'
    ? {
        x: (rect.x / 100) * visual.width,
        y: (rect.y / 100) * visual.height,
        width: (rect.width / 100) * visual.width,
        height: (rect.height / 100) * visual.height
      }
    : rect

/**
 * 存储矩形（px/percent，scale-1 可视页坐标）→ 当前 viewport 下相对 page
 * div 左上角的显示矩形。
 */
export function projectStoredRectToViewport(
  rect: StoredOverlayRect,
  unit: OverlayRectUnit,
  scaleOneViewport: PageViewport,
  viewport: PageViewport,
  visual: PageVisualSize
): ViewportOverlayRect {
  const visualRect = storedToScaleOneVisual(rect, unit, visual)

  const [ux1, uy1] = scaleOneViewport.convertToPdfPoint(
    visualRect.x,
    visualRect.y
  )
  const [ux2, uy2] = scaleOneViewport.convertToPdfPoint(
    visualRect.x + visualRect.width,
    visualRect.y + visualRect.height
  )

  const [vx1, vy1] = viewport.convertToViewportPoint(ux1, uy1)
  const [vx2, vy2] = viewport.convertToViewportPoint(ux2, uy2)

  return {
    left: Math.min(vx1, vx2),
    top: Math.min(vy1, vy2),
    width: Math.abs(vx2 - vx1),
    height: Math.abs(vy2 - vy1)
  }
}

/**
 * 显示矩形（当前 viewport，相对 page div）→ 存储矩形。px 时保留 scale-1
 * 可视页像素；percent 时归一到可视页宽高的 0-100。
 */
export function captureViewportRectAsStored(
  rect: ViewportOverlayRect,
  viewport: PageViewport,
  scaleOneViewport: PageViewport,
  unit: OverlayRectUnit,
  visual: PageVisualSize
): StoredOverlayRect {
  const [ux1, uy1] = viewport.convertToPdfPoint(rect.left, rect.top)
  const [ux2, uy2] = viewport.convertToPdfPoint(
    rect.left + rect.width,
    rect.top + rect.height
  )

  const [sx1, sy1] = scaleOneViewport.convertToViewportPoint(ux1, uy1)
  const [sx2, sy2] = scaleOneViewport.convertToViewportPoint(ux2, uy2)

  const scaleOneRect = {
    x: Math.min(sx1, sx2),
    y: Math.min(sy1, sy2),
    width: Math.abs(sx2 - sx1),
    height: Math.abs(sy2 - sy1)
  }

  return unit === 'percent'
    ? {
        x: (scaleOneRect.x / visual.width) * 100,
        y: (scaleOneRect.y / visual.height) * 100,
        width: (scaleOneRect.width / visual.width) * 100,
        height: (scaleOneRect.height / visual.height) * 100
      }
    : scaleOneRect
}

export type ReaderEdgeCropFractions = {
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
  readonly left?: number
}

/**
 * edgeCrop（0..1，契约见 src/types/readerData.ts）→ page div 的 CSS clip-path。
 * 裁切只裁可视区域，不改变 page div 几何，叠加层坐标不受影响。
 */
export function edgeCropToClipPath(
  crop: ReaderEdgeCropFractions | undefined
): string | undefined {
  if (!crop) return undefined
  const { top = 0, right = 0, bottom = 0, left = 0 } = crop
  if (top <= 0 && right <= 0 && bottom <= 0 && left <= 0) return undefined
  return `inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%)`
}
