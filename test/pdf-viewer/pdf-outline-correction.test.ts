// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  findOutlineTitlePage,
  normalizeOutlineTitle,
  OUTLINE_TITLE_SEARCH_LIMIT,
  pageStartsWithOutlineTitle,
  scanOutlineTitlePages
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

const darkWebHeads: Record<number, string> = {
  12: '引言 自由或死亡\n我听说过关于这个网站的一些谣言。',
  22: '第一章 揭开网络引战的面纱\n在生命之树的顶端没有爱。',
  52: '第二章 独行者\n我第一次见到保罗是在英格兰北部。',
  74: '第三章 潜入“高尔特峡谷”\n赛博朋克将致力于打造匿名系统。',
  178: '第七章 维特效应\n“耶！欢迎加入小组。”',
  203: '结语 科技乐观主义与悲观主义之\n争\n技术的转型像把双刃剑。',
  221: '尾注\n《暗网》一书参考了大量的网络信息来源。',
  225: '第一章 揭开网络引战的面纱\n“一场生活的灾难……”',
  290: '致谢\n首先，我要感谢所有人。'
}

const darkWebTargets = [
  { id: 'intro', title: '引言 自由或死亡', pageNumber: 12 },
  { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 16 },
  { id: 'ch2', title: '第二章 独行者', pageNumber: 19 },
  { id: 'ch3', title: '第三章 潜入“高尔特峡谷”', pageNumber: 22 },
  { id: 'ch7', title: '第七章 维特效应', pageNumber: 37 },
  { id: 'ending', title: '结语 科技乐观主义与悲观主义之争', pageNumber: 41 },
  { id: 'notes', title: '尾注', pageNumber: 45 },
  { id: 'thanks', title: '致谢', pageNumber: 52 }
]

describe('findOutlineTitlePage', () => {
  it('moves a stale outline page to the first page whose head is the title', async () => {
    const { document } = makeTextDocument(darkWebHeads, 294)
    expect(
      await findOutlineTitlePage(document, {
        id: 'ch1',
        title: '第一章 揭开网络引战的面纱',
        pageNumber: 16
      })
    ).toBe(22)
  })

  it('returns the annotated page when it is already correct', async () => {
    const { document } = makeTextDocument(darkWebHeads, 294)
    expect(
      await findOutlineTitlePage(document, {
        id: 'intro',
        title: '引言 自由或死亡',
        pageNumber: 12
      })
    ).toBe(12)
  })

  it('never searches backwards for a title before the annotated page', async () => {
    const { document } = makeTextDocument({ 2: '第一章 揭开网络引战的面纱' }, 6)
    expect(
      await findOutlineTitlePage(document, {
        id: 'ch1',
        title: '第一章 揭开网络引战的面纱',
        pageNumber: 5
      })
    ).toBeNull()
  })

  it('limits the forward search window', async () => {
    const matchedPage = 2 + OUTLINE_TITLE_SEARCH_LIMIT + 1
    const { document, getPage } = makeTextDocument(
      { [matchedPage]: '第一章 揭开网络引战的面纱' },
      matchedPage + 10
    )
    expect(
      await findOutlineTitlePage(document, {
        id: 'ch1',
        title: '第一章 揭开网络引战的面纱',
        pageNumber: 2
      })
    ).toBeNull()
    expect(getPage.mock.calls.map(([page]) => page)).not.toContain(matchedPage)
  })

  it('returns null when the annotated page cannot be read and retries later', async () => {
    let fail = true
    const getPage = vi.fn(async (pageNumber: number) => {
      if (pageNumber === 3 && fail) throw new Error('page text rejected')
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
    const target = { id: 'intro', title: 'Intro', pageNumber: 3 }

    expect(await findOutlineTitlePage(document, target)).toBeNull()

    fail = false
    expect(await findOutlineTitlePage(document, target)).toBe(6)
  })

  it('returns null when the document exposes no page text API', async () => {
    const document = {
      numPages: 4,
      getOutline: vi.fn()
    } as unknown as PDFDocumentProxy
    expect(
      await findOutlineTitlePage(document, {
        id: 'ch1',
        title: '第一章',
        pageNumber: 2
      })
    ).toBeNull()
  })
})

describe('scanOutlineTitlePages', () => {
  it('maps offset chapters up to the current page', async () => {
    const { document } = makeTextDocument(darkWebHeads, 294)
    const at25 = await scanOutlineTitlePages(document, darkWebTargets, 25)
    expect(at25.get('ch1')).toBe(22)
    expect(at25.has('ch2')).toBe(false)

    const at60 = await scanOutlineTitlePages(document, darkWebTargets, 60)
    expect(at60.get('ch2')).toBe(52)

    const at80 = await scanOutlineTitlePages(document, darkWebTargets, 80)
    expect(at80.get('ch3')).toBe(74)
  })

  it('keeps the first occurrence and ignores a repeated title in the endnotes', async () => {
    const { document } = makeTextDocument(darkWebHeads, 294)
    const corrections = await scanOutlineTitlePages(
      document,
      darkWebTargets,
      225
    )
    expect(corrections.get('ch1')).toBe(22)
    expect(corrections.get('notes')).toBe(221)
    expect(corrections.get('ending')).toBe(203)
    expect(corrections.get('thanks')).toBeUndefined()
  })

  it('keeps a correct annotated page when a later page repeats the title', async () => {
    const { document } = makeTextDocument(
      {
        5: 'Intro\n正文从这里开始',
        7: 'Intro\n这一页只是重复页眉'
      },
      10
    )
    const corrections = await scanOutlineTitlePages(
      document,
      [{ id: 'intro', title: 'Intro', pageNumber: 5 }],
      7
    )
    expect(corrections.get('intro')).toBe(5)
  })

  it('does not let a failed read pollute another target with a repeated header', async () => {
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
    const targets = [
      { id: 'a', title: 'A Intro', pageNumber: 2 },
      { id: 'b', title: 'B Intro', pageNumber: 3 }
    ]

    expect((await scanOutlineTitlePages(document, targets, 8)).size).toBe(0)
    expect(
      await findOutlineTitlePage(document, targets[1] as (typeof targets)[1])
    ).toBe(3)
  })

  it('stops dispatching page reads after cancellation', async () => {
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
    const scan = scanOutlineTitlePages(
      document,
      [{ id: 'ch1', title: '第一章', pageNumber: 1 }],
      50,
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

  it('caches page text and only reads newly reached pages', async () => {
    const { document, getPage } = makeTextDocument(
      { 5: '第一章 揭开网络引战的面纱', 8: '第二章 日常生活中的引战' },
      10
    )
    const targets = [
      { id: 'ch1', title: '第一章 揭开网络引战的面纱', pageNumber: 2 },
      { id: 'ch2', title: '第二章 日常生活中的引战', pageNumber: 6 }
    ]
    await scanOutlineTitlePages(document, targets, 5)
    expect(getPage).toHaveBeenCalledTimes(4)
    await scanOutlineTitlePages(document, targets, 8)
    expect(getPage).toHaveBeenCalledTimes(7)
  })
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
