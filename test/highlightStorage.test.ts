import { describe, expect, it } from 'vitest'

import {
  annotationStorageV5Key,
  parseAnnotationStorageV5,
  parseHighlights,
  readAnnotationStorageV5,
  serializeAnnotationStorageV5,
  serializeHighlights,
  writeAnnotationStorageV5,
  type AnnotationStorageV5,
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

  it('preserves a range with empty rectangles when parsing v4', () => {
    // Given: EPUB 或 Text 模式保存的 range 仅保留字符锚点。
    const textRange: ReaderSelectionRange = {
      ...linkedRangeA,
      rectsBySelectionId: {}
    }
    const raw = JSON.stringify({
      version: 4,
      ranges: [textRange],
      rects: [],
      paintings: {}
    })

    // When: demo 从 localStorage 恢复高亮。
    const parsed = parseHighlights(raw)

    // Then: 空矩形对象合法，字符锚点可在渲染时重新生成几何。
    expect(parsed.ranges).toEqual([textRange])
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

// V5 新权威容器：ranges / rects 字段语义与旧容器一致，paintings 保存画库的
// 完整 EditorDocument，存储层原样透传，不做字段裁剪。
const editorDocumentPage1 = {
  schemaVersion: 3,
  documentRevision: 7,
  objects: [
    {
      id: 'obj-pen-1',
      kind: 'freehand',
      createdAt: 1720000000000,
      brush: { color: '#ff8800', width: 3, pressureEnabled: true },
      transform: { a: 1, b: 0, c: 0, d: 1, e: 12.5, f: 40.25 },
      samples: [
        { x: 12.5, y: 40.25, pressure: 0.4, t: 0 },
        { x: 13.75, y: 41.5, pressure: 0.9, t: 16 }
      ]
    },
    {
      id: 'obj-text-1',
      kind: 'text',
      content: '迁移后的文字',
      style: { fontSize: 14, color: '#123456' },
      position: { x: 30.125, y: 80.5 },
      transform: { a: 0, b: 1, c: -1, d: 0, e: 30.125, f: 80.5 }
    },
    {
      id: 'obj-image-1',
      kind: 'image',
      assetId: 'asset-9',
      transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 },
      crop: { x: 0, y: 0, width: 100, height: 50 }
    }
  ]
}

const editorDocumentPage2 = {
  schemaVersion: 3,
  documentRevision: 2,
  objects: []
}

const v5Storage: AnnotationStorageV5 = {
  version: 5,
  ranges: [linkedRangeA, linkedRangeB],
  rects: [rectA],
  paintings: {
    'page-1': editorDocumentPage1,
    'page-2': editorDocumentPage2
  }
}

function createBackend(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    }
  }
}

describe('annotation storage v5', () => {
  it('builds the dedicated web key for a file', () => {
    expect(annotationStorageV5Key('book.pdf')).toBe(
      'hamster-reader-demo:annotations:v5:book.pdf'
    )
  })

  it('serializes the exact v5 envelope', () => {
    const serialized = serializeAnnotationStorageV5(
      v5Storage.ranges,
      v5Storage.rects,
      v5Storage.paintings
    )

    expect(JSON.parse(serialized)).toEqual({
      version: 5,
      ranges: v5Storage.ranges,
      rects: v5Storage.rects,
      paintings: v5Storage.paintings
    })
  })

  it('round-trips complete editor documents without dropping fields', () => {
    const serialized = serializeAnnotationStorageV5(
      v5Storage.ranges,
      v5Storage.rects,
      v5Storage.paintings
    )

    const result = parseAnnotationStorageV5(serialized)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // 深比较全部字段：笔刷、变换、samples、文字内容、图片资产与裁切都必须原样保留。
    expect(result.storage).toEqual(v5Storage)
  })

  it('keeps ranges and rects semantics identical to the legacy reader', () => {
    const legacyRaw = JSON.stringify({
      version: 4,
      ranges: [linkedRangeA, linkedRangeB],
      rects: [rectA, rectB],
      paintings: {}
    })
    const legacy = parseHighlights(legacyRaw)

    const result = parseAnnotationStorageV5(
      JSON.stringify({
        version: 5,
        ranges: [linkedRangeA, linkedRangeB],
        rects: [rectA, rectB],
        paintings: { 'page-1': editorDocumentPage1 }
      })
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.storage.ranges).toEqual(legacy.ranges)
    expect(result.storage.rects).toEqual(legacy.rects)
  })

  it('treats a missing, empty or blank key as missing, never as empty data', () => {
    expect(parseAnnotationStorageV5(null)).toEqual({ status: 'missing' })
    expect(parseAnnotationStorageV5('')).toEqual({ status: 'missing' })
    expect(parseAnnotationStorageV5('   ')).toEqual({ status: 'missing' })
  })

  it('treats an empty v5 container as valid so deleted annotations stay deleted', () => {
    const result = parseAnnotationStorageV5(
      JSON.stringify({ version: 5, ranges: [], rects: [], paintings: {} })
    )

    expect(result).toEqual({
      status: 'ok',
      storage: { version: 5, ranges: [], rects: [], paintings: {} }
    })
  })

  it('reports corrupt json instead of falling back to empty data', () => {
    expect(parseAnnotationStorageV5('{"version":5,')).toEqual({
      status: 'invalid',
      reason: 'corrupt-json'
    })
  })

  it('reports an unsupported version instead of falling back to empty data', () => {
    expect(
      parseAnnotationStorageV5(
        JSON.stringify({ version: 6, ranges: [], rects: [], paintings: {} })
      )
    ).toEqual({ status: 'invalid', reason: 'unsupported-version' })

    // 旧 v4 形状出现在新键里同样属于不受支持的版本，不能当成缺失去迁移覆盖。
    expect(
      parseAnnotationStorageV5(
        JSON.stringify({ version: 4, ranges: [], rects: [], paintings: {} })
      )
    ).toEqual({ status: 'invalid', reason: 'unsupported-version' })
  })

  it('rejects malformed entries instead of silently dropping them', () => {
    const base = { version: 5, ranges: [linkedRangeA], rects: [rectA] }
    const cases: unknown[] = [
      { ...base, paintings: { 'page-1': { noSchemaVersion: true } } },
      { ...base, paintings: { 'page-1': 'corrupt' } },
      { ...base, paintings: { 'page-1': null } },
      { ...base, paintings: { page1: editorDocumentPage1 } },
      { ...base, paintings: [] },
      {
        ...base,
        paintings: { 'page-1': editorDocumentPage1 },
        rects: [{ id: 1 }]
      },
      {
        ...base,
        paintings: { 'page-1': editorDocumentPage1 },
        ranges: [
          { ...linkedRangeA, start: { selectionId: 'internal-1', offset: 0 } }
        ]
      },
      { ...base, paintings: {}, ranges: 'nope' },
      { version: 5, ranges: [], rects: [] }
    ]

    for (const value of cases) {
      expect(parseAnnotationStorageV5(JSON.stringify(value))).toEqual({
        status: 'invalid',
        reason: 'invalid-shape'
      })
    }
  })

  it('refuses to overwrite corrupt new data without an explicit recovery', () => {
    const corrupt = '{"version":5,"ranges":['
    const backend = createBackend({ 'annotations:v5': corrupt })

    const result = writeAnnotationStorageV5(
      backend,
      'annotations:v5',
      v5Storage
    )

    expect(result).toEqual({ status: 'refused', reason: 'corrupt-json' })
    expect(backend.store.get('annotations:v5')).toBe(corrupt)
  })

  it('refuses to overwrite an unsupported version until recovery is confirmed', () => {
    const future = JSON.stringify({ version: 9, ranges: [], rects: [] })
    const backend = createBackend({ 'annotations:v5': future })

    expect(readAnnotationStorageV5(backend, 'annotations:v5')).toEqual({
      status: 'invalid',
      reason: 'unsupported-version'
    })

    expect(
      writeAnnotationStorageV5(backend, 'annotations:v5', v5Storage).status
    ).toBe('refused')
    expect(backend.store.get('annotations:v5')).toBe(future)

    const recovered = writeAnnotationStorageV5(
      backend,
      'annotations:v5',
      v5Storage,
      { overwriteInvalid: true }
    )
    expect(recovered).toEqual({ status: 'saved' })
    expect(readAnnotationStorageV5(backend, 'annotations:v5')).toEqual({
      status: 'ok',
      storage: v5Storage
    })
  })

  it('reports a storage failure instead of pretending the write succeeded', () => {
    const backend = createBackend({
      'annotations:v5': serializeAnnotationStorageV5([], [], {})
    })
    const quotaError = new Error('QuotaExceededError')
    backend.setItem = () => {
      throw quotaError
    }

    const result = writeAnnotationStorageV5(
      backend,
      'annotations:v5',
      v5Storage
    )

    expect(result).toEqual({ status: 'failed', error: quotaError })
    // 失败时旧值必须原样保留，重开后仍是上一个完整状态。
    expect(backend.store.get('annotations:v5')).toBe(
      serializeAnnotationStorageV5([], [], {})
    )
  })
})
