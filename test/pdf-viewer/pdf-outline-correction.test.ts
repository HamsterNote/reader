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
