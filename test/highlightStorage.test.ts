import { describe, expect, it } from 'vitest'

import {
  annotationStorageV5Key,
  parseAnnotationStorageV5,
  parseHighlights,
  readAnnotationStorageV5,
  serializeAnnotationStorageV5,
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

  it('round-trips v4 paintings through parse and a v4-shaped fixture', () => {
    const paintings = {
      'page-1': paintingPage1,
      'page-2': paintingPage2
    }
    const ranges = [linkedRangeA, linkedRangeB]
    const rects = [rectA, rectB]

    // 写入端已删除：用固定 v4 夹具证明读入仍然逐字段保真。
    const parsed = parseHighlights(
      JSON.stringify({ version: 4, ranges, rects, paintings })
    )

    expect(parsed).toEqual({ ranges, rects, paintings })
  })
})

// V5 新权威容器：ranges / rects 字段语义与旧容器一致，paintings 保存画库的
// 完整 EditorDocument，存储层原样透传，不做字段裁剪。
//
// 夹具按 @hamster-note/painting@0.8.0 的 readLayeredDocument schema 3 契约构造
// （objectId / brushSnapshot / samples / src+localBounds 等），已用该发布包实测
// 返回 ok；对应三个损坏样本返回 invalid-document。
const editorDocumentPage1 = {
  schemaVersion: 3,
  documentRevision: 7,
  objects: [
    {
      kind: 'freehand',
      objectId: 'obj-pen-1',
      objectRevision: 3,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 12.5, ty: 40.25 },
      transformRevision: 1,
      commitId: 'commit-1',
      samples: [
        {
          sequence: 0,
          x: 0,
          y: 0,
          pressure: 0.4,
          time: 0,
          phase: 'down',
          source: 'pen'
        },
        {
          sequence: 1,
          x: 1.25,
          y: 1.5,
          pressure: 0.9,
          time: 16,
          phase: 'move',
          source: 'pen'
        },
        { sequence: 2, x: 2.5, y: 3, time: 32, phase: 'up', source: 'pen' }
      ],
      brushSnapshot: {
        color: '#ff8800',
        nominalSize: 3,
        opacity: 0.8,
        pressureMode: 'auto',
        presetRevision: 2
      },
      resolvedPressureMode: 'real',
      samplesRevision: 1,
      brushRevision: 1
    },
    {
      kind: 'shape',
      objectId: 'obj-shape-1',
      objectRevision: 1,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      transformRevision: 0,
      shapeType: 'rect',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ],
      style: {
        color: '#123456',
        width: 2,
        opacity: 0.5,
        dash: [4, 2],
        fill: '#abcdef',
        fillOpacity: 0.25,
        dashOffset: 1
      }
    },
    {
      kind: 'image',
      objectId: 'obj-image-1',
      objectRevision: 0,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 6 },
      transformRevision: 0,
      src: 'data:image/png;base64,AAAA',
      resourceId: 'res-1',
      preserveAspectRatio: 'xMidYMid meet',
      localBounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 }
    },
    {
      kind: 'text',
      objectId: 'obj-text-1',
      objectRevision: 0,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 30.125, ty: 80.5 },
      transformRevision: 0,
      content: '迁移后的文字',
      fontSize: 14,
      lineHeight: 20,
      color: '#123456',
      localBounds: { minX: 0, minY: 0, maxX: 80, maxY: 20 }
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

const SCHEMA3_OBJECT_KINDS: Record<string, true> = {
  freehand: true,
  shape: true,
  image: true,
  text: true
}

// 测试用校验器：等价于 painting 0.8.0 `readLayeredDocument(...).ok` 对本文件夹具
// 所涉字段的判定（schemaVersion 必须为 3、documentRevision 非负安全整数、
// objects 为数组且每个对象有非空 objectId 与已知 kind）。生产路径由 2.3/2.4 注入
// 正式发布包 reader 的适配函数；存储层自身不依赖画库。
function validateSchema3Document(document: unknown): boolean {
  if (
    typeof document !== 'object' ||
    document === null ||
    Array.isArray(document)
  ) {
    return false
  }
  const record = document as Record<string, unknown>
  const revision = record['documentRevision']
  if (record['schemaVersion'] !== 3) return false
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    return false
  }
  const objects = record['objects']
  if (!Array.isArray(objects)) return false

  return objects.every((object) => {
    if (
      typeof object !== 'object' ||
      object === null ||
      Array.isArray(object)
    ) {
      return false
    }
    const entry = object as Record<string, unknown>
    return (
      typeof entry['objectId'] === 'string' &&
      entry['objectId'].length > 0 &&
      SCHEMA3_OBJECT_KINDS[entry['kind'] as string] === true
    )
  })
}

const v5Options = { validateDocument: validateSchema3Document }

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

    const result = parseAnnotationStorageV5(serialized, v5Options)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // 深比较全部字段：笔刷、变换、samples、形状样式、文字内容、图片资产与裁切都必须原样保留。
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
      }),
      v5Options
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.storage.ranges).toEqual(legacy.ranges)
    expect(result.storage.rects).toEqual(legacy.rects)
  })

  it('treats only an absent key as missing and blank values as corrupt', () => {
    expect(parseAnnotationStorageV5(null)).toEqual({ status: 'missing' })

    // 空白值是已存在但损坏的记录，不能当成缺失，否则自动迁移会覆盖并复活旧标注。
    expect(parseAnnotationStorageV5('')).toEqual({
      status: 'invalid',
      reason: 'corrupt-json'
    })
    expect(parseAnnotationStorageV5('   ')).toEqual({
      status: 'invalid',
      reason: 'corrupt-json'
    })
  })

  it('refuses to write over a blank value instead of re-migrating it', () => {
    const backend = createBackend({ 'annotations:v5': '   ' })

    expect(
      writeAnnotationStorageV5(backend, 'annotations:v5', v5Storage, v5Options)
    ).toEqual({ status: 'refused', reason: 'corrupt-json' })
    expect(backend.store.get('annotations:v5')).toBe('   ')
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

  it('rejects malformed container entries instead of silently dropping them', () => {
    const base = { version: 5, ranges: [linkedRangeA], rects: [rectA] }
    const cases: unknown[] = [
      { ...base, paintings: { 'page-1': 'corrupt' } },
      { ...base, paintings: { 'page-1': null } },
      { ...base, paintings: { page1: editorDocumentPage1 } },
      { ...base, paintings: [] },
      { ...base, paintings: {}, rects: [{ id: 1 }] },
      {
        ...base,
        paintings: {},
        ranges: [
          { ...linkedRangeA, start: { selectionId: 'internal-1', offset: 0 } }
        ]
      },
      { ...base, paintings: {}, ranges: 'nope' },
      { version: 5, ranges: [], rects: [] },
      { version: 5, ranges: [], rects: [], paintings: { 'page-1': [] } }
    ]

    for (const value of cases) {
      expect(parseAnnotationStorageV5(JSON.stringify(value))).toEqual({
        status: 'invalid',
        reason: 'invalid-shape'
      })
    }
  })

  it('requires the library validator before accepting any stored document', () => {
    const raw = serializeAnnotationStorageV5(
      v5Storage.ranges,
      v5Storage.rects,
      { 'page-1': { schemaVersion: 3 } }
    )

    // 没有校验器时不能把「看起来像文档」的对象当成有效权威数据。
    expect(parseAnnotationStorageV5(raw)).toEqual({
      status: 'invalid',
      reason: 'unvalidated-document'
    })

    // 空 paintings 是有效空集合，不需要校验器。
    expect(
      parseAnnotationStorageV5(serializeAnnotationStorageV5([], [], {}))
    ).toEqual({
      status: 'ok',
      storage: { version: 5, ranges: [], rects: [], paintings: {} }
    })
  })

  it('rejects documents the library refuses and blocks the default write', () => {
    const brokenDocuments = [
      { schemaVersion: 3 },
      { schemaVersion: 3, documentRevision: 0, objects: 'broken' },
      { schemaVersion: 99, documentRevision: 0, objects: [{ objectId: 'x' }] }
    ]

    for (const document of brokenDocuments) {
      const stored = serializeAnnotationStorageV5([], [], {
        'page-1': document
      })

      expect(parseAnnotationStorageV5(stored, v5Options)).toEqual({
        status: 'invalid',
        reason: 'invalid-document'
      })

      const backend = createBackend({ 'annotations:v5': stored })
      expect(
        writeAnnotationStorageV5(
          backend,
          'annotations:v5',
          v5Storage,
          v5Options
        )
      ).toEqual({ status: 'refused', reason: 'invalid-document' })
      // 拒绝覆盖时原件逐字节不变，旧 blob 仍是唯一可能的恢复来源。
      expect(backend.store.get('annotations:v5')).toBe(stored)
    }
  })

  it('treats a throwing validator as a rejection, not a success', () => {
    const raw = serializeAnnotationStorageV5([], [], {
      'page-1': editorDocumentPage1
    })

    expect(
      parseAnnotationStorageV5(raw, {
        validateDocument: () => {
          throw new Error('validator exploded')
        }
      })
    ).toEqual({ status: 'invalid', reason: 'invalid-document' })
  })

  it('never writes input documents that fail validation', () => {
    const backend = createBackend()

    const result = writeAnnotationStorageV5(
      backend,
      'annotations:v5',
      {
        version: 5,
        ranges: [],
        rects: [],
        paintings: { 'page-1': { schemaVersion: 3 } }
      },
      v5Options
    )

    expect(result).toEqual({
      status: 'invalid-input',
      reason: 'invalid-document'
    })
    expect(backend.store.has('annotations:v5')).toBe(false)
  })

  it('rejects invalid page keys before touching an existing archive', () => {
    // 复现：已有合法 page-1 存档时写入 page-0，旧实现返回 saved 并覆盖，
    // 随后自己读回 invalid/invalid-shape。
    const stored = serializeAnnotationStorageV5(
      v5Storage.ranges,
      v5Storage.rects,
      v5Storage.paintings
    )

    for (const pageKey of ['page-0', 'page-abc', 'page-', 'page-01']) {
      const backend = createBackend({ 'annotations:v5': stored })

      const result = writeAnnotationStorageV5(
        backend,
        'annotations:v5',
        {
          version: 5,
          ranges: [],
          rects: [],
          paintings: { [pageKey]: editorDocumentPage1 }
        },
        v5Options
      )

      expect(result).toEqual({
        status: 'invalid-input',
        reason: 'invalid-shape'
      })
      expect(backend.store.get('annotations:v5')).toBe(stored)
      expect(
        readAnnotationStorageV5(backend, 'annotations:v5', v5Options)
      ).toEqual({ status: 'ok', storage: v5Storage })
    }
  })

  it('validates ranges and rects of the container before writing', () => {
    const stored = serializeAnnotationStorageV5([], [], {})
    const backend = createBackend({ 'annotations:v5': stored })

    const result = writeAnnotationStorageV5(
      backend,
      'annotations:v5',
      {
        version: 5,
        ranges: [
          { ...linkedRangeA, start: { selectionId: 'internal-1', offset: 0 } }
        ],
        rects: [],
        paintings: {}
      },
      v5Options
    )

    expect(result).toEqual({ status: 'invalid-input', reason: 'invalid-shape' })
    expect(backend.store.get('annotations:v5')).toBe(stored)
  })

  it('only reports saved when the written container reads back identically', () => {
    const backend = createBackend()

    expect(
      writeAnnotationStorageV5(backend, 'annotations:v5', v5Storage, v5Options)
    ).toEqual({ status: 'saved' })

    // 落盘字节与序列化结果一致，且读取闭环 ok + 深比较相等。
    expect(backend.store.get('annotations:v5')).toBe(
      serializeAnnotationStorageV5(
        v5Storage.ranges,
        v5Storage.rects,
        v5Storage.paintings
      )
    )
    expect(
      readAnnotationStorageV5(backend, 'annotations:v5', v5Options)
    ).toEqual({ status: 'ok', storage: v5Storage })
  })

  it('refuses to overwrite corrupt new data without an explicit recovery', () => {
    const corrupt = '{"version":5,"ranges":['
    const backend = createBackend({ 'annotations:v5': corrupt })

    const result = writeAnnotationStorageV5(
      backend,
      'annotations:v5',
      v5Storage,
      v5Options
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
      writeAnnotationStorageV5(backend, 'annotations:v5', v5Storage, v5Options)
        .status
    ).toBe('refused')
    expect(backend.store.get('annotations:v5')).toBe(future)

    const recovered = writeAnnotationStorageV5(
      backend,
      'annotations:v5',
      v5Storage,
      { ...v5Options, overwriteInvalid: true }
    )
    expect(recovered).toEqual({ status: 'saved' })
    expect(
      readAnnotationStorageV5(backend, 'annotations:v5', v5Options)
    ).toEqual({
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
      v5Storage,
      v5Options
    )

    expect(result).toEqual({ status: 'failed', error: quotaError })
    // 失败时旧值必须原样保留，重开后仍是上一个完整状态。
    expect(backend.store.get('annotations:v5')).toBe(
      serializeAnnotationStorageV5([], [], {})
    )
  })
})
