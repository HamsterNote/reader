import type {
  ReaderSelectionEndpoint,
  ReaderSelectionRange
} from '../../types/selection'
import { getSelectionGroup } from '../selection/selectionGroups'

type EndpointSide = 'start' | 'end'

type DomAnchoredSegment = {
  readonly domStart: number
  readonly domEnd: number
  readonly canonicalStart: number
  readonly canonicalEnd: number
  readonly text: string
}

/** Visual PDF reading order can differ from the source text stream. Represent
 * a discontiguous selection as separate annotations, never a wider source range
 * that would also mark unselected text (or silently reject the selection). */
export function canonicalizePdfSelectionRanges(
  range: ReaderSelectionRange,
  root: HTMLElement | null,
  canonicalText?: string
): ReaderSelectionRange[] {
  const continuous = canonicalizePdfSelectionRange(range, root, canonicalText)
  if (continuous) return [continuous]
  if (!root || range.start.selectionId !== range.end.selectionId) return []
  const segments = getSelectionSegments(range.start.selectionId, root)
  if (!segments) return []

  const parts: Array<{ start: number; end: number; text: string }> = []
  for (const segment of segments) {
    const start = Math.max(range.start.offset, segment.domStart)
    const end = Math.min(range.end.offset, segment.domEnd)
    if (end <= start) continue
    const sourceStart = segment.canonicalStart + start - segment.domStart
    const sourceEnd = segment.canonicalStart + end - segment.domStart
    const text = segment.text.slice(
      start - segment.domStart,
      end - segment.domStart
    )
    const previous = parts.at(-1)
    if (
      previous &&
      areCanonicalNeighbors(previous.end, sourceStart, canonicalText)
    ) {
      previous.text += canonicalText?.slice(previous.end, sourceStart) ?? ''
      previous.end = sourceEnd
      previous.text += text
    } else {
      parts.push({ start: sourceStart, end: sourceEnd, text })
    }
  }
  return parts.map((part, index) => ({
    ...range,
    selectionGroup: { id: range.selectionGroup?.id ?? range.id, index },
    id: index === 0 ? range.id : `${range.id}:pdf-${part.start}-${part.end}`,
    text: part.text,
    start: { ...range.start, offset: part.start },
    end: { ...range.end, offset: part.end }
  }))
}

/** The Text runtime sees one logical selection. Persisted members keep their
 * separate canonical endpoints and PDF geometry. DOM endpoints are rebuilt on
 * every layout so pagination/font changes cannot leave stale offsets. */
export function combinePdfTextSelectionGroups(
  ranges: readonly ReaderSelectionRange[],
  root: HTMLElement | null,
  enabled = true
): ReaderSelectionRange[] {
  if (!root || !enabled) return Array.from(ranges)
  const visited = new Set<string>()
  return ranges.flatMap((range) => {
    if (visited.has(range.id)) return []
    const members = getSelectionGroup(ranges, range.id)
    members.forEach((member) => visited.add(member.id))
    // Every persisted range carries canonical offsets, including a single
    // highlight. Selection and its handles always consume current DOM offsets.
    const first = members[0]!
    const last = members.at(-1)!
    // Keep offscreen annotations in the linked snapshot until their pages
    // mount. They cannot be interpreted as DOM ranges without anchors.
    if (
      !getSelectionSegments(first.start.selectionId, root)?.length ||
      !getSelectionSegments(last.end.selectionId, root)?.length
    )
      return members
    const start = pdfCanonicalEndpointToDom(first.start, 'start', root)
    const end = pdfCanonicalEndpointToDom(last.end, 'end', root)
    if (!start || !end) return []
    const rectsBySelectionId: ReaderSelectionRange['rectsBySelectionId'] = {}
    for (const member of members) {
      for (const [pageId, rects] of Object.entries(member.rectsBySelectionId)) {
        const pageRects = rectsBySelectionId[pageId] ?? []
        rectsBySelectionId[pageId] = [...pageRects, ...rects]
      }
    }
    return [
      {
        ...first,
        start,
        end,
        text: members.map((member) => member.text).join(''),
        rectsBySelectionId
      }
    ]
  })
}

export function pdfCanonicalEndpointToDom(
  endpoint: ReaderSelectionEndpoint,
  side: EndpointSide,
  root: HTMLElement
): ReaderSelectionEndpoint | null {
  const segments = getSelectionSegments(endpoint.selectionId, root)
  const candidates = segments?.filter((segment) =>
    side === 'start'
      ? segment.canonicalStart <= endpoint.offset &&
        endpoint.offset < segment.canonicalEnd
      : segment.canonicalStart < endpoint.offset &&
        endpoint.offset <= segment.canonicalEnd
  )
  const segment = candidates?.[0]
  return segment
    ? {
        ...endpoint,
        offset: segment.domStart + endpoint.offset - segment.canonicalStart
      }
    : null
}

export function restorePdfTextSelection(
  ranges: readonly ReaderSelectionRange[],
  id: string,
  root: HTMLElement
): Range | null {
  const group = getSelectionGroup(ranges, id)
  const first = group[0]
  const last = group.at(-1)
  if (!first || !last) return null
  const start = pdfCanonicalEndpointToDom(first.start, 'start', root)
  const end = pdfCanonicalEndpointToDom(last.end, 'end', root)
  if (!start || !end) return null
  const resolvePoint = (endpoint: ReaderSelectionEndpoint) => {
    const content = root.querySelector(
      `[data-testid="intermediate-text-${endpoint.selectionId}"] .hsn-selection-content`
    )
    if (!content) return null
    const walker = root.ownerDocument.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT
    )
    let offset = endpoint.offset
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (offset <= node.length) return { node, offset }
      offset -= node.length
    }
    return null
  }
  const a = resolvePoint(start)
  const b = resolvePoint(end)
  if (!a || !b) return null
  const native = root.ownerDocument.createRange()
  native.setStart(a.node, a.offset)
  native.setEnd(b.node, b.offset)
  const selection = root.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(native)
  return native
}

export function canonicalizePdfSelectionRange(
  range: ReaderSelectionRange,
  root: HTMLElement | null,
  canonicalText?: string
): ReaderSelectionRange | null {
  if (!root) return range

  if (range.start.selectionId === range.end.selectionId) {
    const segments = getSelectionSegments(range.start.selectionId, root)
    if (
      segments &&
      !isContinuousCanonicalRange(
        segments,
        range.start.offset,
        range.end.offset,
        canonicalText
      )
    ) {
      return null
    }
  }

  const start = canonicalizeEndpoint(range.start, 'start', root)
  const end = canonicalizeEndpoint(range.end, 'end', root)
  if (!start || !end) return null
  let text = range.text
  if (start.selectionId === end.selectionId) {
    const domStart = pdfCanonicalEndpointToDom(start, 'start', root)
    const domEnd = pdfCanonicalEndpointToDom(end, 'end', root)
    if (!domStart || !domEnd || start.offset > end.offset) return null
    // Display gaps can represent several omitted source whitespace items.
    // Normalize both boundaries inward and trim the corresponding display
    // whitespace, so saving and restoring describe the same visible text.
    if (
      domStart.offset !== range.start.offset ||
      domEnd.offset !== range.end.offset
    ) {
      const content = root.querySelector(
        `[data-testid="intermediate-text-${start.selectionId}"] .hsn-selection-content`
      )
      text = content?.textContent?.slice(domStart.offset, domEnd.offset) ?? text
    }
  }
  return {
    ...range,
    text,
    start,
    end
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
  domEnd: number,
  canonicalText?: string
): boolean {
  if (domStart > domEnd) return false
  const intersectingSegments = segments.filter(
    (segment) => segment.domEnd > domStart && segment.domStart < domEnd
  )
  return intersectingSegments.every(
    (segment, index) =>
      index === 0 ||
      areCanonicalNeighbors(
        intersectingSegments[index - 1]!.canonicalEnd,
        segment.canonicalStart,
        canonicalText
      )
  )
}

function areCanonicalNeighbors(
  end: number,
  start: number,
  canonicalText: string | undefined
): boolean {
  if (end === start) return true
  // PDF.js can emit whitespace-only items between independently positioned
  // runs. Text layout omits those items and inserts display spacing instead.
  // Bridge only verified source whitespace; reordered or omitted text must
  // remain separate canonical fragments of the same logical highlight.
  return (
    canonicalText !== undefined &&
    end < start &&
    start <= canonicalText.length &&
    /^\s+$/u.test(canonicalText.slice(end, start))
  )
}

function canonicalizeEndpoint(
  endpoint: ReaderSelectionEndpoint,
  side: EndpointSide,
  root: HTMLElement
): ReaderSelectionEndpoint | null {
  if (!/^page-[1-9]\d*$/.test(endpoint.selectionId)) return endpoint

  const segments = getSelectionSegments(endpoint.selectionId, root)
  if (!segments) return null

  const canonicalOffset = mapDomOffsetToCanonical(
    segments,
    endpoint.offset,
    side
  )
  return canonicalOffset === null
    ? null
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
        canonicalEnd: canonicalStart + textLength,
        text: anchor.textContent ?? ''
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

  const containingSegment = segments.find((segment) =>
    side === 'start'
      ? segment.domStart <= domOffset && domOffset < segment.domEnd
      : segment.domStart < domOffset && domOffset <= segment.domEnd
  )
  if (containingSegment) {
    return (
      containingSegment.canonicalStart + domOffset - containingSegment.domStart
    )
  }

  if (side === 'start')
    return (
      segments.find((segment) => segment.domStart >= domOffset)
        ?.canonicalStart ?? null
    )
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index]!
    if (segment.domEnd <= domOffset) return segment.canonicalEnd
  }
  return null
}
