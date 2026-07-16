import type { CSSProperties } from 'react'

import type {
  ReaderPagePaintingMap,
  ReaderSelectionEndpoint,
  ReaderSelectionRange,
  ReaderSelectionRect,
  ReaderSelectionRectangle
} from '@hamster-note/reader'

export type {
  ReaderPagePaintingMap,
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '@hamster-note/reader'

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

export function serializeHighlights(
  ranges: ReaderSelectionRange[],
  rects: ReaderSelectionRectangle[],
  paintings: ReaderPagePaintingMap
): string {
  const storage: HighlightsStorageV4 = { version: 4, ranges, rects, paintings }
  return JSON.stringify(storage)
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
  if (entries.length === 0) return null

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
