import type {
  ReaderPagePositionBookmark,
  ReaderData
} from '../types/readerData'
import type { IntermediateText } from '@hamster-note/types'
import type { PdfGeometry } from './contracts'

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export function nativeLayoutProgress(
  pageNumber: number,
  verticalPercentage = 0
): ReaderPagePositionBookmark | undefined {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return undefined
  if (!Number.isFinite(verticalPercentage)) return undefined
  return {
    pageNumber,
    verticalPercentage: Math.min(100, Math.max(0, verticalPercentage))
  }
}

export function nativeLayoutProgressFromGeometry(
  geometry: Pick<PdfGeometry, 'height' | 'pageToViewport' | 'pageNumber'> &
    Partial<Pick<PdfGeometry, 'crop'>>,
  _viewportHeight: number
): ReaderPagePositionBookmark | undefined {
  const scale = Math.abs(geometry.pageToViewport[0])
  const top = geometry.pageToViewport[5]
  const cropTop =
    geometry.crop && Number.isFinite(geometry.crop.top)
      ? geometry.height * (geometry.crop.top ?? 0)
      : 0
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !Number.isFinite(top) ||
    !Number.isFinite(cropTop) ||
    !Number.isFinite(geometry.height) ||
    geometry.height <= 0
  )
    return nativeLayoutProgress(geometry.pageNumber)
  // Persist the position inside the complete page frame. The old code used
  // the scrollable page height, while native restore used the full frame;
  // that made the same bookmark reopen at a different offset.
  const pagePosition = Math.max(0, -top / scale - cropTop)
  return nativeLayoutProgress(
    geometry.pageNumber,
    (pagePosition / geometry.height) * 100
  )
}

export function readerDataFromNativeSnapshot(
  snapshotData: unknown,
  progressData?: unknown
): ReaderData | undefined {
  const value = {
    ...record(progressData),
    ...record(record(snapshotData).readerData)
  }
  return Object.keys(value).length ? (value as ReaderData) : undefined
}

/** Update only the existing optional readerData progress field. */
export function withNativeLayoutProgress(
  snapshotData: unknown,
  progress: ReaderPagePositionBookmark
): Record<string, unknown> {
  const snapshot = record(snapshotData)
  return {
    ...snapshot,
    readerData: {
      ...record(snapshot.readerData),
      layoutReadingProgress: progress
    }
  }
}

/** Update only the OCR field owned by the native OCR provider. */
export function withNativeOcrTexts(
  snapshotData: unknown,
  pageNumber: number,
  texts: readonly IntermediateText[]
): Record<string, unknown> {
  const snapshot = record(snapshotData)
  const readerData = record(snapshot.readerData)
  const existing = record(readerData.ocrTexts)
  return {
    ...snapshot,
    readerData: {
      ...readerData,
      ocrTexts: { ...existing, [pageNumber]: texts }
    }
  }
}

export function nativeProgressKey(
  progress: ReaderPagePositionBookmark
): string {
  return `${progress.pageNumber}:${progress.verticalPercentage}`
}
