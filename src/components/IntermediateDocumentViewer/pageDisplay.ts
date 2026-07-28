import type { ReaderEdgeCrop, ReaderPageEdgeCrop } from '../../types/readerData'
import { parsePublicPageId } from './rangeJumpHelpers'

const MAX_AXIS_CROP = 0.99

type PageSize = {
  readonly width: number
  readonly height: number
}

export type PageCropGeometry = {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export type CroppedPreviewPoint = {
  readonly x: number
  readonly y: number
}

type CroppedPreviewPointParams = {
  readonly pageSize: PageSize
  readonly crop: ReaderEdgeCrop | undefined
  readonly previewWidth: number
  readonly sourceX: number
  readonly sourceY: number
}

const normalizeRatio = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_AXIS_CROP, value))
}

const normalizeAxis = (
  start: number,
  end: number
): readonly [number, number] => {
  const total = start + end
  if (total < 1) return [start, end]

  const factor = MAX_AXIS_CROP / total
  return [start * factor, end * factor]
}

export const resolveHiddenPageNumbers = (
  hiddenPages: readonly (number | string)[] | undefined
): ReadonlySet<number> => {
  const pageNumbers = new Set<number>()

  hiddenPages?.forEach((value) => {
    let pageNumber: number | null
    if (typeof value === 'number') {
      pageNumber = Number.isInteger(value) ? value : null
    } else {
      pageNumber = parsePublicPageId(value)
    }
    if (pageNumber !== null && pageNumber > 0) {
      pageNumbers.add(pageNumber)
    }
  })

  return pageNumbers
}

export const resolvePageEdgeCrop = (
  edgeCrop: ReaderPageEdgeCrop | undefined,
  pageNumber: number
): ReaderEdgeCrop | undefined =>
  edgeCrop?.pages?.[`page-${pageNumber}`] ?? edgeCrop?.all

export const getPageCropGeometry = (
  pageSize: PageSize,
  crop: ReaderEdgeCrop | undefined
): PageCropGeometry => {
  const [leftRatio, rightRatio] = normalizeAxis(
    normalizeRatio(crop?.left),
    normalizeRatio(crop?.right)
  )
  const [topRatio, bottomRatio] = normalizeAxis(
    normalizeRatio(crop?.top),
    normalizeRatio(crop?.bottom)
  )
  const left = pageSize.width * leftRatio
  const right = pageSize.width * rightRatio
  const top = pageSize.height * topRatio
  const bottom = pageSize.height * bottomRatio

  return {
    top,
    right,
    bottom,
    left,
    width: pageSize.width - left - right,
    height: pageSize.height - top - bottom
  }
}

export const getCroppedPreviewPoint = (
  params: CroppedPreviewPointParams
): CroppedPreviewPoint => {
  const geometry = getPageCropGeometry(params.pageSize, params.crop)
  const previewScale = params.previewWidth / geometry.width
  const visibleX = Math.max(
    0,
    Math.min(geometry.width, params.sourceX - geometry.left)
  )
  const visibleY = Math.max(
    0,
    Math.min(geometry.height, params.sourceY - geometry.top)
  )

  return {
    x: visibleX * previewScale,
    y: visibleY * previewScale
  }
}
