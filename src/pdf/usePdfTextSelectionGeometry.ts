import type { IntermediateContent, IntermediateText } from '@hamster-note/types'
import { useCallback, useEffect, useRef } from 'react'
import {
  releaseSourceTextGeometry,
  sourceTextGeometry
} from '../components/IntermediateDocumentViewer/sourceTextGeometry'
import type { ReaderEngineSource } from '../types/engineSource'
import { PdfDocumentSession } from './pdfDocumentSession'
import { configurePdfJsWorker } from './pdfjsRuntime'
import { buildCanonicalPageText } from './pdfTextMapping'
import { registerPdfTextSelectionGeometry } from './pdfTextSelectionGeometry'
import { preparePdfTextPageGeometry } from './pdfTextModeDocument'

// Legacy parser documents also need official glyph geometry: their polygons
// can be axis-aligned even when the source PDF page is rotated.
export function usePdfTextSelectionGeometry(
  source: ReaderEngineSource | undefined,
  getContent: (page: unknown) => Promise<IntermediateContent[]>
) {
  const stateRef = useRef<{
    source: ReaderEngineSource | undefined
    session?: Promise<PdfDocumentSession>
    closed: boolean
  } | null>(null)
  useEffect(() => {
    const state: NonNullable<typeof stateRef.current> = {
      source,
      closed: false
    }
    stateRef.current = state
    return () => {
      state.closed = true
      stateRef.current = null
      state.session?.then(
        (session) => session.dispose(),
        () => {}
      )
    }
  }, [source])

  return useCallback(
    async (page: unknown) => {
      const content = await getContent(page)
      const texts = content.filter(
        (item): item is IntermediateText =>
          'content' in item &&
          typeof item.content === 'string' &&
          item.content !== ''
      )
      const state = stateRef.current
      if (
        !state ||
        state.closed ||
        state.source !== source ||
        texts.every((text) => sourceTextGeometry.has(text))
      )
        return content
      const preparation = preparePdfTextPageGeometry(page)
      if (preparation) {
        await preparation
        if (state.closed) releaseSourceTextGeometry(texts)
        return content
      }
      if (
        state.source?.format !== 'pdf' ||
        typeof page !== 'object' ||
        page === null ||
        !('number' in page) ||
        typeof page.number !== 'number'
      )
        return content
      if (!state.session) {
        if (state.source.workerSrc) configurePdfJsWorker(state.source.workerSrc)
        state.session = PdfDocumentSession.open(
          { data: state.source.data.slice() },
          { documentOptions: state.source.documentOptions }
        ).catch((error) => {
          state.session = undefined
          throw error
        })
      }
      const session = await state.session
      if (state.closed) return content
      const pdfPage = await session.document.getPage(page.number)
      const textContent = await pdfPage.getTextContent()
      const canonical = buildCanonicalPageText(
        page.number,
        textContent.items.filter((item) => 'str' in item)
      )
      if (texts.map((text) => text.content).join('') !== canonical.text)
        return content
      await registerPdfTextSelectionGeometry(
        texts,
        canonical,
        textContent,
        pdfPage.getViewport({ scale: 1 })
      )
      if (state.closed) releaseSourceTextGeometry(texts)
      return content
    },
    [getContent, source]
  )
}
