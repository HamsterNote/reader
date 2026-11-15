import { afterEach, expect, it, vi } from 'vitest'
import { openReaderDocument } from '../src/host/openReaderDocument'
import { PdfDocumentSession } from '../src/pdf/pdfDocumentSession'
import { createPdfTextModeDocument } from '../src/pdf/pdfTextModeDocument'
import {
  attachPdfLoadDiagnostics,
  createPdfLoadDiagnostics
} from '../src/pdf/pdfLoadDiagnostics'

vi.mock('../src/pdf/pdfDocumentSession', () => ({
  PdfDocumentSession: { open: vi.fn() }
}))
vi.mock('../src/pdf/pdfTextModeDocument', () => ({
  createPdfTextModeDocument: vi.fn()
}))

afterEach(() => vi.restoreAllMocks())

it.each([false, true])(
  'reports metadata completion only after it succeeds (failure=%s)',
  async (fail) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const lines: string[] = []
    const source = { format: 'pdf' as const, data: new Uint8Array([1]) }
    attachPdfLoadDiagnostics(
      source,
      createPdfLoadDiagnostics((line) => lines.push(line))
    )
    const stages = () =>
      lines.map(
        (line) => JSON.parse(line.slice('reader-pdf-load '.length)).stage
      )
    const dispose = vi.fn(async () => {})
    vi.mocked(PdfDocumentSession.open).mockResolvedValue({
      document: { numPages: 200 },
      dispose
    } as unknown as PdfDocumentSession)
    let finish!: () => void
    let reject!: (error: Error) => void
    const document = { id: 'test' }
    vi.mocked(createPdfTextModeDocument).mockReturnValue(
      new Promise((resolve, fail) => {
        finish = () =>
          resolve({ document } as unknown as Awaited<
            ReturnType<typeof createPdfTextModeDocument>
          >)
        reject = fail
      })
    )
    const pending = openReaderDocument(source, 'test')
    await Promise.resolve()
    expect(stages()).toEqual([
      'pdf-open-start',
      'pdf-open-complete',
      'metadata-start'
    ])
    if (fail) {
      reject(new Error('metadata failed'))
      await expect(pending).rejects.toThrow('metadata failed')
      expect(stages()).not.toContain('metadata-complete')
      expect(dispose).toHaveBeenCalledOnce()
    } else {
      finish()
      const opened = await pending
      expect(stages().at(-1)).toBe('metadata-complete')
      expect(opened.document).toBe(document)
      expect(dispose).not.toHaveBeenCalled()
      await opened.dispose()
      expect(dispose).toHaveBeenCalledOnce()
    }
    expect(source.data).toEqual(new Uint8Array([1]))
  }
)
