import type { IntermediateImage, IntermediateText } from '@hamster-note/types'
import type { CSSProperties } from 'react'

/**
 * intermediate-document 渲染器使用的
 * 纯几何与样式辅助函数。
 *
 * 这些函数从 `IntermediateDocumentViewer.tsx` 中抽取出来，供新的
 * `IntermediateDocumentPageContent` 渲染器复用，避免在
 * 巨大的 viewer 文件中继续膨胀。所有函数均为纯函数，无闭包依赖，
 * 由现有 intermediate-document 测试覆盖验证行为一致性。
 */

/**
 * 几何计算用的单个点（[x, y]）。声明为 readonly tuple，既兼容运行期
 * 解析器/OCR 提供的可变 `[number, number][]`，也兼容 `@hamster-note/types`
 * 中 `IntermediateImage.polygon` / `IntermediateText.polygon` 的只读四点
 * 多边形（`Polygon`），从而无需 `as unknown` 逃逸即可统一处理。
 */
export type GeometryPoint = readonly [number, number]

/**
 * 几何计算用的多边形：任意数量的 {@link GeometryPoint} 只读数组。
 * `IntermediateImage.polygon`（4 点 `Polygon`）与运行期文本的
 * `[number, number][]` 均可直接赋值给该类型。
 */
export type GeometryPolygon = readonly GeometryPoint[]

/**
 * 渲染时可用的 IntermediateText —— 序列化字段之外，运行期可能附带
 * 解析器/OCR 提供的 x/y/width/height/polygon/rotate/skew 几何信息。
 */
export type RenderableIntermediateText = IntermediateText &
  Partial<{
    x: number
    y: number
    width: number
    height: number
    polygon: GeometryPolygon
    rotate: number
    skew: number
  }>

/** 多边形几何计算结果 */
export type PolygonGeometry = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/**
 * 合并多边形顶点为一个轴对齐包围盒（适用于少于 4 个有效顶点或非标准四边形）。
 */
export const getTextBoundingBox = (polygon: GeometryPolygon) => {
  if (!polygon || polygon.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const xs = polygon.map((point) => point?.[0]).filter(Number.isFinite)
  const ys = polygon.map((point) => point?.[1]).filter(Number.isFinite)
  if (xs.length === 0 || ys.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 从标准四边形多边形（4 个顶点）推导精确的位置、尺寸与旋转角。
 * 返回 null 表示多边形不规范，调用方应回退到轴对齐包围盒。
 */
export const getPolygonTextGeometry = (
  polygon: GeometryPolygon | undefined
): PolygonGeometry | null => {
  if (
    !polygon ||
    polygon.length !== 4 ||
    !polygon.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number' &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1])
    )
  ) {
    return null
  }

  const p0 = polygon[0]
  const p1 = polygon[1]
  const p2 = polygon[2]

  const width = Math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2)
  const height = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)

  if (width === 0 || height === 0) {
    return null
  }

  const rotation = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI

  return {
    x: p0[0],
    y: p0[1],
    width,
    height,
    rotation
  }
}

/**
 * 计算单个文本 span 的包围盒（优先使用四边形精确几何，回退到轴对齐包围盒，
 * 最后回退到 x/y/width/height 字段）。
 */
export const getTextBbox = (text: RenderableIntermediateText) => {
  const polygonGeometry = getPolygonTextGeometry(text.polygon)
  const usePolygonGeometry = polygonGeometry !== null

  if (usePolygonGeometry) {
    return {
      x: polygonGeometry.x,
      y: polygonGeometry.y,
      width: polygonGeometry.width,
      height: polygonGeometry.height,
      rotation: polygonGeometry.rotation
    }
  }

  if (text.polygon) {
    return {
      ...getTextBoundingBox(text.polygon),
      rotation: 0
    }
  }

  return {
    x: text.x ?? 0,
    y: text.y ?? 0,
    width: text.width ?? 0,
    height: text.height ?? 0,
    rotation: 0
  }
}

// ---------------------------------------------------------------------------
// IntermediateImage 几何与样式（intermediate-document 模式新增）
// ---------------------------------------------------------------------------

/**
 * 从 IntermediateImage 的四边形 polygon 计算位置、尺寸与旋转角。
 * 复用与文本相同的四边形几何逻辑；polygon 缺失或非法时回退到 0 尺寸。
 */
export const getImageGeometry = (image: IntermediateImage): PolygonGeometry => {
  const geometry = getPolygonTextGeometry(image.polygon)

  if (geometry) {
    return geometry
  }

  // polygon 不规范时回退到轴对齐包围盒
  const polygon = image.polygon
  if (polygon && polygon.length >= 4) {
    return { ...getTextBoundingBox(polygon), rotation: 0 }
  }

  return { x: 0, y: 0, width: 0, height: 0, rotation: 0 }
}

/**
 * 根据 IntermediateImage 的几何与透明度/裁剪属性构建 `<img>` 的内联样式。
 *
 * - 位置与尺寸由 polygon 几何决定（绝对定位在页面内容层内）。
 * - opacity 直接透传。
 * - clip（如果存在）转换为 CSS `clip-path: inset(...)`，以图片自身盒子为参考。
 */
export const buildImageStyle = (
  image: IntermediateImage,
  geometry: PolygonGeometry
): CSSProperties => {
  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: `${geometry.x}px`,
    top: `${geometry.y}px`,
    width: geometry.width > 0 ? `${geometry.width}px` : undefined,
    height: geometry.height > 0 ? `${geometry.height}px` : undefined,
    opacity:
      typeof image.opacity === 'number' && Number.isFinite(image.opacity)
        ? image.opacity
        : 1,
    transformOrigin: 'left top',
    pointerEvents: 'none'
  }

  if (geometry.rotation !== 0) {
    baseStyle.transform = `rotate(${geometry.rotation}deg)`
  }

  if (image.clip) {
    const clip = image.clip
    // clip 是相对于图片自身左上角的裁剪矩形，转换为 inset():
    // inset(top right bottom left)
    const right = geometry.width - (clip.x + clip.width)
    const bottom = geometry.height - (clip.y + clip.height)
    baseStyle.clipPath = `inset(${clip.y}px ${right}px ${bottom}px ${clip.x}px)`
  }

  return baseStyle
}
