import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import type { SerializedSelection } from '../../epub/epubCompatIndex'
import {
  getPageContentEntries,
  isIntermediateText
} from '../IntermediateDocumentViewer/IntermediateDocumentViewer'
import type { ReaderSelectedTextSegment } from './selectionPayloadSerializer'

export async function engineSelectionSegments(
  document: IntermediateDocument | IntermediateDocumentSerialized,
  detail: SerializedSelection,
  ocrTexts?: Readonly<Record<number, readonly IntermediateText[]>>
) {
  const segments: ReaderSelectedTextSegment[] = []
  const texts: IntermediateText[] = []
  const startPage = Number(detail.start.selectionId.slice(5))
  const endPage = Number(detail.end.selectionId.slice(5))
  const pages = (await document.pages).filter(
    (entry) => entry.number >= startPage && entry.number <= endPage
  )
  for (const page of pages) {
    let offset = 0
    for (const text of [
      ...(await getPageContentEntries(page)).filter(isIntermediateText),
      ...(ocrTexts?.[page.number] ?? [])
    ]) {
      const start = Math.max(
        0,
        page.number === startPage ? detail.start.offset - offset : 0
      )
      const finish = Math.min(
        text.content.length,
        page.number === endPage
          ? detail.end.offset - offset
          : text.content.length
      )
      offset += text.content.length
      if (start >= finish) continue
      texts.push(text)
      segments.push({
        ...text,
        pageNumber: page.number,
        selectedText: text.content.slice(start, finish),
        startCharIndex: start,
        endCharIndex: finish
      })
    }
  }
  return { texts, segments }
}
