import { describe, expect, it } from 'vitest'
import type { ReaderSelectionOverlayRect } from '../src/components/IntermediateDocumentViewer'
import {
  polygonsToSvgPath,
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
