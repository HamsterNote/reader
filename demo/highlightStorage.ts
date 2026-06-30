import type { CSSProperties } from 'react'

import type {
  ReaderSelectionEndpoint,
  ReaderSelectionRange,
  ReaderSelectionRect
} from '@hamster-note/reader'

export type { ReaderSelectionRange } from '@hamster-note/reader'

type HighlightsStorageV2 = {
  readonly version: 2
  readonly ranges: readonly ReaderSelectionRange[]
}

const PUBLIC_PAGE_SELECTION_ID_PATTERN = /^page-[1-9]\d*$/

export function parseHighlights(raw: string | null): ReaderSelectionRange[] {
  if (raw === null || raw.trim() === '') return []

  try {
    const parsed: unknown = JSON.parse(raw)
    return parseHighlightsStorageV2(parsed)
  } catch (error) {
    if (error instanceof SyntaxError) return []
    throw error
  }
}

export function serializeHighlights(ranges: ReaderSelectionRange[]): string {
  const storage: HighlightsStorageV2 = { version: 2, ranges }
  return JSON.stringify(storage)
}

function parseHighlightsStorageV2(value: unknown): ReaderSelectionRange[] {
  if (!isPlainRecord(value)) return []
  if (value['version'] !== 2) return []

  const ranges = value['ranges']
  if (!Array.isArray(ranges)) return []

  return ranges.flatMap((range) => {
    const parsedRange = parseReaderSelectionRange(range)
    return parsedRange === null ? [] : [parsedRange]
  })
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
