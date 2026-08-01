import type {
  ReaderSelectionEndpoint,
  ReaderSelectionRange
} from '../../types/selection'

type EndpointSide = 'start' | 'end'

type DomAnchoredSegment = {
  readonly domStart: number
  readonly domEnd: number
  readonly canonicalStart: number
  readonly canonicalEnd: number
}

export function canonicalizePdfSelectionRange(
  range: ReaderSelectionRange,
  root: HTMLElement | null
): ReaderSelectionRange | null {
  if (!root) return range

  if (range.start.selectionId === range.end.selectionId) {
    const segments = getSelectionSegments(range.start.selectionId, root)
    if (
      segments &&
      !isContinuousCanonicalRange(
        segments,
        range.start.offset,
        range.end.offset
      )
    ) {
      return null
    }
  }

  return {
    ...range,
    start: canonicalizeEndpoint(range.start, 'start', root),
    end: canonicalizeEndpoint(range.end, 'end', root)
  }
}

function getSelectionSegments(
  selectionId: string,
  root: HTMLElement
): DomAnchoredSegment[] | null {
  if (!/^page-[1-9]\d*$/.test(selectionId)) return null
  const page = root.querySelector<HTMLElement>(
    `[data-testid="intermediate-text-${selectionId}"]`
  )
  const content = page?.querySelector<HTMLElement>('.hsn-selection-content')
  return content ? getDomAnchoredSegments(content) : null
}

function isContinuousCanonicalRange(
  segments: readonly DomAnchoredSegment[],
  domStart: number,
  domEnd: number
): boolean {
  if (domStart > domEnd) return false
  const intersectingSegments = segments.filter(
    (segment) => segment.domEnd > domStart && segment.domStart < domEnd
  )
  return intersectingSegments.every(
    (segment, index) =>
      index === 0 ||
      intersectingSegments[index - 1]?.canonicalEnd === segment.canonicalStart
  )
}

function canonicalizeEndpoint(
  endpoint: ReaderSelectionEndpoint,
  side: EndpointSide,
  root: HTMLElement
): ReaderSelectionEndpoint {
  if (!/^page-[1-9]\d*$/.test(endpoint.selectionId)) return endpoint

  const segments = getSelectionSegments(endpoint.selectionId, root)
  if (!segments) return endpoint

  const canonicalOffset = mapDomOffsetToCanonical(
    segments,
    endpoint.offset,
    side
  )
  return canonicalOffset === null
    ? endpoint
    : { ...endpoint, offset: canonicalOffset }
}

function getDomAnchoredSegments(root: HTMLElement): DomAnchoredSegment[] {
  const anchorBounds = new Map<
    HTMLElement,
    { readonly domStart: number; domEnd: number }
  >()
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let domOffset = 0

  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!(node instanceof Text)) continue

    const anchor = node.parentElement?.closest<HTMLElement>(
      '[data-selection-start-offset]'
    )
    if (anchor && root.contains(anchor)) {
      const bounds = anchorBounds.get(anchor)
      if (bounds) {
        bounds.domEnd = domOffset + node.data.length
      } else {
        anchorBounds.set(anchor, {
          domStart: domOffset,
          domEnd: domOffset + node.data.length
        })
      }
    }
    domOffset += node.data.length
  }

  return Array.from(anchorBounds).flatMap(([anchor, bounds]) => {
    const rawOffset = anchor.dataset.selectionStartOffset
    if (!rawOffset || !/^(0|[1-9]\d*)$/.test(rawOffset)) return []

    const canonicalStart = Number(rawOffset)
    const textLength = bounds.domEnd - bounds.domStart
    if (!Number.isSafeInteger(canonicalStart) || textLength === 0) return []

    return [
      {
        ...bounds,
        canonicalStart,
        canonicalEnd: canonicalStart + textLength
      }
    ]
  })
}

function mapDomOffsetToCanonical(
  segments: readonly DomAnchoredSegment[],
  domOffset: number,
  side: EndpointSide
): number | null {
  if (
    !Number.isSafeInteger(domOffset) ||
    domOffset < 0 ||
    segments.length === 0
  ) {
    return null
  }

  const startBoundary = segments.find(
    (segment) => segment.domStart === domOffset
  )
  const endBoundary = segments.find((segment) => segment.domEnd === domOffset)
  if (startBoundary && endBoundary) {
    return side === 'start'
      ? startBoundary.canonicalStart
      : endBoundary.canonicalEnd
  }
  if (startBoundary) return startBoundary.canonicalStart
  if (endBoundary) return endBoundary.canonicalEnd

  const containingSegment = segments.find(
    (segment) => segment.domStart < domOffset && domOffset < segment.domEnd
  )
  if (containingSegment) {
    return (
      containingSegment.canonicalStart + domOffset - containingSegment.domStart
    )
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const previousSegment = segments[index]
    if (previousSegment && previousSegment.domEnd < domOffset) {
      return previousSegment.canonicalEnd
    }
  }

  const nextSegment = segments.find((segment) => segment.domStart > domOffset)
  return nextSegment?.canonicalStart ?? null
}
