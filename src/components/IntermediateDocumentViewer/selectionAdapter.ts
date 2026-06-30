import type {
  LinkedSelectionData,
  LinkedSelectionRange
} from '@hamster-note/selection'

import type {
  ReaderLinkedSelectionData,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRect
} from '../../types/selection'

export type RuntimeLinkedSelectionTransient = Pick<
  LinkedSelectionData,
  'draggingRange' | 'selectingText'
>

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
    ...extractRuntimeLinkedTransient(data)
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
  return {
    items: mapPublicRangesToRuntime(ranges, scopeId),
    selectedRangeId,
    selectionOrder: pageNumbers.map((pageNumber) =>
      runtimePageSelectionId(scopeId, pageNumber)
    ),
    overlayRectType,
    ...transient
  }
}

export function extractRuntimeLinkedTransient(
  data: LinkedSelectionData
): RuntimeLinkedSelectionTransient {
  const transient: RuntimeLinkedSelectionTransient = {}

  if (data.draggingRange !== undefined) {
    transient.draggingRange = data.draggingRange
  }

  if (data.selectingText !== undefined) {
    transient.selectingText = data.selectingText
  }

  return transient
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

function mapRuntimeSelectionIdToPublic(
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
