import type { IntermediateImage, IntermediateText } from '@hamster-note/types'

/**
 * intermediate-document / direct / html-parser 三种渲染模式共享的
 * 纯几何与样式辅助函数。
 *
 * 这些函数从 `IntermediateDocumentViewer.tsx` 中抽取出来，供新的
 * `IntermediateDocumentPageContent` 渲染器以及原有渲染器复用，避免在
 * 巨大的 viewer 文件中继续膨胀。所有函数均为纯函数，无闭包依赖，
 * 由现有 direct / html-parser 测试覆盖验证行为一致性。
 */

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
    polygon: [number, number][]
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
export const getTextBoundingBox = (polygon: [number, number][]) => {
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
  polygon: [number, number][] | undefined
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
 * 计算文本 span 的额外 CSS transform（rotate / skewX）。
 * 当 bbox 已包含旋转角时可通过 skipRotate 跳过重复旋转。
 */
export const getTextTransform = (
  text: RenderableIntermediateText,
  skipRotate?: boolean
) => {
  const transforms: string[] = []

  if (!skipRotate && text.rotate) {
    transforms.push(`rotate(${text.rotate}deg)`)
  }

  if (text.skew) {
    transforms.push(`skewX(${text.skew}deg)`)
  }

  return transforms.length > 0 ? transforms.join(' ') : undefined
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

/**
 * 根据文本几何与字体属性构建文本 span 的内联样式。
 */
export const buildTextSpanStyle = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>
) => {
  const textTransform = getTextTransform(text, !!bbox.rotation)
  const transform = [
    bbox.rotation ? `rotate(${bbox.rotation}deg)` : '',
    textTransform
  ]
    .filter(Boolean)
    .join(' ')

  return {
    position: 'absolute' as const,
    left: Number.isFinite(bbox.x) ? `${bbox.x}px` : '0px',
    top: Number.isFinite(bbox.y) ? `${bbox.y}px` : '0px',
    width:
      Number.isFinite(bbox.width) && bbox.width > 0
        ? `${bbox.width}px`
        : undefined,
    height:
      Number.isFinite(bbox.height) && bbox.height > 0
        ? `${bbox.height}px`
        : undefined,
    fontSize:
      Number.isFinite(text.fontSize) && text.fontSize > 0
        ? `${text.fontSize}px`
        : undefined,
    fontFamily: text.fontFamily || undefined,
    fontWeight: text.fontWeight || undefined,
    fontStyle: text.italic ? 'italic' : undefined,
    color: text.color || undefined,
    lineHeight:
      Number.isFinite(text.lineHeight) && text.lineHeight > 0
        ? `${text.lineHeight}px`
        : undefined,
    transform,
    transformOrigin: 'left top' as const,
    whiteSpace: 'pre' as const
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
  const geometry = getPolygonTextGeometry(
    image.polygon as unknown as [number, number][]
  )

  if (geometry) {
    return geometry
  }

  // polygon 不规范时回退到轴对齐包围盒
  const polygon = image.polygon as unknown as [number, number][]
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
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = {
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
