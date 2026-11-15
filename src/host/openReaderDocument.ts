import { IntermediateDocument, TextDir } from '@hamster-note/types'
import { openEpubPackage } from '../epub/epubPackage'
import { buildLegacyEpubModel } from '../epub/legacyEpubModel'
import { configurePdfJsWorker } from '../pdf/pdfjsRuntime'
import { PdfDocumentSession } from '../pdf/pdfDocumentSession'
import { createPdfTextModeDocument } from '../pdf/pdfTextModeDocument'
import { getPdfLoadDiagnostics } from '../pdf/pdfLoadDiagnostics'
import type { ReaderEngineSource } from '../types/engineSource'
import type { PDFDocumentProxy, PDFPageProxy } from '../pdf/pdfjsRuntime'

/** Experimental WebView controls. Normal consumers omit this argument. */
export type ReaderDocumentDiagnostics = {
  readonly signal?: AbortSignal
  readonly loadPdfPages?: (
    document: PDFDocumentProxy
  ) => Promise<PDFPageProxy[]>
  readonly afterPdfOpen?: () => Promise<void>
  readonly afterPdfMetadata?: () => Promise<void>
}

/** Metadata/index facade only. EPUB display is Foliate; PDF display is PDFViewer. */
export async function openReaderDocument(
  source: ReaderEngineSource,
  id: string,
  controls?: ReaderDocumentDiagnostics
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
  const diagnostics = getPdfLoadDiagnostics(source)
  diagnostics?.event('pdf-open-start')
  const session = await PdfDocumentSession.open(
    { data: source.data.slice() },
    {
      documentOptions: source.documentOptions,
      ...(controls?.signal ? { signal: controls.signal } : {})
    }
  )
  diagnostics?.event('pdf-open-complete', {
    pageCount: session.document.numPages
  })
  try {
    if (controls?.afterPdfOpen) await controls.afterPdfOpen()
    controls?.signal?.throwIfAborted()
    diagnostics?.event('metadata-start')
    const facade = controls?.loadPdfPages
      ? await createPdfTextModeDocument(
          session.document,
          id,
          controls.loadPdfPages
        )
      : await createPdfTextModeDocument(session.document, id)
    diagnostics?.event('metadata-complete', {
      pageCount: session.document.numPages
    })
    if (controls?.afterPdfMetadata) await controls.afterPdfMetadata()
    controls?.signal?.throwIfAborted()
    return { document: facade.document, dispose: () => session.dispose() }
  } catch (error) {
    await session.dispose()
    throw error
  }
}
