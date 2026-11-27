import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import {
  createPdfOutlineSessionState,
  PdfOutline
} from '../../src/pdf/PdfOutline'

function makeDocument({
  numPages = 4,
  getOutline,
  getDestination,
  getPageIndex,
  getPage
}: {
  readonly numPages?: number
  readonly getOutline: ReturnType<typeof vi.fn>
  readonly getDestination?: ReturnType<typeof vi.fn>
  readonly getPageIndex?: ReturnType<typeof vi.fn>
  readonly getPage?: ReturnType<typeof vi.fn>
}): PDFDocumentProxy {
  return {
    numPages,
    getOutline,
    getDestination: getDestination ?? vi.fn().mockResolvedValue(null),
    getPageIndex:
      getPageIndex ??
      vi.fn().mockImplementation(async (ref: { num: number }) => ref.num - 1),
    ...(getPage ? { getPage } : {})
  } as unknown as PDFDocumentProxy
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('PdfOutline', () => {
  it('retains hierarchy and resolves named, reference and integer destinations', async () => {
    const page1 = { num: 1, gen: 0 }
    const page2 = { num: 2, gen: 0 }
    const page3 = { num: 3, gen: 0 }
    const getOutline = vi.fn().mockResolvedValue([
      {
        title: 'Parent',
        dest: [page1, { name: 'XYZ' }, null, null, null],
        items: [
          { title: 'Named child', dest: 'chapter-three', items: [] },
          { title: 'Index child', dest: [1, { name: 'Fit' }], items: [] }
        ]
      },
      {
        title: 'Explicit reference',
        dest: [page2, { name: 'XYZ' }, null, null, null],
        items: []
      }
    ])
    const getDestination = vi.fn().mockResolvedValue([page3, { name: 'Fit' }])
    const document = makeDocument({ getOutline, getDestination })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive={false}
        pageNumbers={[1, 2, 3, 4]}
        onNavigate={onNavigate}
      />
    )
    expect(getOutline).not.toHaveBeenCalled()

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={[1, 2, 3, 4]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'Parent' })
    expect(getOutline).toHaveBeenCalledOnce()
    expect(getDestination).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Named child' }).closest('ul')
        ?.parentElement?.tagName
    ).toBe('LI')

    fireEvent.click(screen.getByRole('button', { name: 'Parent' }))
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(1))
    fireEvent.click(screen.getByRole('button', { name: 'Named child' }))
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(3))
    expect(getDestination).toHaveBeenCalledWith('chapter-three')
    fireEvent.click(screen.getByRole('button', { name: 'Index child' }))
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(2))
    fireEvent.click(screen.getByRole('button', { name: 'Explicit reference' }))
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(2))

    view.rerender(
      <PdfOutline
        document={document}
        isActive={false}
        pageNumbers={[1, 2, 3, 4]}
        onNavigate={onNavigate}
      />
    )
    view.rerender(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={[1, 2, 3, 4]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'Parent' })
    expect(getOutline).toHaveBeenCalledOnce()
  })

  it('does not navigate malformed, hidden, external or out-of-range targets and keeps valid peers', async () => {
    const hiddenPage = { num: 1, gen: 0 }
    const getOutline = vi.fn().mockResolvedValue([
      { title: 'Hidden', dest: [hiddenPage], items: [] },
      { title: 'Too large', dest: [4], items: [] },
      { title: 'Negative', dest: [-1], items: [] },
      { title: 'Fraction', dest: [1.5], items: [] },
      { title: 'Null target', dest: [null], items: [] },
      { title: 'Missing name', dest: 'missing', items: [] },
      {
        title: 'External',
        dest: null,
        url: 'https://example.com',
        items: []
      },
      { title: 'Other action', dest: [0], action: 'Print', items: [] },
      { title: 'Valid peer', dest: [2], items: [] }
    ])
    const document = makeDocument({ numPages: 3, getOutline })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={[2, 3]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'Valid peer' })
    expect(screen.getByRole('button', { name: 'External' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Other action' })).toBeDisabled()

    for (const title of [
      'Hidden',
      'Too large',
      'Negative',
      'Fraction',
      'Null target',
      'Missing name'
    ]) {
      fireEvent.click(screen.getByRole('button', { name: title }))
      await act(async () => {})
    }
    expect(onNavigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Valid peer' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(3))
  })

  it('distinguishes an empty tree from a failure and retries failed reads', async () => {
    const empty = makeDocument({
      getOutline: vi.fn().mockResolvedValue(null)
    })
    const emptyView = render(
      <PdfOutline
        document={empty}
        isActive
        pageNumbers={[1]}
        onNavigate={vi.fn()}
      />
    )
    expect(
      await screen.findByText('此 PDF 没有内嵌章节目录，可使用页面导航。')
    ).toBeInTheDocument()
    emptyView.unmount()

    const getOutline = vi
      .fn()
      .mockRejectedValueOnce(new Error('broken outline'))
      .mockResolvedValueOnce([{ title: 'Recovered', dest: [0], items: [] }])
    const document = makeDocument({ getOutline })
    render(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={[1]}
        onNavigate={vi.fn()}
      />
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '章节目录读取失败，请重试。'
    )
    expect(screen.queryByText(/没有内嵌章节目录/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(
      await screen.findByRole('button', { name: 'Recovered' })
    ).toBeInTheDocument()
    expect(getOutline).toHaveBeenCalledTimes(2)
  })

  it('highlights the deepest outline target reached by the current page', async () => {
    const getOutline = vi.fn().mockResolvedValue([
      {
        title: 'Chapter 1',
        dest: [0],
        items: [
          {
            title: 'Section 1.1',
            dest: [2],
            items: [{ title: 'Topic 1.1.1', dest: [4], items: [] }]
          }
        ]
      },
      { title: 'Chapter 2', dest: [5], items: [] }
    ])
    const document = makeDocument({ numPages: 6, getOutline })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )

    const chapter1 = await screen.findByRole('button', { name: 'Chapter 1' })
    await waitFor(() => expect(chapter1).toHaveAttribute('data-active', 'true'))
    expect(chapter1.style.color).toBe(
      'var(--hamster-reader-theme-color, #2563eb)'
    )
    expect(
      screen.getByRole('button', { name: 'Section 1.1' })
    ).not.toHaveAttribute('data-active')

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={3}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Section 1.1' })
      ).toHaveAttribute('data-active', 'true')
    )

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={6}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Chapter 2' })).toHaveAttribute(
        'data-active',
        'true'
      )
    )
    expect(
      globalThis.document.querySelectorAll('[data-active="true"]')
    ).toHaveLength(1)

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={0}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )
    expect(globalThis.document.querySelector('[data-active="true"]')).toBeNull()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('keeps collapsed branches while targets resolve and when the tab reopens', async () => {
    const pendingDestination = deferred<unknown>()
    const document = makeDocument({
      getOutline: vi.fn().mockResolvedValue([
        {
          title: 'Parent',
          dest: [0],
          items: [{ title: 'Child', dest: 'child', items: [] }]
        }
      ]),
      getDestination: vi.fn(() => pendingDestination.promise)
    })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 2]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'Child' })
    fireEvent.click(screen.getByRole('button', { name: '收起 Parent' }))
    expect(screen.queryByRole('button', { name: 'Child' })).toBeNull()

    await act(async () => {
      pendingDestination.resolve([{ num: 2, gen: 0 }])
      await pendingDestination.promise
    })
    expect(screen.queryByRole('button', { name: 'Child' })).toBeNull()

    view.rerender(
      <PdfOutline
        document={document}
        isActive={false}
        currentPageNumber={1}
        pageNumbers={[1, 2]}
        onNavigate={onNavigate}
      />
    )
    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 2]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'Parent' })
    expect(screen.queryByRole('button', { name: 'Child' })).toBeNull()
  })

  it('filters the current item to the currently visible pages', async () => {
    const document = makeDocument({
      numPages: 5,
      getOutline: vi.fn().mockResolvedValue([
        { title: 'Visible One', dest: [0], items: [] },
        { title: 'Hidden Four', dest: [3], items: [] }
      ])
    })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={5}
        pageNumbers={[1, 2, 3, 5]}
        onNavigate={onNavigate}
      />
    )
    const visible = await screen.findByRole('button', {
      name: 'Visible One'
    })
    await waitFor(() => expect(visible).toHaveAttribute('data-active', 'true'))
    expect(
      screen.getByRole('button', { name: 'Hidden Four' })
    ).not.toHaveAttribute('data-active')

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={5}
        pageNumbers={[1, 2, 3, 4, 5]}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Hidden Four' })
      ).toHaveAttribute('data-active', 'true')
    )
    expect(
      screen.getByRole('button', { name: 'Visible One' })
    ).not.toHaveAttribute('data-active')
  })

  it('backfills a target resolved during navigation so highlighting recovers', async () => {
    const targetRef = { num: 6, gen: 0 }
    const getDestination = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce([targetRef])
    const document = makeDocument({
      numPages: 6,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'Retry', dest: 'retry', items: [] }]),
      getDestination
    })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 6]}
        onNavigate={onNavigate}
      />
    )
    const retry = await screen.findByRole('button', { name: 'Retry' })
    await waitFor(() => expect(getDestination).toHaveBeenCalledTimes(1))
    expect(retry).not.toHaveAttribute('data-active')

    fireEvent.click(retry)
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(6))
    expect(getDestination).toHaveBeenCalledTimes(2)

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={6}
        pageNumbers={[1, 6]}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute(
        'data-active',
        'true'
      )
    )

    view.rerender(
      <PdfOutline
        document={document}
        isActive={false}
        currentPageNumber={6}
        pageNumbers={[1, 6]}
        onNavigate={onNavigate}
      />
    )
    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={6}
        pageNumbers={[1, 6]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'Retry' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute(
        'data-active',
        'true'
      )
    )
  })

  it('resets collapse choices when the document changes', async () => {
    const a = makeDocument({
      getOutline: vi.fn().mockResolvedValue([
        {
          title: 'A Parent',
          dest: [0],
          items: [{ title: 'A Child', dest: [1], items: [] }]
        }
      ])
    })
    const b = makeDocument({
      getOutline: vi.fn().mockResolvedValue([
        {
          title: 'B Parent',
          dest: [0],
          items: [{ title: 'B Child', dest: [1], items: [] }]
        }
      ])
    })
    const view = render(
      <PdfOutline
        document={a}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 2]}
        onNavigate={vi.fn()}
      />
    )
    await screen.findByRole('button', { name: 'A Child' })
    fireEvent.click(screen.getByRole('button', { name: '收起 A Parent' }))
    expect(screen.queryByRole('button', { name: 'A Child' })).toBeNull()

    view.rerender(
      <PdfOutline
        document={b}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 2]}
        onNavigate={vi.fn()}
      />
    )
    expect(
      await screen.findByRole('button', { name: 'B Child' })
    ).toBeInTheDocument()
  })

  it('ignores outline A when document B has already replaced it', async () => {
    const pendingA = deferred<unknown>()
    const a = makeDocument({ getOutline: vi.fn(() => pendingA.promise) })
    const b = makeDocument({
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'Document B', dest: [0], items: [] }])
    })
    const view = render(
      <PdfOutline
        document={a}
        isActive
        pageNumbers={[1]}
        onNavigate={vi.fn()}
      />
    )
    view.rerender(
      <PdfOutline
        document={b}
        isActive
        pageNumbers={[1]}
        onNavigate={vi.fn()}
      />
    )
    expect(
      await screen.findByRole('button', { name: 'Document B' })
    ).toBeInTheDocument()

    await act(async () => {
      pendingA.resolve([{ title: 'Document A', dest: [0], items: [] }])
      await pendingA.promise
    })
    expect(screen.queryByRole('button', { name: 'Document A' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Document B' })
    ).toBeInTheDocument()
  })

  it('ignores a late destination from the previous document', async () => {
    const pendingDestination = deferred<unknown>()
    const a = makeDocument({
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'A target', dest: 'a', items: [] }]),
      getDestination: vi.fn(() => pendingDestination.promise)
    })
    const b = makeDocument({
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'B target', dest: [0], items: [] }])
    })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={a}
        isActive
        pageNumbers={[1, 2]}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'A target' }))
    view.rerender(
      <PdfOutline
        document={b}
        isActive
        pageNumbers={[1, 2]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'B target' })
    await act(async () => {
      pendingDestination.resolve([{ num: 2, gen: 0 }])
      await pendingDestination.promise
    })
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('rechecks the allowed pages after a destination resolves', async () => {
    const pendingPageIndex = deferred<number>()
    const target = { num: 2, gen: 0 }
    const document = makeDocument({
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'Target', dest: [target], items: [] }]),
      getPageIndex: vi.fn(() => pendingPageIndex.promise)
    })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={[1, 2]}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Target' }))
    view.rerender(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={[1]}
        onNavigate={onNavigate}
      />
    )
    await act(async () => {
      pendingPageIndex.resolve(1)
      await pendingPageIndex.promise
    })
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('keeps immediate navigation B when named navigation A resolves later', async () => {
    const pendingDestination = deferred<unknown[]>()
    const page3 = { num: 3, gen: 0 }
    const getDestination = vi.fn(() => pendingDestination.promise)
    const getPageIndex = vi.fn(async (ref: { num: number }) => ref.num - 1)
    const document = makeDocument({
      getOutline: vi.fn().mockResolvedValue([
        { title: 'Named A', dest: 'named-a', items: [] },
        { title: 'Immediate B', dest: [3], items: [] }
      ]),
      getDestination,
      getPageIndex
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={[1, 2, 3, 4]}
        onNavigate={onNavigate}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Named A' }))
    expect(getDestination).toHaveBeenCalledWith('named-a')
    fireEvent.click(screen.getByRole('button', { name: 'Immediate B' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(4))
    expect(onNavigate.mock.calls).toEqual([[4]])

    await act(async () => {
      pendingDestination.resolve([page3])
      await pendingDestination.promise
    })
    await waitFor(() => expect(getPageIndex).toHaveBeenCalledWith(page3))
    expect(onNavigate.mock.calls).toEqual([[4]])
  })

  it('corrects pages up to the current position, then jumps to the real chapter page', async () => {
    const texts: Record<number, string> = {
      1: '版权信息',
      2: '版权信息',
      4: '序言',
      5: '第一章 揭开网络引战的面纱',
      6: '第二章 日常生活中的引战'
    }
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [{ str: texts[pageNumber] ?? '正文内容' }]
      })
    }))
    const document = makeDocument({
      numPages: 10,
      getOutline: vi.fn().mockResolvedValue([
        { title: '序言', dest: [0], items: [] },
        { title: '第一章 揭开网络引战的面纱', dest: [1], items: [] },
        { title: '第二章 日常生活中的引战', dest: [2], items: [] }
      ]),
      getPage
    })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={5}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '第一章 揭开网络引战的面纱' })
      ).toHaveAttribute('aria-current', 'location')
    )
    // 从最早标注页一路读到当前页，序言和第一章的真实页都被校正。
    expect(getPage.mock.calls.map(([page]) => page)).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5])
    )
    fireEvent.click(
      screen.getByRole('button', { name: '第二章 日常生活中的引战' })
    )
    // 第二章尚未校正，点击时向前找到真实标题页。
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(6))

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={6}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '第二章 日常生活中的引战' })
      ).toHaveAttribute('aria-current', 'location')
    )
    // 当前页命中后，后续点击使用校正页。
    fireEvent.click(
      screen.getByRole('button', { name: '第二章 日常生活中的引战' })
    )
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(6))
    expect(getPage.mock.calls.map(([page]) => page)).toEqual(
      expect.arrayContaining([2, 3, 5, 6])
    )
  })

  it('cancels an earlier click lookup when another chapter is clicked', async () => {
    const pendingText = deferred<{ items: { str: string }[] }>()
    const getPage = vi.fn((pageNumber: number) =>
      pageNumber === 37
        ? { getTextContent: () => pendingText.promise }
        : {
            getTextContent: async () => ({
              items: [{ str: pageNumber === 19 ? '第二章' : '正文内容' }]
            })
          }
    )
    const document = makeDocument({
      numPages: 300,
      getOutline: vi.fn().mockResolvedValue([
        { title: '第七章', dest: [36], items: [] },
        { title: '第二章', dest: [18], items: [] }
      ]),
      getPage
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        pageNumbers={Array.from({ length: 300 }, (_, index) => index + 1)}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: '第七章' }))
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(37))
    fireEvent.click(screen.getByRole('button', { name: '第二章' }))
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(19))

    await act(async () => {
      pendingText.resolve({ items: [{ str: '第七章 维特效应' }] })
      await pendingText.promise
    })
    expect(onNavigate).not.toHaveBeenCalledWith(38)
    expect(onNavigate.mock.calls).toEqual([[19]])
  })

  it('stops requesting page text when the outline is no longer visible', async () => {
    const getPage = vi.fn(async () => ({
      getTextContent: async () => ({ items: [{ str: '正文内容' }] })
    }))
    const document = makeDocument({
      numPages: 10,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: '第一章', dest: [0], items: [] }]),
      getPage
    })
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={vi.fn()}
      />
    )
    await screen.findByRole('button', { name: '第一章' })
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(1))
    const reads = getPage.mock.calls.length
    view.rerender(
      <PdfOutline
        document={document}
        isActive={false}
        currentPageNumber={2}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={vi.fn()}
      />
    )
    await act(async () => {})
    expect(getPage).toHaveBeenCalledTimes(reads)
  })

  it('keeps a valid annotated page when later pages repeat the title as a running header', async () => {
    const texts: Record<number, string> = {
      3: '正文内容',
      7: 'Intro\n这一页只是重复页眉',
      8: 'Intro\n这一页只是重复页眉',
      9: 'Intro\n这一页只是重复页眉'
    }
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [{ str: texts[pageNumber] ?? '正文内容' }]
      })
    }))
    const document = makeDocument({
      numPages: 12,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'Intro', dest: [2], items: [] }]),
      getPage
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={Array.from({ length: 12 }, (_, index) => index + 1)}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Intro' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(3))
    expect(onNavigate).not.toHaveBeenCalledWith(7)
  })

  it('stops an in-flight click and skips navigation after the outline becomes inactive', async () => {
    const getPage = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        getTextContent: async () => ({ items: [{ str: '正文内容' }] })
      }
    })
    const document = makeDocument({
      numPages: 300,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: '致谢', dest: [51], items: [] }]),
      getPage
    })
    const pageNumbers = Array.from({ length: 300 }, (_, index) => index + 1)
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: '致谢' }))
    await waitFor(() => expect(getPage.mock.calls.length).toBeGreaterThan(3))

    view.rerender(
      <PdfOutline
        document={document}
        isActive={false}
        currentPageNumber={1}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    const reads = getPage.mock.calls.length
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(getPage.mock.calls.length).toBe(reads)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('falls back to the annotated page when click correction exceeds its deadline', async () => {
    const getPage = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      return {
        getTextContent: async () => ({ items: [{ str: '正文内容' }] })
      }
    })
    const document = makeDocument({
      numPages: 300,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: '致谢', dest: [51], items: [] }]),
      getPage
    })
    const onNavigate = vi.fn()
    const started = performance.now()
    render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={Array.from({ length: 300 }, (_, index) => index + 1)}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: '致谢' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(52), {
      timeout: 3000
    })
    expect(performance.now() - started).toBeLessThan(2800)
  })

  it('locates the chapter containing a jumped page and hides later targets', async () => {
    const texts: Record<number, string> = {
      52: '第二章 独行者',
      178: '第七章 维特效应',
      180: '截至2006年，其相关网站也有500多家。',
      290: '致谢'
    }
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [{ str: texts[pageNumber] ?? '正文内容' }]
      })
    }))
    const document = makeDocument({
      numPages: 300,
      getOutline: vi.fn().mockResolvedValue([
        { title: '第二章 独行者', dest: [18], items: [] },
        { title: '第七章 维特效应', dest: [36], items: [] },
        { title: '致谢', dest: [51], items: [] }
      ]),
      getPage
    })
    const pageNumbers = Array.from({ length: 300 }, (_, index) => index + 1)
    const view = render(
      <PdfOutline
        document={document}
        isActive={false}
        currentPageNumber={180}
        pageNumbers={pageNumbers}
        onNavigate={vi.fn()}
      />
    )
    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={180}
        pageNumbers={pageNumbers}
        onNavigate={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '第七章 维特效应' })
      ).toHaveAttribute('data-active', 'true')
    )
    expect(screen.getByRole('button', { name: '致谢' })).not.toHaveAttribute(
      'data-active'
    )

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={60}
        pageNumbers={pageNumbers}
        onNavigate={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '第二章 独行者' })
      ).toHaveAttribute('data-active', 'true')
    )
  })

  it('does not cancel or reuse a delayed page read when a destination snapshot updates', async () => {
    const pendingText = deferred<{ items: { str: string }[] }>()
    const pendingDestination = deferred<unknown>()
    const getDestination = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockReturnValueOnce(pendingDestination.promise)
    const getPage = vi.fn((_pageNumber: number) => ({
      getTextContent: () => pendingText.promise
    }))
    const document = makeDocument({
      numPages: 6,
      getOutline: vi.fn().mockResolvedValue([
        { title: 'Named', dest: 'named', items: [] },
        { title: 'Chapter', dest: [4], items: [] }
      ]),
      getDestination,
      getPage
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={5}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Named' }))
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(5))
    await act(async () => {
      pendingDestination.resolve([{ num: 2, gen: 0 }])
      await pendingDestination.promise
      pendingText.resolve({ items: [{ str: 'Chapter' }] })
      await pendingText.promise
    })
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(2))
    expect(getPage.mock.calls.map(([page]) => page)).toEqual([5, 2, 3, 4, 6])
    expect(getPage.mock.calls.filter(([page]) => page === 5)).toHaveLength(1)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Chapter' })).toHaveAttribute(
        'data-active',
        'true'
      )
    )
  })

  it('retries the same page read after it was cancelled', async () => {
    const firstText = deferred<{ items: { str: string }[] }>()
    const getPage = vi
      .fn()
      .mockReturnValueOnce({ getTextContent: () => firstText.promise })
      .mockResolvedValueOnce({
        getTextContent: async () => ({ items: [{ str: '第一章' }] })
      })
    const document = makeDocument({
      numPages: 5,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: '第一章', dest: [0], items: [] }]),
      getPage
    })
    const pageNumbers = [1, 2, 3, 4, 5]
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={pageNumbers}
        onNavigate={vi.fn()}
      />
    )
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(1))
    view.rerender(
      <PdfOutline
        document={document}
        isActive={false}
        currentPageNumber={1}
        pageNumbers={pageNumbers}
        onNavigate={vi.fn()}
      />
    )
    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={pageNumbers}
        onNavigate={vi.fn()}
      />
    )
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '第一章' })).toHaveAttribute(
      'data-active',
      'true'
    )
  })

  it('keeps the annotated page when a nearby page repeats the title as its only header', async () => {
    const texts: Record<number, string> = {
      5: 'Intro\n正文从这里开始',
      7: 'Intro\n这一页只是重复页眉'
    }
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [{ str: texts[pageNumber] ?? '正文内容' }]
      })
    }))
    const document = makeDocument({
      numPages: 10,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'Intro', dest: [4], items: [] }]),
      getPage
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={7}
        pageNumbers={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Intro' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(5))
    expect(onNavigate).not.toHaveBeenCalledWith(7)
  })

  it('keeps the annotated page when reading it fails before a repeated header', async () => {
    const getPage = vi.fn(async (pageNumber: number) => {
      if (pageNumber === 3) throw new Error('page text rejected')
      return {
        getTextContent: async () => ({
          items: [
            {
              str: pageNumber === 6 ? 'Intro\n这一页只是重复页眉' : '正文内容'
            }
          ]
        })
      }
    })
    const document = makeDocument({
      numPages: 10,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'Intro', dest: [2], items: [] }]),
      getPage
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={6}
        pageNumbers={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
        onNavigate={onNavigate}
      />
    )
    const intro = await screen.findByRole('button', { name: 'Intro' })
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(3))
    await act(async () => {})
    fireEvent.click(intro)
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(3))
    expect(onNavigate).not.toHaveBeenCalledWith(6)
  })

  it('does not let a failed read turn another target into a repeated-header correction', async () => {
    const texts: Record<number, string> = {
      3: 'B Intro',
      7: 'B Intro\n这一页只是重复页眉',
      8: 'A Intro'
    }
    const getPage = vi.fn(async (pageNumber: number) => {
      if (pageNumber === 2) throw new Error('page text rejected')
      return {
        getTextContent: async () => ({
          items: [{ str: texts[pageNumber] ?? '正文内容' }]
        })
      }
    })
    const document = makeDocument({
      numPages: 10,
      getOutline: vi.fn().mockResolvedValue([
        { title: 'A Intro', dest: [1], items: [] },
        { title: 'B Intro', dest: [2], items: [] }
      ]),
      getPage
    })
    const onNavigate = vi.fn()
    const pageNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const view = render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={8}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    const bIntro = await screen.findByRole('button', { name: 'B Intro' })
    // 失败的标注页会中止本轮扫描，且页面标题不会成为 B 的重复页眉证据。
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(2))
    await act(async () => {})

    fireEvent.click(bIntro)
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(3))
    expect(onNavigate).not.toHaveBeenCalledWith(7)

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={3}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'B Intro' })).toHaveAttribute(
        'data-active',
        'true'
      )
    )
  })

  it('does not carry corrections across documents in one outline instance', async () => {
    const pageNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const firstTexts: Record<number, string> = {
      5: 'A Prologue',
      6: 'A Intro'
    }
    const firstDocument = makeDocument({
      numPages: 10,
      getOutline: vi.fn().mockResolvedValue([
        { title: 'A Intro', dest: [2], items: [] },
        { title: 'A Prologue', dest: [0], items: [] }
      ]),
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => ({
          items: [{ str: firstTexts[pageNumber] ?? '正文内容' }]
        })
      }))
    })
    const secondDocument = makeDocument({
      numPages: 10,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: 'B Intro', dest: [8], items: [] }]),
      getPage: vi.fn(async (_pageNumber: number) => ({
        getTextContent: async () => ({ items: [{ str: '正文内容' }] })
      }))
    })
    const onNavigate = vi.fn()
    const view = render(
      <PdfOutline
        document={firstDocument}
        isActive
        currentPageNumber={6}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'A Intro' })
    await waitFor(() => expect(firstDocument.getPage).toHaveBeenCalledWith(5))
    await act(async () => {})
    view.rerender(
      <PdfOutline
        document={firstDocument}
        isActive
        currentPageNumber={4}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'A Intro' })
      ).not.toHaveAttribute('data-active')
    )
    fireEvent.click(screen.getByRole('button', { name: 'A Intro' }))
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(6))

    view.rerender(
      <PdfOutline
        document={secondDocument}
        isActive
        currentPageNumber={8}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    const secondIntro = await screen.findByRole('button', { name: 'B Intro' })
    await act(async () => {})
    expect(secondIntro).not.toHaveAttribute('data-active')
    fireEvent.click(secondIntro)
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(9))
    expect(onNavigate.mock.calls).toEqual([[6], [9]])
  })

  it('restores collapsed branches and corrected pages from a session state', async () => {
    const firstTexts: Record<number, string> = {
      4: 'Prologue',
      5: 'Chapter'
    }
    const firstDocument = makeDocument({
      numPages: 6,
      getOutline: vi.fn().mockResolvedValue([
        { title: 'Prologue', dest: [0], items: [] },
        {
          title: 'Parent',
          dest: [0],
          items: [{ title: 'Chapter', dest: [2], items: [] }]
        }
      ]),
      getPage: vi.fn(async (pageNumber: number) => ({
        getTextContent: async () => ({
          items: [{ str: firstTexts[pageNumber] ?? '正文内容' }]
        })
      }))
    })
    const session = createPdfOutlineSessionState()
    const pageNumbers = [1, 2, 3, 4, 5, 6]
    const firstNavigate = vi.fn()
    const firstView = render(
      <PdfOutline
        document={firstDocument}
        isActive
        currentPageNumber={5}
        pageNumbers={pageNumbers}
        sessionState={session}
        onNavigate={firstNavigate}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Chapter' })).toHaveAttribute(
        'data-active',
        'true'
      )
    )
    await waitFor(() => expect(firstDocument.getPage).toHaveBeenCalledWith(4))
    fireEvent.click(screen.getByRole('button', { name: 'Chapter' }))
    await waitFor(() => expect(firstNavigate).toHaveBeenLastCalledWith(5))
    fireEvent.click(screen.getByRole('button', { name: '收起 Parent' }))
    expect(screen.queryByRole('button', { name: 'Chapter' })).toBeNull()
    firstView.unmount()

    const secondDocument = makeDocument({
      numPages: 6,
      getOutline: vi.fn().mockResolvedValue([
        { title: 'Prologue', dest: [0], items: [] },
        {
          title: 'Parent',
          dest: [0],
          items: [{ title: 'Chapter', dest: [2], items: [] }]
        }
      ])
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={secondDocument}
        isActive
        currentPageNumber={5}
        pageNumbers={pageNumbers}
        sessionState={session}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: 'Parent' })
    expect(screen.queryByRole('button', { name: 'Chapter' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开 Parent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chapter' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(5))
  })
})
