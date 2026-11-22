import { PDFDocument, PDFString } from 'pdf-lib'
import { PDFDataRangeTransport } from 'pdfjs-dist'
import { PdfDocumentSession } from '../../src/pdf/pdfDocumentSession'

export async function pdfWithIsolatedContents() {
  const doc = await PDFDocument.create()
  doc.addPage()
  const page = doc.addPage()
  // Keep page two's content outside both the initial bytes and the xref range.
  const padding = PDFString.of(' '.repeat(3 * 65536))
  doc.context.register(padding)
  page.drawText('Range read')
  doc.context.register(padding)
  return doc.save({ useObjectStreams: false })
}

// Run the same range failure against the Node fallback and a browser worker.
export async function readBrokenOperatorList(concurrent: boolean) {
  const bytes = await pdfWithIsolatedContents()
  const error = new Error('page two content range unavailable')
  let failReads = false
  let aborts = 0
  class Range extends PDFDataRangeTransport {
    private reject!: (reason: Error) => void
    readonly failure = new Promise<never>((_, reject) => {
      this.reject = reject
    })
    override requestDataRange(begin: number, end: number) {
      if (failReads) this.reject(error)
      else
        queueMicrotask(() => this.onDataRange(begin, bytes.slice(begin, end)))
    }
    override abort() {
      aborts++
    }
  }
  const session = await PdfDocumentSession.open(
    {
      createRange: () => new Range(bytes.length, bytes.slice(0, 128), true)
    },
    { documentOptions: { disableStream: true, disableAutoFetch: true } }
  )
  try {
    const page = await session.document.getPage(2)
    failReads = true
    const reads: Promise<unknown>[] = [page.getOperatorList()]
    if (concurrent)
      reads.push(
        page.getOperatorList({ intent: 'print' }),
        session.document.getDownloadInfo()
      )
    const results = await Promise.allSettled(reads)
    // A retry for the failed intent must never return a cached partial list.
    results.push(...(await Promise.allSettled([page.getOperatorList()])))
    await session.dispose()
    return {
      originalErrors: results.filter(
        (r) => r.status === 'rejected' && r.reason === error
      ).length,
      aborts,
      disposed: session.isDisposed
    }
  } finally {
    await session.dispose()
  }
}
