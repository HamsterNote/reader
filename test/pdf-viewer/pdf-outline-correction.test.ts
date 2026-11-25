// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  correctOutlineTitlePages,
  normalizeOutlineTitle,
  OUTLINE_TITLE_SEARCH_LIMIT,
  pageStartsWithOutlineTitle
} from '../../src/pdf/pdfOutlineTitleCorrection'
import type { PDFDocumentProxy } from '../../src/pdf/pdfjsRuntime'

function makeTextDocument(
  texts: Readonly<Record<number, string>>,
  numPages = 100
) {
  const getPage = vi.fn(async (pageNumber: number) => ({
    getTextContent: async () => ({
      items: [{ str: texts[pageNumber] ?? '正文内容' }]
    })
  }))
  return {
    document: { numPages, getPage } as unknown as PDFDocumentProxy,
    getPage
  }
}

describe('correctOutlineTitlePages', () => {
  it('moves a stale outline page to the page whose text starts with the title', async () => {
    const { document } = makeTextDocument({
      2: '书名页',
      22: '第一章　揭开网络引战的面纱',
      52: '第二章　日常生活中的引战'
    })
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 16 },
      { id: 'ch2', title: '第二章 日常生活中的引战', pageNumber: 19 }
    ])
    expect(corrections.get('ch1')).toBe(22)
    expect(corrections.get('ch2')).toBe(52)
  })

  it('keeps the annotated page when no page starts with the title', async () => {
    const { document } = makeTextDocument({ 3: '版权页' })
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'cover', title: '延伸阅读', pageNumber: 48 }
    ])
    expect(corrections.get('cover')).toBe(48)
  })

  it('only matches the start of a page, not a title mentioned mid-page', async () => {
    const { document } = makeTextDocument({
      4: '上一章回顾 第一章 揭开网络引战的面纱'
    })
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 4 }
    ])
    expect(corrections.get('ch1')).toBe(4)
  })

  it('requires a complete title at a word or line boundary', async () => {
    const { document } = makeTextDocument({
      2: 'Introductory material',
      3: '第一章 揭开网络引战的面纱 第 5 页'
    })
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'intro', title: 'Intro', pageNumber: 1 },
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 2 }
    ])
    expect(corrections.get('intro')).toBe(1)
    expect(corrections.get('ch1')).toBe(2)
  })

  it('does not match a table-of-contents page that lists the title', async () => {
    const { document } = makeTextDocument({
      2: '目录\n第一章 揭开网络引战的面纱\n第二章 日常生活中的引战',
      3: '第一章 揭开网络引战的面纱'
    })
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 2 }
    ])
    expect(corrections.get('ch1')).toBe(3)
  })

  it('rejects a running header followed by body text on the same line', async () => {
    const { document } = makeTextDocument({
      2: '第一章 揭开网络引战的面纱 正文从这里开始',
      3: '第一章 揭开网络引战的面纱'
    })
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 2 }
    ])
    expect(corrections.get('ch1')).toBe(3)
  })

  it('keeps the annotated page when the real page is earlier', async () => {
    const { document, getPage } = makeTextDocument(
      { 2: '第一章 揭开网络引战的面纱' },
      6
    )
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 5 }
    ])
    expect(corrections.get('ch1')).toBe(5)
    expect(getPage.mock.calls.map(([page]) => page)).toEqual([5, 6])
  })

  it('limits the forward search window', async () => {
    const matchedPage = 2 + OUTLINE_TITLE_SEARCH_LIMIT + 1
    const { document, getPage } = makeTextDocument(
      { [matchedPage]: '第一章 揭开网络引战的面纱' },
      matchedPage + 10
    )
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 2 }
    ])
    expect(corrections.get('ch1')).toBe(2)
    expect(getPage.mock.calls.map(([page]) => page)).not.toContain(matchedPage)
  })

  it('stops dispatching new page reads after cancellation', async () => {
    let resolvePage!: (page: {
      getTextContent: () => Promise<{ items: { str: string }[] }>
    }) => void
    const getPage = vi.fn(
      () =>
        new Promise<{
          getTextContent: () => Promise<{ items: { str: string }[] }>
        }>((resolve) => {
          resolvePage = resolve
        })
    )
    const controller = new AbortController()
    const document = {
      numPages: 100,
      getPage
    } as unknown as PDFDocumentProxy
    const scan = correctOutlineTitlePages(
      document,
      [{ id: 'ch1', title: '第一章', pageNumber: 1 }],
      { signal: controller.signal }
    )
    await Promise.resolve()
    expect(getPage).toHaveBeenCalledTimes(1)
    controller.abort()
    resolvePage({
      getTextContent: async () => ({ items: [{ str: '正文内容' }] })
    })
    await scan
    await Promise.resolve()
    expect(getPage).toHaveBeenCalledTimes(1)
  })

  it('caches page text per document so a second run does not re-extract', async () => {
    const { document, getPage } = makeTextDocument(
      { 5: '第一章 揭开网络引战的面纱' },
      10
    )
    const targets = [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 2 }
    ]
    await correctOutlineTitlePages(document, targets)
    const calls = getPage.mock.calls.length
    const again = await correctOutlineTitlePages(document, targets)
    expect(again.get('ch1')).toBe(5)
    expect(getPage).toHaveBeenCalledTimes(calls)
  })

  it('stops scanning when page text cannot be read', async () => {
    const document = {
      numPages: 50,
      getPage: vi.fn(async () => {
        throw new Error('page removed')
      })
    } as unknown as PDFDocumentProxy
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章', pageNumber: 2 }
    ])
    expect(corrections.get('ch1')).toBe(2)
    expect(
      (document.getPage as unknown as ReturnType<typeof vi.fn>).mock.calls
    ).toHaveLength(1)
  })

  it('normalizes whitespace, quotes and dashes on both sides', () => {
    expect(normalizeOutlineTitle('“第一章 — 揭开”')).toBe('第一章揭开')
    expect(
      pageStartsWithOutlineTitle(
        '第一章「揭开网络引战的面纱」',
        '第一章 —— 揭开网络引战的面纱'
      )
    ).toBe(true)
    expect(pageStartsWithOutlineTitle('序言\n第一章', '第一章')).toBe(false)
  })

  it('keeps working when the document exposes no page text API', async () => {
    const document = {
      numPages: 4,
      getOutline: vi.fn()
    } as unknown as PDFDocumentProxy
    const corrections = await correctOutlineTitlePages(document, [
      { id: 'ch1', title: '第一章', pageNumber: 2 }
    ])
    expect(corrections.get('ch1')).toBe(2)
  })
})
