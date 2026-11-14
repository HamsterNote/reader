import type {
  ReaderPagePositionBookmark,
  ReaderData
} from '../types/readerData'
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
  geometry: Pick<PdfGeometry, 'height' | 'pageToViewport' | 'pageNumber'>,
  viewportHeight: number
): ReaderPagePositionBookmark | undefined {
  const scale = Math.abs(geometry.pageToViewport[0])
  const top = geometry.pageToViewport[5]
  const scrollable = geometry.height * scale - viewportHeight
  if (!Number.isFinite(scale) || !Number.isFinite(top) || scrollable <= 0)
    return nativeLayoutProgress(geometry.pageNumber)
  return nativeLayoutProgress(
    geometry.pageNumber,
    (Math.max(0, -top) / scrollable) * 100
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

export function nativeProgressKey(
  progress: ReaderPagePositionBookmark
): string {
  return `${progress.pageNumber}:${progress.verticalPercentage}`
}
