import type { ReaderTextAnchor } from '../types/readerData'

export type PdfTextColumn = {
  readonly index: number
  readonly anchor?: ReaderTextAnchor
}
export const PDF_TEXT_COLUMN_GAP = 24

/** Source offsets are carried by spans, never inferred from display whitespace. */
function characterRange(element: HTMLElement, offset: number) {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT
  )
  let remaining = offset
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (remaining < node.length) {
      const range = element.ownerDocument.createRange()
      range.setStart(node, remaining)
      range.setEnd(node, remaining + 1)
      return range
    }
    remaining -= node.length
  }
  return null
}

function columnOf(rect: DOMRect, left: number, step: number) {
  return Math.max(0, Math.floor((rect.left - left + 0.5) / step))
}

function firstCharacter(
  element: HTMLElement,
  column: number,
  left: number,
  step: number
) {
  let low = 0
  let high = element.textContent?.length ?? 0
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const rect = characterRange(element, middle)?.getClientRects()[0]
    if (!rect || columnOf(rect, left, step) < column) low = middle + 1
    else high = middle
  }
  return low
}

/** Inspect actual line fragments, including spans split between CSS columns.
 * Trailing margins and scrollWidth are deliberately not used to count pages. */
export function measurePdfTextColumns(
  content: HTMLElement,
  pageNumber: number,
  width: number
): PdfTextColumn[] {
  const left = content.getBoundingClientRect().left
  const step = width + PDF_TEXT_COLUMN_GAP
  const columns = new Map<
    number,
    { anchor: ReaderTextAnchor; top: number; left: number }
  >()
  content
    .querySelectorAll<HTMLElement>(
      '[data-selection-start-offset][data-text-id]'
    )
    .forEach((element) => {
      const range = content.ownerDocument.createRange()
      range.selectNodeContents(element)
      if (!range.getClientRects) return
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width <= 0 || rect.height <= 0) continue
        const index = columnOf(rect, left, step)
        const previous = columns.get(index)
        if (
          previous &&
          (previous.top < rect.top - 0.5 ||
            (Math.abs(previous.top - rect.top) < 0.5 &&
              previous.left <= rect.left))
        )
          continue
        let localOffset = firstCharacter(element, index, left, step)
        while (
          localOffset < (element.textContent?.length ?? 0) &&
          !element.textContent![localOffset].trim()
        )
          localOffset++
        const firstRect = characterRange(
          element,
          localOffset
        )?.getClientRects()[0]
        if (!firstRect || columnOf(firstRect, left, step) !== index) continue
        const sourceOffset = Number(element.dataset.selectionStartOffset)
        columns.set(index, {
          top: rect.top,
          left: rect.left,
          anchor: {
            pageNumber,
            textId: element.dataset.textId!,
            text: (element.textContent ?? '').slice(
              localOffset,
              localOffset + 80
            ),
            offset: sourceOffset + localOffset
          }
        })
      }
    })
  return columns.size
    ? Array.from(columns, ([index, value]) => ({
        index,
        anchor: value.anchor
      })).sort((a, b) => a.index - b.index)
    : [{ index: 0 }]
}

export function pdfTextAnchorColumn(
  content: HTMLElement,
  anchor: ReaderTextAnchor,
  width: number
): number | null {
  const spans = Array.from(
    content.querySelectorAll<HTMLElement>(
      '[data-selection-start-offset][data-text-id]'
    )
  )
  // Offset identifies a position within a source span, including a span crossing columns.
  const contains = (element: HTMLElement) => {
    const start = Number(element.dataset.selectionStartOffset)
    return (
      start <= anchor.offset &&
      anchor.offset < start + (element.textContent?.length ?? 0)
    )
  }
  const matchingIds = spans.filter(
    (element) => element.dataset.textId === anchor.textId
  )
  const atOffset = matchingIds.length
    ? matchingIds.find(contains)
    : spans.find(contains)
  const element = atOffset
  if (!element) return null
  const offset = atOffset
    ? anchor.offset - Number(element.dataset.selectionStartOffset)
    : 0
  const rect = characterRange(element, offset)?.getClientRects?.()[0]
  return rect
    ? columnOf(
        rect,
        content.getBoundingClientRect().left,
        width + PDF_TEXT_COLUMN_GAP
      )
    : null
}

/** Move one measured screen, then one allowed source page. No wrapping. */
export function pdfTextTurnTarget(
  pages: readonly number[],
  page: number,
  column: number,
  columns: readonly PdfTextColumn[],
  forward: boolean
) {
  const position = columns.findIndex((item) => item.index === column)
  const nextColumn = columns[position + (forward ? 1 : -1)]
  if (nextColumn) return { pageNumber: page, column: nextColumn.index }
  const nextPage = pages[pages.indexOf(page) + (forward ? 1 : -1)]
  return nextPage === undefined
    ? null
    : { pageNumber: nextPage, last: !forward }
}
