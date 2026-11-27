// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  correctOutlineTitlePages,
  findTrustedOutlinePage,
  normalizeOutlineTitle,
  OUTLINE_TITLE_SEARCH_LIMIT,
  pageStartsWithOutlineTitle,
  probeOutlinePage
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

describe('findTrustedOutlinePage', () => {
  it('finds the nearest preceding chapter when a jump lands mid-chapter', async () => {
    const { document, getPage } = makeTextDocument(
      {
        37: '常常指代更谨慎的网络行为。',
        178: '第七章 维特效应',
        180: '截至2006年，其相关网站也有500多家。'
      },
      300
    )
    const match = await findTrustedOutlinePage(
      document,
      [{ id: 'ch7', title: '第七章 维特效应', pageNumber: 37 }],
      180
    )
    expect(match).toMatchObject({
      id: 'ch7',
      annotatedPage: 37,
      pageNumber: 178,
      standalone: true
    })
    const pages = getPage.mock.calls.map(([page]) => page)
    expect(pages.slice(0, 3)).toEqual([180, 179, 178])
    expect(pages).toContain(37)
  })

  it('never corrects backwards to a page before the annotated page', async () => {
    const { document } = makeTextDocument({
      2: 'Intro',
      5: 'Intro'
    })
    const match = await findTrustedOutlinePage(
      document,
      [{ id: 'intro', title: 'Intro', pageNumber: 5 }],
      2
    )
    expect(match).toBeNull()
  })

  it('keeps a correct annotated page when a nearby page repeats the title as its only header', async () => {
    const { document } = makeTextDocument({
      5: 'Intro\n正文从这里开始',
      7: 'Intro\n这一页只是重复页眉'
    })
    const match = await findTrustedOutlinePage(
      document,
      [{ id: 'intro', title: 'Intro', pageNumber: 5 }],
      7
    )
    expect(match).toMatchObject({
      id: 'intro',
      annotatedPage: 5,
      pageNumber: 5
    })
  })

  it('accepts a later standalone heading only with multiple consecutive titles as evidence', async () => {
    const { document } = makeTextDocument({
      5: 'Another Chapter\n正文',
      6: 'Another Chapter\n正文',
      7: 'Intro\n正文'
    })
    const match = await findTrustedOutlinePage(
      document,
      [
        { id: 'intro', title: 'Intro', pageNumber: 5 },
        { id: 'another', title: 'Another Chapter', pageNumber: 5 }
      ],
      7
    )
    expect(match).toMatchObject({
      id: 'intro',
      annotatedPage: 5,
      pageNumber: 7
    })
  })

  it('trusts the current title page when the annotated page is outside the window', async () => {
    const { document } = makeTextDocument({
      3: '正文中没有章节标题',
      12: 'Intro\n正文'
    })
    const match = await findTrustedOutlinePage(
      document,
      [{ id: 'intro', title: 'Intro', pageNumber: 3 }],
      12
    )
    expect(match).toMatchObject({
      id: 'intro',
      annotatedPage: 3,
      pageNumber: 12,
      confidence: 'strong'
    })
  })

  it('returns weak evidence when only the annotated page title is missing', async () => {
    const { document } = makeTextDocument({
      5: '正文中没有章节标题',
      7: 'Intro\n正文'
    })
    const match = await findTrustedOutlinePage(
      document,
      [{ id: 'intro', title: 'Intro', pageNumber: 5 }],
      7
    )
    expect(match).toMatchObject({
      id: 'intro',
      pageNumber: 7,
      confidence: 'weak'
    })
  })

  it('does not report evidence titles when the annotated page cannot be read', async () => {
    const getPage = vi.fn(async (pageNumber: number) => {
      if (pageNumber === 2) throw new Error('page text rejected')
      return {
        getTextContent: async () => ({
          items: [{ str: pageNumber === 8 ? 'A Intro' : '正文内容' }]
        })
      }
    })
    const document = {
      numPages: 10,
      getPage
    } as unknown as PDFDocumentProxy
    const probe = await probeOutlinePage(
      document,
      [{ id: 'a', title: 'A Intro', pageNumber: 2 }],
      8,
      8,
      1,
      null,
      new Set(),
      {}
    )
    expect(probe).toMatchObject({ failed: false, titles: [], result: null })
  })

  it('does not let a failed target supply evidence that moves another target to a repeated header', async () => {
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
    const document = {
      numPages: 10,
      getPage
    } as unknown as PDFDocumentProxy
    const match = await findTrustedOutlinePage(
      document,
      [
        { id: 'a', title: 'A Intro', pageNumber: 2 },
        { id: 'b', title: 'B Intro', pageNumber: 3 }
      ],
      8
    )
    expect(match).toMatchObject({
      id: 'b',
      annotatedPage: 3,
      pageNumber: 3,
      standalone: true,
      confidence: 'strong'
    })
  })

  it('keeps the annotated page when reading it is rejected', async () => {
    let failAnnotatedPage = true
    const getPage = vi.fn(async (pageNumber: number) => {
      if (pageNumber === 3 && failAnnotatedPage) {
        throw new Error('page text rejected')
      }
      return {
        getTextContent: async () => ({
          items: [{ str: pageNumber === 6 ? 'Intro' : '正文内容' }]
        })
      }
    })
    const document = {
      numPages: 10,
      getPage
    } as unknown as PDFDocumentProxy
    const targets = [{ id: 'intro', title: 'Intro', pageNumber: 3 }]

    expect(await findTrustedOutlinePage(document, targets, 6)).toBeNull()

    failAnnotatedPage = false
    expect(await findTrustedOutlinePage(document, targets, 6)).toMatchObject({
      id: 'intro',
      annotatedPage: 3,
      pageNumber: 6,
      confidence: 'weak'
    })
  })

  it('keeps the annotated page when reading it times out', async () => {
    vi.useFakeTimers()
    try {
      const getPage = vi.fn(async (pageNumber: number) => ({
        getTextContent:
          pageNumber === 3
            ? () => new Promise<never>(() => undefined)
            : async () => ({
                items: [{ str: pageNumber === 6 ? 'Intro' : '正文内容' }]
              })
      }))
      const document = {
        numPages: 10,
        getPage
      } as unknown as PDFDocumentProxy
      const scan = findTrustedOutlinePage(
        document,
        [{ id: 'intro', title: 'Intro', pageNumber: 3 }],
        6
      )
      await vi.advanceTimersByTimeAsync(10_000)
      await vi.runAllTimersAsync()
      await expect(scan).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
