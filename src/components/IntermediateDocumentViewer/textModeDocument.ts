import type { ReaderSelectionRange } from '../../types/selection'
import { isIntermediateText } from './intermediateContent'
import { getRuntimeDocument, type ReaderDocumentInput } from './runtimeDocument'

const PAGE_SELECTION_ID_PATTERN = /^page-(\d+)$/

export type TextModePageRange = {
  readonly start: number
  readonly end: number
}

export type TextModePage = {
  readonly pageNumber: number
  readonly selectionId: string
  readonly text: string
}

export type TextModeHighlightInput = Omit<
  ReaderSelectionRange,
  'text' | 'rectsBySelectionId'
>

export type TextModeHighlightUpdate = Pick<
  ReaderSelectionRange,
  'markerStyle' | 'selectionStyle' | 'overlayRectType'
>

export type CreateTextModeDocumentOptions = {
  readonly highlights?: readonly ReaderSelectionRange[]
  readonly onHighlightsChange?: (
    highlights: readonly ReaderSelectionRange[]
  ) => void
}

export interface TextModeDocument {
  readonly pageCount: number
  readonly pageNumbers: readonly number[]
  getPages(range: TextModePageRange): Promise<readonly TextModePage[]>
  getHighlights(): readonly ReaderSelectionRange[]
  addHighlight(input: TextModeHighlightInput): Promise<ReaderSelectionRange>
  updateHighlight(
    id: string,
    update: TextModeHighlightUpdate
  ): ReaderSelectionRange | undefined
  removeHighlight(id: string): boolean
}

const parsePageNumber = (selectionId: string): number => {
  const match = PAGE_SELECTION_ID_PATTERN.exec(selectionId)
  const pageNumber = match?.[1] ? Number(match[1]) : Number.NaN
  if (
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    selectionId !== `page-${pageNumber}`
  ) {
    throw new RangeError(`Invalid Text Mode selection ID: ${selectionId}`)
  }
  return pageNumber
}

const cloneHighlight = (range: ReaderSelectionRange): ReaderSelectionRange => ({
  ...range,
  start: { ...range.start },
  end: { ...range.end },
  rectsBySelectionId: Object.fromEntries(
    Object.entries(range.rectsBySelectionId).map(([selectionId, rects]) => [
      selectionId,
      rects.map((rect) => ({ ...rect }))
    ])
  ),
  markerStyle: range.markerStyle ? { ...range.markerStyle } : undefined,
  selectionStyle: range.selectionStyle ? { ...range.selectionStyle } : undefined
})

const cloneHighlightInput = (
  input: TextModeHighlightInput
): TextModeHighlightInput => ({
  ...input,
  start: { ...input.start },
  end: { ...input.end },
  markerStyle: input.markerStyle ? { ...input.markerStyle } : undefined,
  selectionStyle: input.selectionStyle ? { ...input.selectionStyle } : undefined
})

const requireOffset = (offset: number): void => {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('Highlight offset must be a non-negative safe integer')
  }
}

export function createTextModeDocument(
  inputDocument: ReaderDocumentInput,
  options: CreateTextModeDocumentOptions = {}
): TextModeDocument | null {
  const document = getRuntimeDocument(inputDocument)
  if (!document) return null

  const pageNumbers = [...document.pageNumbers].sort(
    (left, right) => left - right
  )
  const pageNumberIndexes = new Map(
    pageNumbers.map((pageNumber, index) => [pageNumber, index])
  )
  let highlights = (options.highlights ?? []).map(cloneHighlight)
  const pendingHighlightIds = new Set<string>()
  const loadPage = async (pageNumber: number): Promise<TextModePage> => {
    const pagePromise = document.getPageByPageNumber(pageNumber)
    if (!pagePromise) throw new RangeError(`Page ${pageNumber} does not exist`)

    const content = await (await pagePromise).getContent()
    return {
      pageNumber,
      selectionId: `page-${pageNumber}`,
      text: content
        .filter(isIntermediateText)
        .map((entry) => entry.content)
        .join('')
    }
  }
  const notifyHighlightsChange = () => {
    options.onHighlightsChange?.(highlights.map(cloneHighlight))
  }

  return {
    pageCount: document.pageCount,
    pageNumbers,
    async getPages(range) {
      if (
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 1 ||
        range.end < range.start
      ) {
        throw new RangeError(
          `Invalid Text Mode page range: ${range.start}-${range.end}`
        )
      }

      return Promise.all(
        pageNumbers
          .filter(
            (pageNumber) => pageNumber >= range.start && pageNumber <= range.end
          )
          .map(loadPage)
      )
    },
    getHighlights: () => highlights.map(cloneHighlight),
    async addHighlight(input) {
      const snapshot = cloneHighlightInput(input)
      if (
        highlights.some((item) => item.id === snapshot.id) ||
        pendingHighlightIds.has(snapshot.id)
      ) {
        throw new Error(`Highlight ${snapshot.id} already exists`)
      }
      pendingHighlightIds.add(snapshot.id)

      try {
        const startPage = parsePageNumber(snapshot.start.selectionId)
        const endPage = parsePageNumber(snapshot.end.selectionId)
        const startPageIndex = pageNumberIndexes.get(startPage)
        const endPageIndex = pageNumberIndexes.get(endPage)
        if (startPageIndex === undefined || endPageIndex === undefined) {
          throw new RangeError(
            'Highlight selection ID references a missing page'
          )
        }
        if (startPageIndex > endPageIndex) {
          throw new RangeError('Highlight start must not follow its end')
        }
        requireOffset(snapshot.start.offset)
        requireOffset(snapshot.end.offset)

        const pages = await Promise.all(
          pageNumbers.slice(startPageIndex, endPageIndex + 1).map(loadPage)
        )
        const firstPage = pages[0]
        const lastPage = pages.at(-1)
        if (
          startPage === endPage &&
          snapshot.start.offset === snapshot.end.offset
        ) {
          throw new RangeError('Highlight range must not be empty')
        }
        if (
          !firstPage ||
          !lastPage ||
          snapshot.start.offset > firstPage.text.length ||
          snapshot.end.offset > lastPage.text.length ||
          (startPage === endPage && snapshot.start.offset > snapshot.end.offset)
        ) {
          throw new RangeError(
            'Highlight offsets are outside the selected text'
          )
        }

        const text = pages
          .map((page, index) => {
            const start = index === 0 ? snapshot.start.offset : 0
            const end =
              index === pages.length - 1 ? snapshot.end.offset : undefined
            return page.text.slice(start, end)
          })
          .join('')
        if (text.length === 0) {
          throw new RangeError('Highlight range must not be empty')
        }
        const highlight = cloneHighlight({
          ...snapshot,
          text,
          rectsBySelectionId: {}
        })
        highlights = [...highlights, highlight]
        notifyHighlightsChange()
        return cloneHighlight(highlight)
      } finally {
        pendingHighlightIds.delete(snapshot.id)
      }
    },
    updateHighlight(id, update) {
      const current = highlights.find((item) => item.id === id)
      if (!current) return undefined

      const updated = cloneHighlight({ ...current, ...update })
      highlights = highlights.map((item) => (item.id === id ? updated : item))
      notifyHighlightsChange()
      return cloneHighlight(updated)
    },
    removeHighlight(id) {
      if (!highlights.some((item) => item.id === id)) return false
      highlights = highlights.filter((item) => item.id !== id)
      notifyHighlightsChange()
      return true
    }
  }
}
