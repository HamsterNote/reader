import { IntermediateDocument, TextDir } from '@hamster-note/types'
import { openEpubPackage } from '../epub/epubPackage'
import { buildLegacyEpubModel } from '../epub/legacyEpubModel'
import { configurePdfJsWorker } from '../pdf/pdfjsRuntime'
import { PdfDocumentSession } from '../pdf/pdfDocumentSession'
import { createPdfTextModeDocument } from '../pdf/pdfTextModeDocument'
import type { ReaderEngineSource } from '../types/engineSource'

/** The layout engine owns its own PDF session. Open the text index on demand. */
export async function prepareReaderDocument(
  source: ReaderEngineSource,
  id: string
) {
  if (source.format === 'epub')
    return { source, ...(await openReaderDocument(source, id)) }
  let opened: ReturnType<typeof openReaderDocument> | undefined
  let closed = false
  const loadTextDocument = async () => {
    if (closed) throw new Error('PDF document closed')
    opened ??= openReaderDocument(source, id).catch((error) => {
      opened = undefined
      throw error
    })
    return (await opened).document
  }
  return {
    source: { ...source, loadTextDocument },
    document: IntermediateDocument.parse({ id, title: id, pages: [] }),
    dispose: async () => {
      closed = true
      const handle = await opened?.catch(() => undefined)
      await handle?.dispose()
    }
  }
}

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
            height: 800,
            texts: page.text
              ? [
                  {
                    id: `${page.pageId}-text`,
                    content: page.text,
                    fontSize: 16,
                    fontFamily: '',
                    fontWeight: 400,
                    italic: false,
                    color: '#000000',
                    polygon: [
                      [0, 0],
                      [600, 0],
                      [600, 800],
                      [0, 800]
                    ],
                    lineHeight: 20,
                    ascent: 16,
                    descent: 4,
                    dir: TextDir.LTR,
                    skew: 0,
                    isEOL: false
                  }
                ]
              : []
          }))
        }),
        dispose: async () => undefined
      }
    } finally {
      await pkg.destroy()
    }
  }
  if (source.workerSrc) configurePdfJsWorker(source.workerSrc)
  const session = await PdfDocumentSession.open(source, {
    documentOptions: source.documentOptions
  })
  try {
    const facade = await createPdfTextModeDocument(session.document, id)
    return { document: facade.document, dispose: () => session.dispose() }
  } catch (error) {
    await session.dispose()
    throw error
  }
}
