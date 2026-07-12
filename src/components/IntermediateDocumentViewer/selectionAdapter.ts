import type {
  LinkedSelectionData,
  LinkedSelectionRange
} from '@hamster-note/selection'

import type {
  ReaderLinkedSelectionData,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRectangle,
  ReaderSelectionRange,
  ReaderSelectionRect
} from '../../types/selection'

export type RuntimeLinkedSelectionTransient = {
  selectionOrder?: LinkedSelectionData['selectionOrder']
  draggingRange?: LinkedSelectionData['draggingRange']
  selectingText?: LinkedSelectionData['selectingText']
  activeRange?: LinkedSelectionData['activeRange']
}

export type RuntimeLinkedSelectionDataInput = {
  readonly scopeId: string
  readonly ranges: readonly ReaderSelectionRange[]
  readonly selectedRangeId: string | null
  readonly pageNumbers: readonly number[]
  readonly overlayRectType: ReaderSelectionOverlayRectType
  readonly transient: RuntimeLinkedSelectionTransient
}

export function runtimePageSelectionId(
  scopeId: string,
  pageNumber: number
): string {
  return `${scopeId}:page-${pageNumber}`
}

export function mapPublicRangesToRuntime(
  ranges: readonly ReaderSelectionRange[],
  scopeId: string
): LinkedSelectionRange[] {
  return ranges.map((range) => ({
    ...range,
    start: mapPublicEndpointToRuntime(range.start, scopeId),
    end: mapPublicEndpointToRuntime(range.end, scopeId),
    rectsBySelectionId: mapPublicRectsToRuntime(
      range.rectsBySelectionId,
      scopeId
    )
  }))
}

export function mapRuntimeRangesToPublic(
  ranges: readonly LinkedSelectionRange[],
  scopeId: string
): ReaderSelectionRange[] {
  return ranges.flatMap((range) => {
    const publicRange = mapRuntimeRangeToPublic(range, scopeId)
    return publicRange ? [publicRange] : []
  })
}

export function mapRuntimeLinkedDataToPublic(
  data: LinkedSelectionData,
  scopeId: string
): ReaderLinkedSelectionData {
  const publicActiveRange = data.activeRange
    ? mapRuntimeRangeToPublic(data.activeRange, scopeId)
    : data.activeRange

  return {
    items: mapRuntimeRangesToPublic(data.items, scopeId),
    selectedRangeId: data.selectedRangeId,
    selectionOrder: data.selectionOrder.flatMap((selectionId) => {
      const publicSelectionId = mapRuntimeSelectionIdToPublic(
        selectionId,
        scopeId
      )
      return publicSelectionId ? [publicSelectionId] : []
    }),
    overlayRectType: data.overlayRectType,
    draggingRange: data.draggingRange,
    selectingText: data.selectingText,
    activeRange: publicActiveRange
  }
}

export function buildRuntimeLinkedSelectionData({
  scopeId,
  ranges,
  selectedRangeId,
  pageNumbers,
  overlayRectType,
  transient
}: RuntimeLinkedSelectionDataInput): LinkedSelectionData {
  const { selectionOrder, ...remainingTransient } = transient

  return {
    items: mapPublicRangesToRuntime(ranges, scopeId),
    selectedRangeId,
    selectionOrder: resolveRuntimeSelectionOrder(
      scopeId,
      pageNumbers,
      selectionOrder
    ),
    overlayRectType,
    ...remainingTransient
  }
}

export function mapPublicRectanglesToRuntime(
  rects: readonly ReaderSelectionRectangle[] | undefined,
  scopeId: string
): ReaderSelectionRectangle[] | undefined {
  return rects?.map((rect) => ({
    ...rect,
    selectionId: rect.selectionId ? `${scopeId}:${rect.selectionId}` : undefined
  }))
}

export function mapRuntimeRectangleToPublic(
  rect: ReaderSelectionRectangle,
  scopeId: string
): ReaderSelectionRectangle {
  const publicSelectionId = rect.selectionId
    ? mapRuntimeSelectionIdToPublic(rect.selectionId, scopeId)
    : undefined

  return {
    ...rect,
    selectionId: publicSelectionId ?? rect.selectionId
  }
}

function resolveRuntimeSelectionOrder(
  scopeId: string,
  pageNumbers: readonly number[],
  transientSelectionOrder: readonly string[] | undefined
): string[] {
  const visibleSelectionIds = pageNumbers.map((pageNumber) =>
    runtimePageSelectionId(scopeId, pageNumber)
  )

  if (!transientSelectionOrder) {
    return visibleSelectionIds
  }

  const visibleSelectionIdSet = new Set(visibleSelectionIds)
  return transientSelectionOrder.filter((selectionId) =>
    visibleSelectionIdSet.has(selectionId)
  )
}

export function extractRuntimeLinkedTransient(
  data: LinkedSelectionData
): RuntimeLinkedSelectionTransient {
  const transient: RuntimeLinkedSelectionTransient = {}

  if (data.selectionOrder !== undefined) {
    transient.selectionOrder = data.selectionOrder
  }

  if (data.draggingRange !== undefined) {
    transient.draggingRange = data.draggingRange
  }

  if (data.selectingText !== undefined) {
    transient.selectingText = data.selectingText
  }

  if (data.activeRange !== undefined) {
    transient.activeRange = data.activeRange
  }

  return transient
}

export function areRuntimeLinkedTransientsEqual(
  left: RuntimeLinkedSelectionTransient,
  right: RuntimeLinkedSelectionTransient
): boolean {
  return (
    areSelectionOrdersEqual(left.selectionOrder, right.selectionOrder) &&
    areDraggingRangesEqual(left.draggingRange, right.draggingRange) &&
    left.selectingText === right.selectingText &&
    areLinkedRangesEqual(left.activeRange, right.activeRange)
  )
}

function areSelectionOrdersEqual(
  left: string[] | undefined,
  right: string[] | undefined
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false

  return left.every((selectionId, index) => selectionId === right[index])
}

function areDraggingRangesEqual(
  left: RuntimeLinkedSelectionTransient['draggingRange'],
  right: RuntimeLinkedSelectionTransient['draggingRange']
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.type !== right.type) return false

  if (left.type === 'persisted-range' && right.type === 'persisted-range') {
    return left.id === right.id
  }

  return true
}

function areLinkedRangesEqual(
  left: RuntimeLinkedSelectionTransient['activeRange'],
  right: RuntimeLinkedSelectionTransient['activeRange']
): boolean {
  if (left === right) return true
  if (!left || !right) return false

  return (
    left.id === right.id &&
    left.text === right.text &&
    left.createdAt === right.createdAt &&
    left.overlayRectType === right.overlayRectType &&
    left.start.selectionId === right.start.selectionId &&
    left.start.offset === right.start.offset &&
    left.end.selectionId === right.end.selectionId &&
    left.end.offset === right.end.offset &&
    areRectMapsEqual(left.rectsBySelectionId, right.rectsBySelectionId)
  )
}

function areRectMapsEqual(
  left: LinkedSelectionRange['rectsBySelectionId'],
  right: LinkedSelectionRange['rectsBySelectionId']
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every((selectionId) => {
    const leftRects = left[selectionId]
    const rightRects = right[selectionId]
    if (!leftRects || !rightRects) return false
    if (leftRects.length !== rightRects.length) return false

    return leftRects.every((leftRect, index) => {
      const rightRect = rightRects[index]
      return (
        rightRect !== undefined &&
        leftRect.x === rightRect.x &&
        leftRect.y === rightRect.y &&
        leftRect.width === rightRect.width &&
        leftRect.height === rightRect.height
      )
    })
  })
}

export function mapRuntimeRangeToPublic(
  range: LinkedSelectionRange,
  scopeId: string
): ReaderSelectionRange | null {
  const startSelectionId = mapRuntimeSelectionIdToPublic(
    range.start.selectionId,
    scopeId
  )
  const endSelectionId = mapRuntimeSelectionIdToPublic(
    range.end.selectionId,
    scopeId
  )

  if (!startSelectionId || !endSelectionId) {
    return null
  }

  return {
    ...range,
    start: {
      ...range.start,
      selectionId: startSelectionId
    },
    end: {
      ...range.end,
      selectionId: endSelectionId
    },
    rectsBySelectionId: mapRuntimeRectsToPublic(
      range.rectsBySelectionId,
      scopeId
    )
  }
}

function mapPublicEndpointToRuntime(
  endpoint: ReaderSelectionRange['start'],
  scopeId: string
): LinkedSelectionRange['start'] {
  return {
    ...endpoint,
    selectionId: `${scopeId}:${endpoint.selectionId}`
  }
}

function mapPublicRectsToRuntime(
  rectsBySelectionId: ReaderSelectionRange['rectsBySelectionId'],
  scopeId: string
): LinkedSelectionRange['rectsBySelectionId'] {
  const runtimeRectsBySelectionId: Record<string, ReaderSelectionRect[]> = {}

  Object.entries(rectsBySelectionId).forEach(([selectionId, rects]) => {
    runtimeRectsBySelectionId[`${scopeId}:${selectionId}`] = rects
  })

  return runtimeRectsBySelectionId
}

function mapRuntimeRectsToPublic(
  rectsBySelectionId: LinkedSelectionRange['rectsBySelectionId'],
  scopeId: string
): ReaderSelectionRange['rectsBySelectionId'] {
  const publicRectsBySelectionId: Record<string, ReaderSelectionRect[]> = {}

  Object.entries(rectsBySelectionId).forEach(([selectionId, rects]) => {
    const publicSelectionId = mapRuntimeSelectionIdToPublic(
      selectionId,
      scopeId
    )

    if (publicSelectionId) {
      publicRectsBySelectionId[publicSelectionId] = rects
    }
  })

  return publicRectsBySelectionId
}

export function mapRuntimeSelectionIdToPublic(
  selectionId: string,
  scopeId: string
): string | null {
  const prefix = `${scopeId}:`

  if (!selectionId.startsWith(prefix)) {
    return null
  }

  const publicSelectionId = selectionId.slice(prefix.length)
  return publicSelectionId.startsWith('page-') ? publicSelectionId : null
}
