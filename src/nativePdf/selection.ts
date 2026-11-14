import type {
  ReaderSelectionEndpoint,
  ReaderSelectionRange
} from '../types/selection'
import type { PdfCanonicalPage } from './contracts'
import {
  TEXT_HANDLE_SIZE_PX,
  TEXT_LENS_RADIUS_PX,
  TEXT_LENS_DISTANCE_PX,
  TEXT_LENS_MAGNIFICATION,
  TEXT_LENS_MARKER_WIDTH_PX
} from '../components/IntermediateDocumentViewer/selectionInteraction'
export const nativeSelectionConfiguration = {
  handleSize: TEXT_HANDLE_SIZE_PX,
  hitSize: TEXT_HANDLE_SIZE_PX * 2,
  lensRadius: TEXT_LENS_RADIUS_PX,
  lensDistance: TEXT_LENS_DISTANCE_PX,
  magnification: TEXT_LENS_MAGNIFICATION,
  markerWidth: TEXT_LENS_MARKER_WIDTH_PX
} as const
export const endpointPage = (e: ReaderSelectionEndpoint): number =>
  Number(/^page-([1-9]\d*)$/.exec(e.selectionId)?.[1])

/** Overlay host-side canonical pages carried with a native selection. */
export function mergeNativeSelectionPages(
  target: Map<number, PdfCanonicalPage>,
  supplied: readonly PdfCanonicalPage[]
): void {
  for (const page of supplied) target.set(page.pageNumber, page)
}

export function nativeSelectionPagesReady(
  pages: ReadonlyMap<number, PdfCanonicalPage>,
  required: readonly number[]
): boolean {
  return required.every((pageNumber) => Boolean(pages.get(pageNumber)?.text.length))
}
export function compareEndpoints(
  a: ReaderSelectionEndpoint,
  b: ReaderSelectionEndpoint
): number {
  return endpointPage(a) - endpointPage(b) || a.offset - b.offset
}
/** Reject missing intermediate mappings rather than committing partial text. */
export function materializeNativeRange(
  a: ReaderSelectionEndpoint,
  b: ReaderSelectionEndpoint,
  pages: ReadonlyMap<number, PdfCanonicalPage>,
  allowed: readonly number[],
  metadata: { id: string; createdAt: number; color: string },
  existing?: ReaderSelectionRange
): ReaderSelectionRange {
  console.info('reader-pdf-materialize-input', {
    start: a,
    end: b,
    pageCount: pages.size,
    pages: Array.from(pages.keys()),
    allowed,
    existingId: existing?.id
  })
  const [start, end] = compareEndpoints(a, b) <= 0 ? [a, b] : [b, a]
  const first = endpointPage(start),
    last = endpointPage(end)
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(last) ||
    !allowed.includes(first) ||
    !allowed.includes(last)
  )
    {
      console.info('reader-pdf-materialize-failure', { reason: 'invalid-target', first, last })
      throw new Error('INVALID_TARGET')
    }
  const selected = allowed.filter((n) => n >= first && n <= last)
  const rectsBySelectionId: ReaderSelectionRange['rectsBySelectionId'] = {}
  let text = ''
  for (const n of selected) {
    const p = pages.get(n)
    const from = n === first ? start.offset : 0,
      to = n === last ? end.offset : p?.text.length
    if (!p) {
      console.info('reader-pdf-materialize-failure', { reason: 'page-text-missing', page: n })
      throw new Error('MAPPING_NOT_READY')
    }
    if (to === undefined || !Number.isInteger(from) || !Number.isInteger(to)) {
      console.info('reader-pdf-materialize-failure', { reason: 'metrics-not-ready', page: n, from, to })
      throw new Error('MAPPING_NOT_READY')
    }
    if (
      from < 0 ||
      to < from ||
      to > p.text.length ||
      !p.boundaries.some((v) => v.offset === from) ||
      !p.boundaries.some((v) => v.offset === to)
    ) {
      console.info('reader-pdf-materialize-failure', {
        reason: 'offset-out-of-range',
        page: n,
        from,
        to,
        utf16: p.text.length,
        boundaries: p.boundaries.length
      })
      throw new Error('MAPPING_NOT_READY')
    }
    text += p.text.slice(from, to)
    rectsBySelectionId[`page-${n}`] = p.glyphs
      .filter((g) => g.end > from && g.start < to)
      .map((g) =>
        existing?.overlayRectType === 'percent'
          ? {
              x: (g.rect.x / p.width) * 100,
              y: (g.rect.y / p.height) * 100,
              width: (g.rect.width / p.width) * 100,
              height: (g.rect.height / p.height) * 100
            }
          : { ...g.rect }
      )
  }
  if (!text.length) {
    console.info('reader-pdf-materialize-failure', { reason: 'empty-text' })
    throw new Error('MAPPING_NOT_READY')
  }
  const result = {
    ...existing,
    id: existing?.id ?? metadata.id,
    createdAt: existing?.createdAt ?? metadata.createdAt,
    start,
    end,
    text,
    rectsBySelectionId,
    overlayRectType: existing?.overlayRectType ?? 'px',
    markerStyle: { ...existing?.markerStyle, backgroundColor: metadata.color }
  }
  console.info('reader-pdf-materialize-result', {
    id: result.id,
    start: result.start,
    end: result.end,
    textLength: result.text.length,
    rectPages: Object.keys(result.rectsBySelectionId)
  })
  return result
}
