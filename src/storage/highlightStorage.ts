import type { CSSProperties } from 'react'

import type {
  ReaderSelectionEndpoint,
  ReaderSelectionRange,
  ReaderSelectionRect,
  ReaderSelectionRectangle
} from '../types/selection'
import type { ReaderPagePaintingMap } from '../components/Page'

export type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../types/selection'
export type { ReaderPagePaintingMap } from '../components/Page'

// 旧容器（v2/v3/v4）只读入口的返回类型。
// PersistedHighlights 始终含 paintings：v4 直接读出，v3/v2 向后兼容时默认 {}。
export type PersistedHighlights = {
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
  readonly paintings: ReaderPagePaintingMap
}

// v4 在 v3 基础上增加 paintings 字段，用于持久化 Drawing 工具数据。
type HighlightsStorageV4 = {
  readonly version: 4
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
  readonly paintings: ReaderPagePaintingMap
}

const PUBLIC_PAGE_SELECTION_ID_PATTERN = /^page-[1-9]\d*$/

export function parseHighlights(raw: string | null): PersistedHighlights {
  if (raw === null || raw.trim() === '') {
    return { ranges: [], rects: [], paintings: {} }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return parseHighlightsStorage(parsed)
  } catch (error) {
    if (error instanceof SyntaxError)
      return { ranges: [], rects: [], paintings: {} }
    throw error
  }
}

/** 旧容器写入入口；只有 2.4/2.5 尚未迁移的调用点可用，V5 已存在的文件不得再写 v4。 */
export function serializeHighlights(
  ranges: ReaderSelectionRange[],
  rects: ReaderSelectionRectangle[],
  paintings: ReaderPagePaintingMap
): string {
  const storage: HighlightsStorageV4 = { version: 4, ranges, rects, paintings }
  return JSON.stringify(storage)
}

// ---------------------------------------------------------------------------
// V5 标注容器（design.md §4）
//
// V5 是唯一权威的新格式：ranges / rects 沿用旧字段语义，paintings 保存画库
// 返回的完整 EditorDocument。reader 不认识文档内部结构，只校验容器形状并把
// 文档原样保存——不截断、不投影、不丢字段，也绝不把损坏/未知版本当成缺失。
// ---------------------------------------------------------------------------

export const ANNOTATION_STORAGE_V5_VERSION = 5

/** Web demo 的新权威键前缀；完整键为 `<prefix><fileName>`。 */
export const ANNOTATION_STORAGE_V5_KEY_PREFIX =
  'hamster-reader-demo:annotations:v5:'

/** 画库文档在存储层是不透明负载：只要求是对象，字段原样透传。 */
export type AnnotationDocumentV5 = Record<string, unknown>

export type AnnotationPaintingsV5 = Record<string, AnnotationDocumentV5>

export type AnnotationStorageV5 = {
  readonly version: typeof ANNOTATION_STORAGE_V5_VERSION
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
  readonly paintings: AnnotationPaintingsV5
}

export type AnnotationStorageV5InvalidReason =
  | 'corrupt-json'
  | 'unsupported-version'
  | 'invalid-shape'

/**
 * 读取结果三态：
 * - `missing`：键不存在或为空，只有这种状态允许启动旧数据迁移；
 * - `ok`：容器完整有效（空集合也算有效，不得用旧数据补齐）；
 * - `invalid`：键存在但不可用，调用方必须保留原件并报错，不得写回。
 */
export type AnnotationStorageV5ReadResult =
  | { readonly status: 'missing' }
  | { readonly status: 'ok'; readonly storage: AnnotationStorageV5 }
  | {
      readonly status: 'invalid'
      readonly reason: AnnotationStorageV5InvalidReason
    }

export type AnnotationStorageV5WriteResult =
  | { readonly status: 'saved' }
  | {
      readonly status: 'refused'
      readonly reason: AnnotationStorageV5InvalidReason
    }
  | { readonly status: 'failed'; readonly error: unknown }

/** localStorage 兼容的最小后端；写入失败（如 quota）必须抛出，不能静默截断。 */
export type AnnotationStorageV5Backend = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function annotationStorageV5Key(fileName: string): string {
  return `${ANNOTATION_STORAGE_V5_KEY_PREFIX}${fileName}`
}

export function parseAnnotationStorageV5(
  raw: string | null
): AnnotationStorageV5ReadResult {
  if (raw === null || raw.trim() === '') return { status: 'missing' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    if (error instanceof SyntaxError)
      return { status: 'invalid', reason: 'corrupt-json' }
    throw error
  }

  if (!isPlainRecord(parsed))
    return { status: 'invalid', reason: 'invalid-shape' }

  const version = parsed['version']
  if (version !== ANNOTATION_STORAGE_V5_VERSION) {
    return {
      status: 'invalid',
      reason:
        typeof version === 'number' ? 'unsupported-version' : 'invalid-shape'
    }
  }

  const storage = parseAnnotationStorageV5Shape(parsed)
  if (storage === null) return { status: 'invalid', reason: 'invalid-shape' }

  return { status: 'ok', storage }
}

export function serializeAnnotationStorageV5(
  ranges: readonly ReaderSelectionRange[],
  rects: readonly ReaderSelectionRectangle[],
  paintings: AnnotationPaintingsV5
): string {
  const storage: AnnotationStorageV5 = {
    version: ANNOTATION_STORAGE_V5_VERSION,
    ranges: Array.from(ranges),
    rects: Array.from(rects),
    paintings
  }
  return JSON.stringify(storage)
}

export function readAnnotationStorageV5(
  backend: AnnotationStorageV5Backend,
  key: string
): AnnotationStorageV5ReadResult {
  return parseAnnotationStorageV5(backend.getItem(key))
}

/**
 * 单次 `setItem` 提交整容器：成功即完整替换，异常即失败且旧值不变。
 *
 * 已存在的值损坏或版本不受支持时默认拒绝覆盖（`refused`），调用方必须先让
 * 用户显式确认恢复，才可传 `overwriteInvalid: true`。
 */
export function writeAnnotationStorageV5(
  backend: AnnotationStorageV5Backend,
  key: string,
  storage: AnnotationStorageV5,
  options: { readonly overwriteInvalid?: boolean } = {}
): AnnotationStorageV5WriteResult {
  const current = readAnnotationStorageV5(backend, key)
  if (current.status === 'invalid' && options.overwriteInvalid !== true) {
    return { status: 'refused', reason: current.reason }
  }

  try {
    backend.setItem(
      key,
      serializeAnnotationStorageV5(
        storage.ranges,
        storage.rects,
        storage.paintings
      )
    )
    return { status: 'saved' }
  } catch (error) {
    return { status: 'failed', error }
  }
}

// V5 是权威数据源，校验比旧容器严格：任何一条 range / rect / 绘图页无法解析
// 都整容器判 invalid，而不是丢弃该条后写回残缺数据。
function parseAnnotationStorageV5Shape(
  value: Record<string, unknown>
): AnnotationStorageV5 | null {
  const ranges = value['ranges']
  const rects = value['rects']
  if (!Array.isArray(ranges) || !Array.isArray(rects)) return null

  const parsedRanges: ReaderSelectionRange[] = []
  for (const range of ranges) {
    const parsedRange = parseReaderSelectionRange(range)
    if (parsedRange === null) return null
    parsedRanges.push(parsedRange)
  }

  const parsedRects: ReaderSelectionRectangle[] = []
  for (const rect of rects) {
    const parsedRect = parseReaderSelectionRectangle(rect)
    if (parsedRect === null) return null
    parsedRects.push(parsedRect)
  }

  const paintings = value['paintings']
  if (!isPlainRecord(paintings)) return null

  const parsedPaintings: AnnotationPaintingsV5 = {}
  for (const [pageId, document] of Object.entries(paintings)) {
    if (!isPublicPageSelectionId(pageId)) return null
    if (!isAnnotationDocumentV5(document)) return null
    parsedPaintings[pageId] = document
  }

  return {
    version: ANNOTATION_STORAGE_V5_VERSION,
    ranges: parsedRanges,
    rects: parsedRects,
    paintings: parsedPaintings
  }
}

// 文档内部结构由画库负责，这里只确认它确实是带 schemaVersion 的对象；
// 具体版本号即便高于 reader 已知值也原样保留，交由库的正式读取能力判断。
function isAnnotationDocumentV5(value: unknown): value is AnnotationDocumentV5 {
  return isPlainRecord(value) && typeof value['schemaVersion'] === 'number'
}

function parseHighlightsStorage(value: unknown): PersistedHighlights {
  if (!isPlainRecord(value)) return { ranges: [], rects: [], paintings: {} }

  const version = value['version']
  if (version === 4) return parseHighlightsStorageV4(value)
  if (version === 3) return parseHighlightsStorageV3(value)
  if (version === 2) return parseHighlightsStorageV2(value)

  return { ranges: [], rects: [], paintings: {} }
}

function parseHighlightsStorageV4(
  value: Record<string, unknown>
): PersistedHighlights {
  const base = parseHighlightsStorageV3(value)
  return { ...base, paintings: parsePaintings(value['paintings']) }
}

// parsePaintings：顶层必须是 plain object；每个 value 必须是 plain object 才保留。
// 深度校验 DrawingValue 内部结构交给 library 的 sanitizeDrawingValue，
// demo 持久化层只负责过滤明显损坏的条目，避免脏数据写入 localStorage。
function parsePaintings(value: unknown): ReaderPagePaintingMap {
  if (!isPlainRecord(value)) return {}

  // 宽松校验：每个 value 必须是 plain object 才保留 entry。
  // 深度结构校验（DrawingStroke 字段等）交给 library 的 sanitizeDrawingValue，
  // demo 持久化层只过滤明显损坏条目，避免脏数据写入 localStorage。
  const parsed: Record<string, unknown> = {}
  for (const [key, drawingValue] of Object.entries(value)) {
    if (!isPlainRecord(drawingValue)) continue
    parsed[key] = drawingValue
  }
  return parsed as ReaderPagePaintingMap
}

function parseHighlightsStorageV2(
  value: Record<string, unknown>
): PersistedHighlights {
  const ranges = value['ranges']
  if (!Array.isArray(ranges)) return { ranges: [], rects: [], paintings: {} }

  return {
    ranges: ranges.flatMap((range) => {
      const parsedRange = parseReaderSelectionRange(range)
      return parsedRange === null ? [] : [parsedRange]
    }),
    rects: [],
    paintings: {}
  }
}

function parseHighlightsStorageV3(
  value: Record<string, unknown>
): PersistedHighlights {
  const ranges = value['ranges']
  const rects = value['rects']

  if (!Array.isArray(ranges)) return { ranges: [], rects: [], paintings: {} }
  if (rects !== undefined && !Array.isArray(rects))
    return { ranges: [], rects: [], paintings: {} }

  return {
    ranges: ranges.flatMap((range) => {
      const parsedRange = parseReaderSelectionRange(range)
      return parsedRange === null ? [] : [parsedRange]
    }),
    rects: Array.isArray(rects)
      ? rects.flatMap((rect) => {
          const parsedRect = parseReaderSelectionRectangle(rect)
          return parsedRect === null ? [] : [parsedRect]
        })
      : [],
    paintings: {}
  }
}

function parseReaderSelectionRange(
  value: unknown
): ReaderSelectionRange | null {
  if (!isPlainRecord(value)) return null

  const id = value['id']
  const text = value['text']
  const start = parseReaderSelectionEndpoint(value['start'])
  const end = parseReaderSelectionEndpoint(value['end'])
  const createdAt = value['createdAt']
  const overlayRectType = parseOverlayRectType(value['overlayRectType'])
  const rectsBySelectionId = parseRectsBySelectionId(
    value['rectsBySelectionId']
  )
  const markerStyle = parseCssProperties(value['markerStyle'])
  const selectionStyle = parseCssProperties(value['selectionStyle'])

  if (
    typeof id !== 'string' ||
    typeof text !== 'string' ||
    start === null ||
    end === null ||
    typeof createdAt !== 'number' ||
    overlayRectType === null ||
    rectsBySelectionId === null ||
    markerStyle === null ||
    selectionStyle === null
  ) {
    return null
  }

  return {
    id,
    text,
    start,
    end,
    createdAt,
    ...(overlayRectType === undefined ? {} : { overlayRectType }),
    rectsBySelectionId,
    ...(markerStyle === undefined ? {} : { markerStyle }),
    ...(selectionStyle === undefined ? {} : { selectionStyle })
  }
}

function parseReaderSelectionEndpoint(
  value: unknown
): ReaderSelectionEndpoint | null {
  if (!isPlainRecord(value)) return null

  const selectionId = value['selectionId']
  const offset = value['offset']
  if (!isPublicPageSelectionId(selectionId) || typeof offset !== 'number') {
    return null
  }

  return { selectionId, offset }
}

function parseOverlayRectType(
  value: unknown
): 'px' | 'percent' | undefined | null {
  if (value === undefined || value === 'px' || value === 'percent') return value
  return null
}

function parseRectOverlayRectType(value: unknown): 'px' | 'percent' | null {
  if (value === 'px' || value === 'percent') return value
  return null
}

function parseRectsBySelectionId(
  value: unknown
): ReaderSelectionRange['rectsBySelectionId'] | null {
  if (!isPlainRecord(value)) return null

  const entries = Object.entries(value)
  if (entries.length === 0) return {}

  const parsedEntries = entries.flatMap(([selectionId, rects]) => {
    if (!isPublicPageSelectionId(selectionId) || !Array.isArray(rects))
      return []
    const parsedRects = rects.flatMap((rect) => {
      const parsedRect = parseReaderOverlayRect(rect)
      return parsedRect === null ? [] : [parsedRect]
    })
    return parsedRects.length === rects.length
      ? [[selectionId, parsedRects] as const]
      : []
  })

  if (parsedEntries.length !== entries.length) return null

  return Object.fromEntries(parsedEntries)
}

function parseReaderOverlayRect(value: unknown): ReaderSelectionRect | null {
  if (!isPlainRecord(value)) return null

  const x = value['x']
  const y = value['y']
  const width = value['width']
  const height = value['height']
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null
  }

  return { x, y, width, height }
}

function parseReaderSelectionRectangle(
  value: unknown
): ReaderSelectionRectangle | null {
  if (!isPlainRecord(value)) return null

  const id = value['id']
  const createdAt = value['createdAt']
  const overlayRectType = parseRectOverlayRectType(value['overlayRectType'])
  const start = parseReaderSelectionRectPoint(value['start'])
  const end = parseReaderSelectionRectPoint(value['end'])
  const rect = parseReaderOverlayRect(value['rect'])
  const selectionId = value['selectionId']
  const markerStyle = parseCssProperties(value['markerStyle'])
  const selectionStyle = parseCssProperties(value['selectionStyle'])

  if (
    typeof id !== 'string' ||
    typeof createdAt !== 'number' ||
    overlayRectType === null ||
    start === null ||
    end === null ||
    rect === null ||
    (selectionId !== undefined && typeof selectionId !== 'string') ||
    markerStyle === null ||
    selectionStyle === null
  ) {
    return null
  }

  return {
    id,
    createdAt,
    overlayRectType,
    start,
    end,
    rect,
    ...(selectionId === undefined ? {} : { selectionId }),
    ...(markerStyle === undefined ? {} : { markerStyle }),
    ...(selectionStyle === undefined ? {} : { selectionStyle })
  }
}

function parseReaderSelectionRectPoint(
  value: unknown
): { x: number; y: number } | null {
  if (!isPlainRecord(value)) return null

  const x = value['x']
  const y = value['y']
  if (typeof x !== 'number' || typeof y !== 'number') return null

  return { x, y }
}

function parseCssProperties(value: unknown): CSSProperties | undefined | null {
  if (value === undefined) return undefined
  if (isCssProperties(value)) return value
  return null
}

function isPublicPageSelectionId(value: unknown): value is `page-${number}` {
  return (
    typeof value === 'string' && PUBLIC_PAGE_SELECTION_ID_PATTERN.test(value)
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCssProperties(value: unknown): value is CSSProperties {
  return isPlainRecord(value)
}
