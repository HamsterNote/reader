import type {
  ReaderBookmark,
  ReaderData,
  ReaderTextAnchor,
  ReaderTextReadingProgress
} from './types/readerData'

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const page = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

export function normalizePercentage(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : undefined
}

export function normalizeTextAnchor(
  value: unknown
): ReaderTextAnchor | undefined {
  const v = object(value)
  return page(v.pageNumber) &&
    typeof v.textId === 'string' &&
    typeof v.text === 'string' &&
    typeof v.offset === 'number' &&
    Number.isInteger(v.offset) &&
    v.offset >= 0
    ? (v as ReaderTextAnchor)
    : undefined
}

/** Display-only conversion. Never replace the stored record on read/restore. */
export function normalizeBookmark(value: unknown): ReaderBookmark | undefined {
  const anchor = normalizeTextAnchor(value)
  if (anchor) return anchor
  const v = object(value)
  if (!page(v.pageNumber)) return undefined
  const verticalPercentage = normalizePercentage(v.verticalPercentage) ?? 0
  return verticalPercentage === v.verticalPercentage
    ? (value as ReaderBookmark)
    : {
        pageNumber: v.pageNumber,
        verticalPercentage
      }
}

export function normalizeTextProgress(
  value: unknown
): ReaderTextReadingProgress | undefined {
  const v = object(value)
  if (!page(v.currentPageNumber)) return undefined
  const anchor = normalizeTextAnchor(v.anchor)
  const verticalPercentage = normalizePercentage(v.verticalPercentage)
  if (
    v.anchor ===
      (anchor?.pageNumber === v.currentPageNumber ? anchor : undefined) &&
    v.verticalPercentage === verticalPercentage
  )
    return value as ReaderTextReadingProgress
  return {
    currentPageNumber: v.currentPageNumber,
    ...(anchor?.pageNumber === v.currentPageNumber ? { anchor } : {}),
    ...(verticalPercentage !== undefined ? { verticalPercentage } : {})
  }
}

export function resolveReadingProgress(
  data: ReaderData,
  mode: 'layout' | 'text'
): ReaderBookmark | undefined {
  if (mode === 'layout')
    return (
      normalizeBookmark(data.layoutReadingProgress) ??
      normalizeTextAnchor(data.virtualPaper?.anchor)
    )
  const text = normalizeTextProgress(data.textReadingProgress)
  return (
    text?.anchor ??
    (text
      ? {
          pageNumber: text.currentPageNumber,
          verticalPercentage: text.verticalPercentage ?? 0
        }
      : undefined)
  )
}

export type ReadingPosition =
  | { readonly status: 'ready'; readonly position: ReaderBookmark }
  | { readonly status: 'pending' | 'failed' }

export function invalidStoredProgress(
  data: ReaderData | undefined,
  mode: 'layout' | 'text'
): boolean {
  if (!data) return false
  const stored =
    mode === 'layout' ? data.layoutReadingProgress : data.textReadingProgress
  if (!stored) return false
  const v = object(stored)
  const number = mode === 'layout' ? v.pageNumber : v.currentPageNumber
  const layoutAnchor = 'textId' in v ? v : undefined
  const anchor = mode === 'text' ? v.anchor : layoutAnchor
  return (
    !page(number) ||
    (v.verticalPercentage !== undefined &&
      normalizePercentage(v.verticalPercentage) === undefined) ||
    (anchor !== undefined &&
      (!normalizeTextAnchor(anchor) || object(anchor).pageNumber !== number))
  )
}
