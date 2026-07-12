import type { CSSProperties } from 'react'

import type {
  ReaderSelectionEndpoint,
  ReaderSelectionRange,
  ReaderSelectionRect,
  ReaderSelectionRectangle
} from '@hamster-note/reader'

export type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '@hamster-note/reader'

export type PersistedHighlights = {
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
}

type HighlightsStorageV3 = {
  readonly version: 3
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
}

const PUBLIC_PAGE_SELECTION_ID_PATTERN = /^page-[1-9]\d*$/

export function parseHighlights(raw: string | null): PersistedHighlights {
  if (raw === null || raw.trim() === '') {
    return { ranges: [], rects: [] }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return parseHighlightsStorage(parsed)
  } catch (error) {
    if (error instanceof SyntaxError) return { ranges: [], rects: [] }
    throw error
  }
}

export function serializeHighlights(
  ranges: ReaderSelectionRange[],
  rects: ReaderSelectionRectangle[]
): string {
  const storage: HighlightsStorageV3 = { version: 3, ranges, rects }
  return JSON.stringify(storage)
}

function parseHighlightsStorage(value: unknown): PersistedHighlights {
  if (!isPlainRecord(value)) return { ranges: [], rects: [] }

  const version = value['version']
  if (version === 3) return parseHighlightsStorageV3(value)
  if (version === 2) return parseHighlightsStorageV2(value)

  return { ranges: [], rects: [] }
}

function parseHighlightsStorageV2(
  value: Record<string, unknown>
): PersistedHighlights {
  const ranges = value['ranges']
  if (!Array.isArray(ranges)) return { ranges: [], rects: [] }

  return {
    ranges: ranges.flatMap((range) => {
      const parsedRange = parseReaderSelectionRange(range)
      return parsedRange === null ? [] : [parsedRange]
    }),
    rects: []
  }
}

function parseHighlightsStorageV3(
  value: Record<string, unknown>
): PersistedHighlights {
  const ranges = value['ranges']
  const rects = value['rects']

  if (!Array.isArray(ranges)) return { ranges: [], rects: [] }
  if (rects !== undefined && !Array.isArray(rects))
    return { ranges: [], rects: [] }

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
      : []
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
