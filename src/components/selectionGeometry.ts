/**
 * ReaderSelectionOverlayPolygon 表示单页上的多边形覆盖区域。
 * - pageNumber: 页码
 * - rings: 多边形环数组。rings[0] 为外环，其余为孔洞。
 *   每个环是 {x, y} 点数组，首尾不重复（clipper 输出已闭合）。
 */
export type ReaderSelectionOverlayPolygon = {
  pageNumber: number
  rings: { x: number; y: number }[][]
}

import type { ReaderSelectionOverlayRect } from './IntermediateDocumentViewer'
import ClipperLib from '../vendor/clipper-lib'

/** 最小化 ClipperLib 类型声明，仅覆盖本文件使用的 API */
interface IntPoint {
  X: number
  Y: number
}
interface PolyNode {
  Contour(): IntPoint[]
  Childs(): PolyNode[]
}
type PolyPath = IntPoint[]
type PolyPaths = PolyPath[]
interface ClipperInstance {
  AddPaths(paths: PolyPaths, polyType: number, closed: boolean): void
  Execute(
    clipType: number,
    polytree: PolyTreeInstance,
    subjFillType: number,
    clipFillType: number
  ): boolean
}
interface PolyTreeInstance {
  Childs(): PolyNode[]
}
interface ClipperLibTyped {
  Paths: new () => PolyPaths
  Path: new () => PolyPath
  IntPoint: new (x: number, y: number) => IntPoint
  Clipper: new () => ClipperInstance
  PolyTree: new () => PolyTreeInstance
  PolyType: { ptSubject: number }
  ClipType: { ctUnion: number }
  PolyFillType: { pftNonZero: number }
}

const Clipper = ClipperLib as unknown as ClipperLibTyped

const CLIPPER_SCALE = 1e5

/**
 * 将矩形数组按页分组，并使用 ClipperLib 做并集运算，生成多边形覆盖区域。
 *
 * 仅合并同一页内几何相交的矩形；分离的矩形会生成独立的多边形。
 * 返回的多边形包含外环（rings[0]）以及可能的孔洞环（rings[1...]）。
 */
export function rectsToUnionPolygons(
  rects: ReaderSelectionOverlayRect[]
): ReaderSelectionOverlayPolygon[] {
  // 按 pageNumber 分组
  const pageMap = new Map<number, ReaderSelectionOverlayRect[]>()
  for (const rect of rects) {
    const list = pageMap.get(rect.pageNumber)
    if (list) {
      list.push(rect)
    } else {
      pageMap.set(rect.pageNumber, [rect])
    }
  }

  const result: ReaderSelectionOverlayPolygon[] = []

  for (const [pageNumber, pageRects] of pageMap) {
    if (pageRects.length === 0) continue

    // 构造 Clipper 路径（缩放为整数）
    const paths = new Clipper.Paths()
    for (const rect of pageRects) {
      const path = new Clipper.Path()
      path.push(
        new Clipper.IntPoint(
          Math.round(rect.x * CLIPPER_SCALE),
          Math.round(rect.y * CLIPPER_SCALE)
        )
      )
      path.push(
        new Clipper.IntPoint(
          Math.round((rect.x + rect.width) * CLIPPER_SCALE),
          Math.round(rect.y * CLIPPER_SCALE)
        )
      )
      path.push(
        new Clipper.IntPoint(
          Math.round((rect.x + rect.width) * CLIPPER_SCALE),
          Math.round((rect.y + rect.height) * CLIPPER_SCALE)
        )
      )
      path.push(
        new Clipper.IntPoint(
          Math.round(rect.x * CLIPPER_SCALE),
          Math.round((rect.y + rect.height) * CLIPPER_SCALE)
        )
      )
      paths.push(path)
    }

    // 使用 ClipperLib 做并集
    const clipper = new Clipper.Clipper()
    clipper.AddPaths(paths, Clipper.PolyType.ptSubject, true)

    const polytree = new Clipper.PolyTree()
    clipper.Execute(
      Clipper.ClipType.ctUnion,
      polytree,
      Clipper.PolyFillType.pftNonZero,
      Clipper.PolyFillType.pftNonZero
    )

    // 提取外环与孔洞
    function extractContour(node: PolyNode): { x: number; y: number }[] {
      const contour: { x: number; y: number }[] = []
      const c = node.Contour()
      for (let i = 0; i < c.length; i++) {
        const pt = c[i]
        contour.push({ x: pt.X / CLIPPER_SCALE, y: pt.Y / CLIPPER_SCALE })
      }
      return contour
    }

    // 递归遍历 PolyTree：当前节点的子多边形作为外环，其直接子节点为孔洞；
    // 孔洞的子节点是岛中岛，递归生成独立多边形。
    function traverse(node: PolyTreeInstance | PolyNode) {
      const childs = node.Childs()
      for (let i = 0; i < childs.length; i++) {
        const child = childs[i]
        const rings: { x: number; y: number }[][] = [extractContour(child)]

        const holeChilds = child.Childs()
        for (let j = 0; j < holeChilds.length; j++) {
          const hole = holeChilds[j]
          rings.push(extractContour(hole))
          // 岛中岛递归处理
          traverse(hole)
        }

        result.push({ pageNumber, rings })
      }
    }

    traverse(polytree)
  }

  return result
}

/**
 * 将多边形覆盖区域数组转换为单个 SVG path `d` 属性字符串。
 *
 * 每个环输出为 `M x y L x2 y2 ... Z`，多环之间直接拼接。
 * 坐标保留页内相对坐标（不做额外变换）。
 */
export function polygonsToSvgPath(
  polygons: ReaderSelectionOverlayPolygon[]
): string {
  const parts: string[] = []
  for (const polygon of polygons) {
    for (const ring of polygon.rings) {
      if (ring.length === 0) continue
      const commands: string[] = []
      commands.push(`M ${ring[0].x} ${ring[0].y}`)
      for (let i = 1; i < ring.length; i++) {
        commands.push(`L ${ring[i].x} ${ring[i].y}`)
      }
      commands.push('Z')
      parts.push(commands.join(' '))
    }
  }
  return parts.join(' ')
}
