import { IntermediateDocument } from '@hamster-note/types'
import { openEpubPackage } from '../epub/epubPackage'
import { buildLegacyEpubModel } from '../epub/legacyEpubModel'
import { PdfDocumentSession } from '../pdf/pdfDocumentSession'
import { createPdfTextModeDocument } from '../pdf/pdfTextModeDocument'
import type { ReaderEngineSource } from '../types/engineSource'

/** Metadata/index facade only. EPUB display is Foliate; PDF display is PDFViewer. */
export async function openReaderDocument(
  source: ReaderEngineSource,
  id: string
) {
  if (source.format === 'epub') {
    const pkg = await openEpubPackage(source.data)
    try {
      const model = await buildLegacyEpubModel(pkg)
      return {
        document: IntermediateDocument.parse({
          id,
          title: model.title ?? 'EPUB',
          pages: model.pages.map((page) => ({
            id: page.pageId,
            number: page.pageNumber,
            width: 600,
            height: 800
          }))
        }),
        dispose: async () => undefined
      }
    } finally {
      await pkg.destroy()
    }
  }
  const session = await PdfDocumentSession.open(
    { data: source.data.slice() },
    { documentOptions: source.documentOptions }
  )
  try {
    const facade = await createPdfTextModeDocument(session.document, id)
    return { document: facade.document, dispose: () => session.dispose() }
  } catch (error) {
    await session.dispose()
    throw error
  }
}
