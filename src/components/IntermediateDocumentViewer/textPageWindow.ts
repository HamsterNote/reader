const PDF_TEXT_PAGE_WINDOW_SIZE = 4
const REFLOWABLE_TEXT_PAGE_WINDOW_SIZE = 1

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value))

export const getTextPageWindowSize = (isPdf: boolean): number =>
  isPdf ? PDF_TEXT_PAGE_WINDOW_SIZE : REFLOWABLE_TEXT_PAGE_WINDOW_SIZE

export function getTextPageWindow(
  pageNumbers: readonly number[],
  targetPageNumber: number,
  windowSize: number
): readonly number[] {
  const targetIndex = pageNumbers.indexOf(targetPageNumber)
  if (targetIndex === -1 || pageNumbers.length === 0) return []

  const safeWindowSize = Math.max(1, Math.floor(windowSize))
  const startIndex = Math.floor(targetIndex / safeWindowSize) * safeWindowSize
  return pageNumbers.slice(startIndex, startIndex + safeWindowSize)
}

export function getTextPagePreloadWindow(
  pageNumbers: readonly number[],
  targetPageNumber: number,
  windowSize: number,
  overscanWindowCount: number
): readonly number[] {
  const targetIndex = pageNumbers.indexOf(targetPageNumber)
  if (targetIndex === -1 || pageNumbers.length === 0) return []

  const safeWindowSize = Math.max(1, Math.floor(windowSize))
  const safeOverscanWindowCount = Number.isFinite(overscanWindowCount)
    ? Math.max(0, Math.floor(overscanWindowCount))
    : 0
  const activeWindowStartIndex =
    Math.floor(targetIndex / safeWindowSize) * safeWindowSize
  const preloadStartIndex = Math.max(
    0,
    activeWindowStartIndex - safeOverscanWindowCount * safeWindowSize
  )
  const preloadEndIndex = Math.min(
    pageNumbers.length,
    activeWindowStartIndex + (safeOverscanWindowCount + 1) * safeWindowSize
  )
  return pageNumbers.slice(preloadStartIndex, preloadEndIndex)
}

export function resolveTextPageSegmentPosition(
  pageNumbers: readonly number[],
  currentPageNumber: number,
  pageProgress: number
): number {
  if (pageNumbers.length === 0) return 0

  const pageIndex = Math.max(0, pageNumbers.indexOf(currentPageNumber))
  return ((pageIndex + clampUnit(pageProgress)) / pageNumbers.length) * 100
}

export function resolveTextPageFromProgress(
  pageNumbers: readonly number[],
  progress: number
): number | null {
  if (pageNumbers.length === 0) return null

  const pageIndex = Math.min(
    pageNumbers.length - 1,
    Math.floor(clampUnit(progress) * pageNumbers.length)
  )
  return pageNumbers[pageIndex] ?? null
}

export function resolveTextHighlightSegmentPosition(
  pageNumbers: readonly number[],
  pageNumber: number
): number {
  if (pageNumbers.length === 0) return 0

  const pageIndex = Math.max(0, pageNumbers.indexOf(pageNumber))
  return ((pageIndex + 0.5) / pageNumbers.length) * 100
}
