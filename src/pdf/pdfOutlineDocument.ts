import type { ReaderEngineSource } from '../types/engineSource'
import { PdfDocumentSession } from './pdfDocumentSession'
import { configurePdfJsWorker } from './pdfjsRuntime'
import type { PDFDocumentProxy } from './pdfjsRuntime'

export type PdfOutlineDocumentHandle = {
  readonly document: PDFDocumentProxy
  dispose(): Promise<void>
}

/**
 * 文字模式没有布局视图提供的 PDF.js 文档，目录页跳转仍需要原始 PDF
 * 文档（dest / getPageIndex / 页面文字）。宿主未提供 loadPdfDocument 时，
 * 这里按同一份 source 自行打开一个会话，由调用方负责销毁。
 */
export async function openPdfOutlineDocument(
  source: ReaderEngineSource,
  options: { readonly signal?: AbortSignal } = {}
): Promise<PdfOutlineDocumentHandle> {
  if (source.format !== 'pdf') {
    throw new Error('PDF outline requires a PDF source')
  }
  if (source.workerSrc) configurePdfJsWorker(source.workerSrc)
  const session = await PdfDocumentSession.open(source, {
    documentOptions: source.documentOptions,
    signal: options.signal
  })
  return {
    document: session.document,
    dispose: () => session.dispose()
  }
}
