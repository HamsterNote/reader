import type { IntermediateText } from '@hamster-note/types'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sourceTextGeometry } from '../src/components/IntermediateDocumentViewer/sourceTextGeometry'
import { PdfDocumentSession } from '../src/pdf/pdfDocumentSession'
import { registerPdfTextSelectionGeometry } from '../src/pdf/pdfTextSelectionGeometry'
import { usePdfTextSelectionGeometry } from '../src/pdf/usePdfTextSelectionGeometry'
import type { ReaderEngineSource } from '../src/types/engineSource'

vi.mock('../src/pdf/pdfDocumentSession', () => ({
  PdfDocumentSession: { open: vi.fn() }
}))
vi.mock('../src/pdf/pdfjsRuntime', () => ({ configurePdfJsWorker: vi.fn() }))
vi.mock('../src/pdf/pdfTextSelectionGeometry', () => ({
  registerPdfTextSelectionGeometry: vi.fn()
}))

const source: ReaderEngineSource = {
  format: 'pdf',
  data: new Uint8Array([1, 2, 3])
}
const makeText = () => ({ content: 'Rotated text' }) as IntermediateText
const makeSession = () => ({
  document: {
    getPage: vi.fn().mockResolvedValue({
      getTextContent: async () => ({
        items: [{ str: 'Rotated text' }],
        styles: {}
      }),
      getViewport: () => ({ width: 300, height: 400 })
    })
  },
  dispose: vi.fn().mockResolvedValue(undefined)
})

describe('PDF text selection source geometry', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens lazily, shares one session across pages, and disposes it on unmount', async () => {
    const session = makeSession()
    vi.mocked(PdfDocumentSession.open).mockResolvedValue(
      session as unknown as PdfDocumentSession
    )
    const text = makeText()
    const { result, unmount } = renderHook(() =>
      usePdfTextSelectionGeometry(source, async () => [text])
    )
    expect(PdfDocumentSession.open).not.toHaveBeenCalled()
    await result.current({ number: 1 })
    await result.current({ number: 2 })
    expect(PdfDocumentSession.open).toHaveBeenCalledTimes(1)
    const supplied = vi.mocked(PdfDocumentSession.open).mock.calls[0][0]
    expect('data' in supplied && supplied.data).toEqual(source.data)
    expect('data' in supplied && supplied.data).not.toBe(source.data)
    expect(registerPdfTextSelectionGeometry).toHaveBeenCalledTimes(2)
    expect(
      vi.mocked(registerPdfTextSelectionGeometry).mock.calls[0][0]
    ).toEqual([text])
    unmount()
    await Promise.resolve()
    expect(session.dispose).toHaveBeenCalledTimes(1)
  })

  it('uses facade geometry without opening a second PDF session', async () => {
    const text = makeText()
    sourceTextGeometry.set(text, () => [])
    const { result } = renderHook(() =>
      usePdfTextSelectionGeometry(source, async () => [text])
    )
    await result.current({ number: 1 })
    expect(PdfDocumentSession.open).not.toHaveBeenCalled()
    expect(registerPdfTextSelectionGeometry).not.toHaveBeenCalled()
  })

  it('disposes a late opening session and does not extract stale pages', async () => {
    const session = makeSession()
    let resolve!: (session: PdfDocumentSession) => void
    vi.mocked(PdfDocumentSession.open).mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const { result, unmount } = renderHook(() =>
      usePdfTextSelectionGeometry(source, async () => [makeText()])
    )
    const pending = result.current({ number: 1 })
    await Promise.resolve()
    unmount()
    resolve(session as unknown as PdfDocumentSession)
    await pending
    expect(session.dispose).toHaveBeenCalledTimes(1)
    expect(session.document.getPage).not.toHaveBeenCalled()
  })

  it('retries session opening after a failed page load', async () => {
    vi.mocked(PdfDocumentSession.open)
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce(makeSession() as unknown as PdfDocumentSession)
    const { result } = renderHook(() =>
      usePdfTextSelectionGeometry(source, async () => [makeText()])
    )
    await expect(result.current({ number: 1 })).rejects.toThrow('load failed')
    await result.current({ number: 1 })
    expect(PdfDocumentSession.open).toHaveBeenCalledTimes(2)
  })
})
