import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfPreviews } from '../../src/pdf/usePdfPreviews'

function fixture() {
  const cancel = vi.fn()
  const render = vi.fn((_options: { viewport: { height: number } }) => ({
    promise: Promise.resolve(),
    cancel
  }))
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 1800 * scale
    }),
    render
  }))
  return {
    document: { numPages: 50, getPage } as unknown as PDFDocumentProxy,
    getPage,
    render,
    cancel
  }
}
afterEach(() => vi.restoreAllMocks())

describe('shared PDF previews', () => {
  it('yields to body rendering, limits resolution and bounds its cache', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,test'
    )
    const source = fixture()
    let bodyBusy = true
    const { result } = renderHook(() =>
      usePdfPreviews(source.document, true, () => bodyBusy)
    )
    act(() => result.current.onVisibility(1, true))
    expect(source.getPage).not.toHaveBeenCalled()
    bodyBusy = false
    await waitFor(() => expect(result.current.images.has(1)).toBe(true))
    const viewport = source.render.mock.calls[0]?.[0] as unknown as {
      viewport: { height: number }
    }
    expect(viewport.viewport.height).toBe(320)
    expect(result.current.sizes.get(1)).toMatchObject({
      width: 600,
      height: 1800
    })
    for (let page = 2; page <= 27; page++) {
      act(() => {
        result.current.onVisibility(page - 1, false)
        result.current.onVisibility(page, true)
      })
      await waitFor(() => expect(result.current.images.has(page)).toBe(true))
    }
    expect(result.current.images.size).toBeLessThanOrEqual(24)
  })

  it('cancels when closed and ignores late results from an old document', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'old-document'
    )
    const first = fixture()
    const second = fixture()
    let finish!: () => void
    first.render.mockImplementation(() => ({
      promise: new Promise<void>((resolve) => {
        finish = resolve
      }),
      cancel: first.cancel
    }))
    const { result, rerender } = renderHook(
      ({ document, open }) => usePdfPreviews(document, open, () => false),
      {
        initialProps: { document: first.document, open: true }
      }
    )
    act(() => result.current.onVisibility(1, true))
    await waitFor(() => expect(first.render).toHaveBeenCalled())
    rerender({ document: first.document, open: false })
    expect(first.cancel).toHaveBeenCalled()
    expect(result.current.images.size).toBe(0)
    rerender({ document: second.document, open: true })
    await act(async () => {
      finish()
    })
    await waitFor(() => expect(second.render).toHaveBeenCalled())
    expect(result.current.errors.size).toBe(0)
  })

  it('exposes failure and can retry without reopening the PDF', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'recovered'
    )
    const source = fixture()
    source.getPage.mockRejectedValueOnce(new Error('transient failure'))
    const { result } = renderHook(() =>
      usePdfPreviews(source.document, true, () => false)
    )
    act(() => result.current.onVisibility(4, true))
    await waitFor(() => expect(result.current.errors.has(4)).toBe(true))
    act(() => result.current.retryPreview())
    await waitFor(() => expect(result.current.images.get(4)).toBe('recovered'))
    expect(result.current.errors.size).toBe(0)
  })
})
