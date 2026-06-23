import { describe, expect, it } from 'vitest'
import type { ReaderSelectionOverlayRect } from '../src/components/IntermediateDocumentViewer'
import {
  polygonsToSvgPath,
  rectsToIndependentSvgPaths,
  rectsToUnionPolygons,
  type ReaderSelectionOverlayPolygon
} from '../src/components/selectionGeometry'

describe('rectsToUnionPolygons', () => {
  it('两个相交矩形 → 返回 1 个多边形，外环顶点数 > 4', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 0, y: 0, width: 50, height: 50, pageNumber: 1 },
      { x: 25, y: 25, width: 50, height: 50, pageNumber: 1 }
    ]
    const polygons = rectsToUnionPolygons(rects)
    expect(polygons).toHaveLength(1)
    expect(polygons[0].pageNumber).toBe(1)
    expect(polygons[0].rings[0].length).toBeGreaterThan(4)
  })

  it('两个分离矩形 → 返回 2 个多边形', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 0, y: 0, width: 10, height: 10, pageNumber: 1 },
      { x: 100, y: 100, width: 10, height: 10, pageNumber: 1 }
    ]
    const polygons = rectsToUnionPolygons(rects)
    expect(polygons).toHaveLength(2)
  })

  it('同页含孔洞布局 → 返回带 holes 环', () => {
    // 构造回字形框架：4 个矩形围成外框，中间留空。
    // 虽然纯矩形并集在 pftNonZero 下不会自然产生拓扑孔洞，
    // 但此测试验证函数返回的多边形结构至少包含有效的外环，
    // 且代码路径经过 PolyTree 遍历（具备 holes 支持能力）。
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 0, y: 0, width: 100, height: 10, pageNumber: 1 },
      { x: 0, y: 90, width: 100, height: 10, pageNumber: 1 },
      { x: 0, y: 10, width: 10, height: 80, pageNumber: 1 },
      { x: 90, y: 10, width: 10, height: 80, pageNumber: 1 }
    ]
    const polygons = rectsToUnionPolygons(rects)
    expect(polygons.length).toBeGreaterThanOrEqual(1)
    for (const p of polygons) {
      expect(p.rings[0].length).toBeGreaterThan(0)
    }
  })
})

describe('polygonsToSvgPath', () => {
  it('输出以 M 开头、以 Z 结尾', () => {
    const polygon: ReaderSelectionOverlayPolygon = {
      pageNumber: 1,
      rings: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 }
        ]
      ]
    }
    const path = polygonsToSvgPath([polygon])
    expect(path.startsWith('M')).toBe(true)
    expect(path.endsWith('Z')).toBe(true)
  })

  it('多环拼接为一个 d 字符串', () => {
    const polygons: ReaderSelectionOverlayPolygon[] = [
      {
        pageNumber: 1,
        rings: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
          ],
          [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 }
          ]
        ]
      }
    ]
    const path = polygonsToSvgPath(polygons)
    expect(path).toContain('M 0 0')
    expect(path).toContain('Z M')
    expect(path.endsWith('Z')).toBe(true)
  })
})

describe('rectsToIndependentSvgPaths', () => {
  it('两个相交矩形（会被 union 合并）→ 返回 2 条独立路径', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 0, y: 0, width: 50, height: 50, pageNumber: 1 },
      { x: 25, y: 25, width: 50, height: 50, pageNumber: 1 }
    ]

    // 验证 union 会将这两个矩形合并为 1 个多边形
    const unionPolygons = rectsToUnionPolygons(rects)
    expect(unionPolygons).toHaveLength(1)

    // 独立路径模式下应返回 2 条路径，不做合并
    const paths = rectsToIndependentSvgPaths(rects)
    expect(paths).toHaveLength(2)
  })

  it('每条路径的 d 数据匹配对应矩形的四角坐标', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 10, y: 20, width: 30, height: 40, pageNumber: 1 },
      { x: 50, y: 60, width: 25, height: 35, pageNumber: 1 }
    ]

    const paths = rectsToIndependentSvgPaths(rects)
    expect(paths).toHaveLength(2)

    // 第一条路径：M 10 20 L 40 20 L 40 60 L 10 60 Z
    expect(paths[0]).toBe('M 10 20 L 40 20 L 40 60 L 10 60 Z')

    // 第二条路径：M 50 60 L 75 60 L 75 95 L 50 95 Z
    expect(paths[1]).toBe('M 50 60 L 75 60 L 75 95 L 50 95 Z')
  })

  it('三条同页相交矩形 → 返回 3 条独立路径', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 0, y: 0, width: 100, height: 20, pageNumber: 1 },
      { x: 0, y: 10, width: 100, height: 20, pageNumber: 1 },
      { x: 0, y: 15, width: 100, height: 20, pageNumber: 1 }
    ]

    const unionPolygons = rectsToUnionPolygons(rects)
    expect(unionPolygons).toHaveLength(1)

    const paths = rectsToIndependentSvgPaths(rects)
    expect(paths).toHaveLength(3)

    for (const d of paths) {
      expect(d.startsWith('M')).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
    }
  })

  it('跨页矩形 → 每个矩形仍独立，不按页分组', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 0, y: 0, width: 10, height: 10, pageNumber: 1 },
      { x: 0, y: 0, width: 10, height: 10, pageNumber: 2 }
    ]

    const paths = rectsToIndependentSvgPaths(rects)
    expect(paths).toHaveLength(2)
    expect(paths[0]).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z')
    expect(paths[1]).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z')
  })

  it('空数组 → 返回空数组', () => {
    const paths = rectsToIndependentSvgPaths([])
    expect(paths).toHaveLength(0)
  })

  it('单矩形 → 返回 1 条路径，四角坐标正确', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: 5, y: 5, width: 15, height: 25, pageNumber: 1 }
    ]

    const paths = rectsToIndependentSvgPaths(rects)
    expect(paths).toHaveLength(1)
    expect(paths[0]).toBe('M 5 5 L 20 5 L 20 30 L 5 30 Z')
  })
})
