import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import { PdfOutline } from '../../src/pdf/PdfOutline'

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

  it('corrects the current page lazily, jumps immediately, then reuses the corrected page', async () => {
    const texts: Record<number, string> = {
      2: '版权信息',
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
    // 冷开只读当前页，不预扫整本。
    expect(getPage.mock.calls.map(([page]) => page)).toEqual([5])
    fireEvent.click(
      screen.getByRole('button', { name: '第二章 日常生活中的引战' })
    )
    // 校正结果尚未覆盖第二章时按标注页立即跳转。
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(3))

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
    expect(getPage.mock.calls.map(([page]) => page).sort()).toEqual([5, 6])
  })

  it('navigates without waiting for page text correction', async () => {
    const pendingText = deferred<{ items: { str: string }[] }>()
    const getPage = vi.fn(() => ({
      getTextContent: () => pendingText.promise
    }))
    const document = makeDocument({
      numPages: 6,
      getOutline: vi
        .fn()
        .mockResolvedValue([{ title: '第七章', dest: [1], items: [] }]),
      getPage
    })
    const onNavigate = vi.fn()
    render(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={1}
        pageNumbers={[1, 2, 3, 4, 5, 6]}
        onNavigate={onNavigate}
      />
    )
    await screen.findByRole('button', { name: '第七章' })
    fireEvent.click(screen.getByRole('button', { name: '第七章' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(2))
    expect(pendingText.resolve).toBeTypeOf('function')
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
})
