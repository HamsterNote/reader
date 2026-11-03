import type {
  IntermediateDocument,
  IntermediateText
} from '@hamster-note/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IntermediateDocumentTextViewer } from '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import { mockElementSize, resizeObserverMock } from './setup'

function documentFixture(id: string, count = 100) {
  const loaders = Array.from({ length: count }, (_, index) =>
    vi.fn(async () => [
      {
        id: `${id}-${index + 1}`,
        content: `${id} page ${index + 1}`,
        fontSize: 12,
        polygon: [
          [0, 0],
          [100, 0],
          [100, 20],
          [0, 20]
        ],
        fontFamily: 'serif',
        fontWeight: 400,
        color: '#111',
        lineHeight: 18,
        ascent: 12,
        descent: 3,
        dir: 'ltr',
        skew: 0,
        isEOL: false
      } as IntermediateText
    ])
  )
  const document = {
    id,
    title: id,
    pageCount: count,
    pageNumbers: Array.from({ length: count }, (_, index) => index + 1),
    getPageSizeByPageNumber: () => ({ x: 300, y: 400 }),
    getPageByPageNumber: (page: number) =>
      Promise.resolve({ getContent: loaders[page - 1] })
  } as unknown as IntermediateDocument
  return { document, loaders }
}
function sizeRoot() {
  const root = screen.getByTestId('intermediate-document-text-viewer')
  mockElementSize(root, { width: 600, height: 400 })
  resizeObserverMock.trigger(root)
}

describe('PDF Text viewer integration', () => {
  it('bounds extraction around the restored target, evicts, retries, and skips hidden/out-of-range pages', async () => {
    const fixture = documentFixture('large')
    const onProgress = vi.fn()
    const props = {
      document: fixture.document,
      isPdf: true,
      pagePreloadRadius: 3,
      maxLoadedPages: 2,
      textReadingProgress: { currentPageNumber: 50 },
      pageRange: { start: 40, end: 80 },
      hiddenPages: [51],
      onTextReadingProgressChange: onProgress
    }
    const { rerender } = render(<IntermediateDocumentTextViewer {...props} />)
    sizeRoot()
    await waitFor(() =>
      expect(screen.getByText('large page 50')).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
    )
    expect(
      fixture.loaders.filter((loader) => loader.mock.calls.length)
    ).toHaveLength(2)
    expect(fixture.loaders[0]).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() =>
      expect(screen.getByText('large page 52')).toBeInTheDocument()
    )
    expect(fixture.loaders[50]).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(onProgress).toHaveBeenLastCalledWith({ currentPageNumber: 52 })
    )
    const page49Calls = fixture.loaders[48].mock.calls.length
    fixture.loaders[69].mockRejectedValueOnce(
      new Error('temporary extraction failure')
    )
    onProgress.mockClear()
    rerender(
      <IntermediateDocumentTextViewer
        {...props}
        textReadingProgress={{ currentPageNumber: 70 }}
      />
    )
    await screen.findByRole('alert')
    expect(onProgress).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() =>
      expect(screen.getByText('large page 70')).toBeInTheDocument()
    )
    expect(fixture.loaders[69]).toHaveBeenCalledTimes(2)
    rerender(
      <IntermediateDocumentTextViewer
        {...props}
        textReadingProgress={{ currentPageNumber: 49 }}
      />
    )
    await waitFor(() =>
      expect(screen.getByText('large page 49')).toBeInTheDocument()
    )
    expect(fixture.loaders[48].mock.calls.length).toBeGreaterThan(page49Calls)
  })

  it('keeps each page of a scanned document as one empty screen with a Layout action', async () => {
    const fixture = documentFixture('scan', 3)
    fixture.loaders.forEach((loader) => loader.mockResolvedValue([]))
    const onRequestLayout = vi.fn()
    const onProgress = vi.fn()
    render(
      <IntermediateDocumentTextViewer
        document={fixture.document}
        isPdf
        onRequestLayout={onRequestLayout}
        onTextReadingProgressChange={onProgress}
      />
    )
    sizeRoot()
    await screen.findByText('第 1 页没有可提取的文字')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
    )
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('第 2 页没有可提取的文字')
    fireEvent.click(screen.getByRole('button', { name: '返回 Layout' }))
    expect(onRequestLayout).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(onProgress).toHaveBeenLastCalledWith({ currentPageNumber: 2 })
    )
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('第 3 页没有可提取的文字')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    )
    expect(onProgress).toHaveBeenLastCalledWith({ currentPageNumber: 3 })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores an old extraction failure after replacing the document', async () => {
    const first = documentFixture('A', 1)
    const second = documentFixture('B', 1)
    let reject!: (error: Error) => void
    first.loaders[0].mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail
        })
    )
    const progress = vi.fn()
    const { rerender } = render(
      <IntermediateDocumentTextViewer
        document={first.document}
        isPdf
        onTextReadingProgressChange={progress}
      />
    )
    sizeRoot()
    await waitFor(() => expect(first.loaders[0]).toHaveBeenCalled())
    rerender(
      <IntermediateDocumentTextViewer
        document={second.document}
        isPdf
        onTextReadingProgressChange={progress}
      />
    )
    await waitFor(() =>
      expect(screen.getByText('B page 1')).toBeInTheDocument()
    )
    await act(async () => reject(new Error('old A failure')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('A page 1')).toBeNull()
    expect(progress).not.toHaveBeenCalled()
  })
})
