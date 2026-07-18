import { describe, expect, it } from 'vitest'

import {
  parseHighlights,
  serializeHighlights,
  type ReaderSelectionRange,
  type ReaderSelectionRectangle
} from '../demo/highlightStorage'

// 使用 DrawingValue 形状：含 strokes 数组，模拟 painting 持久化场景
// 这里不 import 真 DrawingValue 类型（仅作测试值），用满足 sanitizeDrawingValue 宽松校验的结构即可
const paintingPage1 = {
  strokes: [
    {
      id: 'stroke-1',
      tool: 'pen' as const,
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 }
      ],
      color: '#000000',
      width: 2
    }
  ]
}
const paintingPage2 = {
  strokes: [
    {
      id: 'stroke-2',
      tool: 'line' as const,
      points: [{ x: 10, y: 20 }],
      color: '#ff0000',
      width: 5
    }
  ]
}

const linkedRangeA: ReaderSelectionRange = {
  id: 'range-a',
  text: 'hello',
  start: { selectionId: 'page-1', offset: 2 },
  end: { selectionId: 'page-1', offset: 7 },
  createdAt: 1000,
  overlayRectType: 'percent',
  rectsBySelectionId: {
    'page-1': [{ x: 10, y: 20, width: 30, height: 40 }]
  }
}

const linkedRangeB: ReaderSelectionRange = {
  id: 'range-b',
  text: 'world',
  start: { selectionId: 'page-2', offset: 0 },
  end: { selectionId: 'page-3', offset: 5 },
  createdAt: 2000,
  rectsBySelectionId: {
    'page-2': [{ x: 1, y: 2, width: 3, height: 4 }],
    'page-3': [{ x: 5, y: 6, width: 7, height: 8 }]
  },
  markerStyle: { backgroundColor: 'rgba(255, 193, 7, 0.35)' }
}

const rectA: ReaderSelectionRectangle = {
  id: 'rect-a',
  createdAt: 3000,
  overlayRectType: 'percent',
  start: { x: 10, y: 20 },
  end: { x: 40, y: 60 },
  rect: { x: 10, y: 20, width: 30, height: 40 }
}

const rectB: ReaderSelectionRectangle = {
  id: 'rect-b',
  createdAt: 4000,
  overlayRectType: 'percent',
  start: { x: 1, y: 2 },
  end: { x: 4, y: 6 },
  rect: { x: 1, y: 2, width: 3, height: 4 }
}

describe('highlight storage helpers', () => {
  it('parses all valid linked ranges and rects when storage is v3', () => {
    const raw = JSON.stringify({
      version: 3,
      ranges: [linkedRangeA, linkedRangeB],
      rects: [rectA, rectB]
    })

    const parsed = parseHighlights(raw)

    // v3 输入无 paintings 字段，向后兼容时默认为空对象
    expect(parsed).toEqual({
      ranges: [linkedRangeA, linkedRangeB],
      rects: [rectA, rectB],
      paintings: {}
    })
  })

  it('serializes ranges and rects with the exact v4 envelope', () => {
    const ranges = [linkedRangeA, linkedRangeB]
    const rects = [rectA, rectB]
    const paintings = {}

    // serializeHighlights 现在签名 3 参，第三参 paintings 默认 {} 即可
    const serialized = serializeHighlights(ranges, rects, paintings)

    expect(JSON.parse(serialized)).toEqual({
      version: 4,
      ranges,
      rects,
      paintings
    })
  })

  it('parses v2 envelopes and treats rects as missing', () => {
    const raw = JSON.stringify({
      version: 2,
      ranges: [linkedRangeA]
    })

    const parsed = parseHighlights(raw)

    // v2 向后兼容：rects 默认 []，paintings 默认 {}
    expect(parsed).toEqual({ ranges: [linkedRangeA], rects: [], paintings: {} })
  })

  it('returns empty arrays when storage is missing or empty', () => {
    const rawValues = [null, '', '   ']

    const parsedValues = rawValues.map((raw) => parseHighlights(raw))

    expect(parsedValues).toEqual([
      { ranges: [], rects: [], paintings: {} },
      { ranges: [], rects: [], paintings: {} },
      { ranges: [], rects: [], paintings: {} }
    ])
  })

  it('returns empty arrays when storage JSON is corrupt', () => {
    const raw = '{"version":3,"ranges":['

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({ ranges: [], rects: [], paintings: {} })
  })

  it('returns empty arrays when storage has the wrong shape', () => {
    const wrongShapes = [
      'null',
      '42',
      JSON.stringify({ version: 3 }),
      JSON.stringify({ version: 3, ranges: linkedRangeA }),
      JSON.stringify({ version: 3, ranges: [linkedRangeA], rects: rectA })
    ]

    const parsedValues = wrongShapes.map((raw) => parseHighlights(raw))

    expect(parsedValues).toEqual([
      { ranges: [], rects: [], paintings: {} },
      { ranges: [], rects: [], paintings: {} },
      { ranges: [], rects: [], paintings: {} },
      { ranges: [], rects: [], paintings: {} },
      { ranges: [], rects: [], paintings: {} }
    ])
  })

  it('keeps valid linked ranges and drops invalid entries in mixed v3 data', () => {
    const raw = JSON.stringify({
      version: 3,
      ranges: [
        linkedRangeA,
        { ...linkedRangeA, id: 123 },
        { ...linkedRangeA, start: { selectionId: 'page-0', offset: 2 } },
        { ...linkedRangeA, rectsBySelectionId: { 'page-1': [{ x: 1 }] } },
        null,
        linkedRangeB
      ],
      rects: [
        rectA,
        { ...rectA, id: 456 },
        { ...rectA, rect: { x: 1 } },
        null,
        rectB
      ]
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({
      ranges: [linkedRangeA, linkedRangeB],
      rects: [rectA, rectB],
      paintings: {}
    })
  })

  it('returns empty arrays for unversioned old bare arrays and legacy objects', () => {
    const oldBareArray = JSON.stringify([
      {
        id: 'old-range',
        text: 'legacy',
        start: 0,
        end: 6,
        createdAt: 100,
        rects: [{ x: 1, y: 2, width: 3, height: 4 }]
      }
    ])
    const legacyObject = JSON.stringify({
      id: 'old-range',
      text: 'legacy',
      start: 0,
      end: 6,
      createdAt: 100,
      rects: [{ x: 1, y: 2, width: 3, height: 4 }]
    })

    const parsedValues = [
      parseHighlights(oldBareArray),
      parseHighlights(legacyObject)
    ]

    expect(parsedValues).toEqual([
      { ranges: [], rects: [], paintings: {} },
      { ranges: [], rects: [], paintings: {} }
    ])
  })

  it('rejects persisted ranges containing runtime-scoped selection ids', () => {
    const runtimeEndpointRange = {
      ...linkedRangeA,
      start: { selectionId: 'reader-1:page-1', offset: 2 }
    }
    const runtimeRectKeyRange = {
      ...linkedRangeB,
      rectsBySelectionId: {
        'reader-1:page-2': [{ x: 1, y: 2, width: 3, height: 4 }]
      }
    }
    const raw = JSON.stringify({
      version: 3,
      ranges: [runtimeEndpointRange, runtimeRectKeyRange, linkedRangeA],
      rects: []
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({ ranges: [linkedRangeA], rects: [], paintings: {} })
  })

  it('parses v4 envelopes and reads paintings alongside ranges and rects', () => {
    // v4 是持久化 Drawing 数据后的新格式：paintings 字段携带每页的 DrawingValue
    const paintings = {
      'page-1': paintingPage1,
      'page-2': paintingPage2
    }
    const raw = JSON.stringify({
      version: 4,
      ranges: [linkedRangeA],
      rects: [rectA],
      paintings
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({
      ranges: [linkedRangeA],
      rects: [rectA],
      paintings
    })
  })

  it('drops invalid paintings entries but keeps valid ones when storage is v4', () => {
    // parsePaintings 只过滤明显损坏条目（非 plain object value），
    // 深度结构校验交给 library 的 sanitizeDrawingValue
    const raw = JSON.stringify({
      version: 4,
      ranges: [],
      rects: [],
      paintings: {
        'page-1': paintingPage1, // 有效 plain object -> 保留
        'page-2': null, // 非对象 -> 丢弃
        'page-3': 42, // 非对象 -> 丢弃
        'page-4': 'not-an-object', // 非对象 -> 丢弃
        'page-5': paintingPage2 // 有效 -> 保留
      }
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({
      ranges: [],
      rects: [],
      paintings: {
        'page-1': paintingPage1,
        'page-5': paintingPage2
      }
    })
  })

  it('serializes ranges, rects and paintings with the v4 envelope', () => {
    // serializeHighlights 接收 paintings 第三参，输出 v4 envelope
    const ranges = [linkedRangeA]
    const rects = [rectA]
    const paintings = {
      'page-1': paintingPage1
    }

    const serialized = serializeHighlights(ranges, rects, paintings)

    expect(JSON.parse(serialized)).toEqual({
      version: 4,
      ranges,
      rects,
      paintings
    })
  })

  it('round-trips paintings through serializeHighlights then parseHighlights', () => {
    // 端到端：序列化再解析，paintings 字段应保持一致
    const paintings = {
      'page-1': paintingPage1,
      'page-2': paintingPage2
    }
    const ranges = [linkedRangeA, linkedRangeB]
    const rects = [rectA, rectB]

    const serialized = serializeHighlights(ranges, rects, paintings)
    const parsed = parseHighlights(serialized)

    expect(parsed).toEqual({ ranges, rects, paintings })
  })
})
