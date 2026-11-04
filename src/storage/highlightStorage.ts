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

// v4 在 v3 基础上增加 paintings 字段；只保留读入形状，不再有写入类型。
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

// 旧容器只读：v2/v3/v4 写入入口已删除，新数据只写 V5（见 annotationStore）。

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
  | 'invalid-document'
  | 'unvalidated-document'

/**
 * 画库文档校验器：必须由调用方注入正式发布包的 `readLayeredDocument(...).ok`
 * 适配函数。存储层不认识文档内部结构，只有通过该函数校验的文档才算权威数据。
 */
export type AnnotationDocumentValidator = (document: unknown) => boolean

export type AnnotationStorageV5ReadOptions = {
  readonly validateDocument?: AnnotationDocumentValidator
}

export type AnnotationStorageV5WriteOptions = AnnotationStorageV5ReadOptions & {
  /** 仅在用户显式确认恢复时置 true；自动保存与迁移路径永不开启。 */
  readonly overwriteInvalid?: boolean
}

/**
 * 读取结果三态：
 * - `missing`：键确实不存在，只有这种状态允许启动旧数据迁移；
 * - `ok`：容器完整有效（空集合也算有效，不得用旧数据补齐）；
 * - `invalid`：键存在但不可用（含空白/损坏 JSON、未知版本、坏文档、缺校验器），
 *   调用方必须保留原件并报错，不得写回。
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
  /** 本次要写入的内容本身不可信，未落盘。 */
  | {
      readonly status: 'invalid-input'
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
  raw: string | null,
  options: AnnotationStorageV5ReadOptions = {}
): AnnotationStorageV5ReadResult {
  // 只有键确实不存在才算 missing；空白字符串是已存在但损坏的值，
  // 若在此判成 missing，自动迁移会重新覆盖并复活已删除的标注。
  if (raw === null) return { status: 'missing' }

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

  const documentsReason = checkAnnotationDocuments(
    storage.paintings,
    options.validateDocument
  )
  if (documentsReason !== null)
    return { status: 'invalid', reason: documentsReason }

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
  key: string,
  options: AnnotationStorageV5ReadOptions = {}
): AnnotationStorageV5ReadResult {
  return parseAnnotationStorageV5(backend.getItem(key), options)
}

/**
 * 单次 `setItem` 提交整容器：成功即完整替换，异常即失败且旧值不变。
 *
 * 写入前先把要落盘的 JSON 跑一遍与读取完全相同的校验：任何读不回来的输入
 * （非法页键、坏文档、缺校验器等）都返回 `invalid-input`，不触碰已有数据。
 * 已存在的值损坏、未知版本或文档不合格时默认拒绝覆盖（`refused`），只有用户
 * 显式确认恢复才可传 `overwriteInvalid: true`。
 */
export function writeAnnotationStorageV5(
  backend: AnnotationStorageV5Backend,
  key: string,
  storage: AnnotationStorageV5,
  options: AnnotationStorageV5WriteOptions = {}
): AnnotationStorageV5WriteResult {
  let serialized: string
  try {
    serialized = serializeAnnotationStorageV5(
      storage.ranges,
      storage.rects,
      storage.paintings
    )
  } catch (error) {
    return { status: 'failed', error }
  }

  // 用读取路径校验即将写入的字节，保证「写进去的必然读得出来」。
  const written = parseAnnotationStorageV5(serialized, options)
  if (written.status !== 'ok') {
    return {
      status: 'invalid-input',
      reason: written.status === 'invalid' ? written.reason : 'invalid-shape'
    }
  }

  const current = readAnnotationStorageV5(backend, key, options)
  if (current.status === 'invalid' && options.overwriteInvalid !== true) {
    return { status: 'refused', reason: current.reason }
  }

  try {
    backend.setItem(key, serialized)
    return { status: 'saved' }
  } catch (error) {
    return { status: 'failed', error }
  }
}

// 非空 paintings 必须有校验器且逐页通过；空集合本身有效，不需要校验器。
function checkAnnotationDocuments(
  paintings: AnnotationPaintingsV5,
  validateDocument: AnnotationDocumentValidator | undefined
): AnnotationStorageV5InvalidReason | null {
  const documents = Object.values(paintings)
  if (documents.length === 0) return null
  if (validateDocument === undefined) return 'unvalidated-document'

  for (const document of documents) {
    let valid = false
    try {
      valid = validateDocument(document)
    } catch {
      // 校验器抛错等同于不接受该文档，不能让异常逃逸并伪装成成功。
      valid = false
    }
    if (!valid) return 'invalid-document'
  }

  return null
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
    // 文档内部结构由注入的画库校验器判定；这里只要求它确实是对象，
    // 不能凭 schemaVersion 字段就把坏文档/未来文档当成有效权威数据。
    if (!isPlainRecord(document)) return null
    parsedPaintings[pageId] = document
  }

  return {
    version: ANNOTATION_STORAGE_V5_VERSION,
    ranges: parsedRanges,
    rects: parsedRects,
    paintings: parsedPaintings
  }
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

// 历史读取入口保留原有顶层过滤语义。新版迁移编排直接把原始页负载交给
// painting.migrateLegacyDocument，不使用此过滤结果迁移或保存绘图。
function parsePaintings(value: unknown): ReaderPagePaintingMap {
  if (!isPlainRecord(value)) return {}

  // 仅供尚未迁入 V5 的历史读取调用点使用。
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
  const selectionGroup = value['selectionGroup']
  if (
    selectionGroup !== undefined &&
    (!isPlainRecord(selectionGroup) ||
      typeof selectionGroup['id'] !== 'string' ||
      selectionGroup['id'].length === 0 ||
      !Number.isSafeInteger(selectionGroup['index']) ||
      (selectionGroup['index'] as number) < 0)
  )
    return null
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
    ...(selectionGroup === undefined
      ? {}
      : {
          selectionGroup:
            selectionGroup as ReaderSelectionRange['selectionGroup']
        }),
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
