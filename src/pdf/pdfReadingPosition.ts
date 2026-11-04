import type { ReaderTextAnchor } from '../types/readerData'
import { canonicalRangeToDomRange } from './pdfTextMapping'
import type { PdfPageSelectionContext } from './pdfSelectionSerializer'

export type ReadingRect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>
export type PdfReadingPage = Pick<
  PdfPageSelectionContext,
  'pageNumber' | 'canonical' | 'textLayerDiv' | 'pageDiv'
>

export function intersects(a: ReadingRect, b: ReadingRect) {
  return (
    a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right
  )
}

function* visibleCharacters(
  context: PdfReadingPage,
  clip: ReadingRect,
  firstTop: () => number
) {
  for (const element of context.textLayerDiv.querySelectorAll<HTMLElement>(
    '[data-selection-start-offset][data-text-id]'
  )) {
    const bounds = element.getBoundingClientRect()
    if (!intersects(bounds, clip) || bounds.top > firstTop() + 0.5) continue
    const start = Number(element.dataset.selectionStartOffset)
    const sourceSpan = context.canonical.spans.find(
      (span) => span.canonicalStart === start && span.canonicalText !== ''
    )
    const text = sourceSpan?.canonicalText ?? ''
    for (let local = 0; local < text.length; local++) {
      if (!text[local]?.trim()) continue
      const range = canonicalRangeToDomRange(
        context.canonical,
        start + local,
        start + local + 1,
        context.textLayerDiv
      )
      const rect = range?.getClientRects?.()[0]
      if (rect && intersects(rect, clip))
        yield {
          top: rect.top,
          anchor: {
            pageNumber: context.pageNumber,
            textId: element.dataset.textId!,
            offset: start + local,
            text: context.canonical.text.slice(
              start + local,
              start + local + 80
            )
          }
        }
    }
  }
}

/** PDF.js has no API for a reader's safe first source character. Inspect its
 * actual character geometry, retaining canonical offsets through rotation. */
export function firstVisiblePdfCharacter(
  contexts: readonly PdfReadingPage[],
  viewport: ReadingRect,
  pageClip: (context: PdfReadingPage) => ReadingRect = (context) =>
    context.pageDiv.getBoundingClientRect()
): ReaderTextAnchor | null {
  let first: { anchor: ReaderTextAnchor; top: number } | undefined
  for (const context of contexts) {
    const page = pageClip(context)
    const clip = {
      top: Math.max(page.top, viewport.top),
      bottom: Math.min(page.bottom, viewport.bottom),
      left: Math.max(page.left, viewport.left),
      right: Math.min(page.right, viewport.right)
    }
    for (const candidate of visibleCharacters(
      context,
      clip,
      () => first?.top ?? Infinity
    )) {
      // Same visual line uses source reading order, not screen x order.
      if (!first || candidate.top < first.top - 0.5) first = candidate
    }
  }
  return first?.anchor ?? null
}
