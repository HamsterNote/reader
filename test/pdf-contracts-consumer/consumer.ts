import {
  isPdfPageNumber,
  type PdfAdapter,
  type PdfLoadState,
  type PdfPageState,
  type PdfSelection,
  type PdfSessionIdentity,
  type PdfSource
} from '@hamster-note/reader/pdf-contracts'

export function openPdf(adapter: PdfAdapter, source: PdfSource) {
  const identity: PdfSessionIdentity = {
    sessionId: 'rn-consumer',
    generation: 1
  }
  const session = adapter.open(source, identity, {
    onStateChange(state: PdfLoadState) {
      if (state.status === 'ready') {
        const page: PdfPageState = state
        isPdfPageNumber(page.pageNumber, page.pageCount)
      }
    },
    onMetadata() {},
    onPageChange() {},
    onSelectionChange(eventIdentity, selection) {
      const current: PdfSelection | null = selection
      if (current) {
        const coordinateSpace: 'reader' = current.coordinateSpace
        return { coordinateSpace, generation: eventIdentity.generation }
      }
      return null
    }
  })
  session.clearSelection()
  session.dispose()
  return {
    session,
    navigate: (page: number) => session.goToPage(page),
    thumbnail: (page: number) => session.getThumbnail(page)
  }
}

// @ts-expect-error All asynchronous selection events require session identity.
export const unboundSelection: PdfSelection = {
  selectionId: 'selection',
  text: 'text',
  rects: [],
  coordinateSpace: 'reader'
}
