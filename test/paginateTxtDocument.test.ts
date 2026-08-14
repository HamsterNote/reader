import {
  type IntermediateContent,
  IntermediateDocument,
  IntermediatePage,
  IntermediatePageMap,
  IntermediateParagraph,
  IntermediateText,
  TextDir
} from '@hamster-note/types'
import { describe, expect, it, vi } from 'vitest'

import {
  createTextModeDocument,
  paginateTxtDocument,
  TXT_DOCUMENT_LINES_PER_PAGE
} from '../src'

const [TXT_DOCUMENT_ID, TXT_PAGE_ID] = [
  'txt-parser-document',
  'txt-parser-page-1'
]

type TxtDocumentFixture = {
  readonly document: IntermediateDocument
  readonly getData: ReturnType<typeof vi.fn<() => Promise<IntermediatePage>>>
  readonly getContent: ReturnType<
    typeof vi.fn<() => Promise<IntermediateContent[]>>
  >
  readonly texts: readonly IntermediateText[]
  readonly paragraphs: readonly IntermediateParagraph[]
}

const makeLineText = (lineNumber: number, content = `Line ${lineNumber}`) => {
  const y = lineNumber - 1
  return new IntermediateText({
    id: `txt-parser-text-${lineNumber}`,
    content,
    fontSize: 1,
    fontFamily: 'monospace',
    fontWeight: 400,
    italic: false,
    color: '#000000',
    polygon: [
      [0, y],
      [content.length, y],
      [content.length, y + 1],
      [0, y + 1]
    ],
    lineHeight: 1,
    ascent: 0.8,
    descent: 0.2,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: true
  })
}

const makeLineParagraph = (lineNumber: number, width: number) => {
  const y = lineNumber - 1
  return new IntermediateParagraph({
    id: `txt-parser-paragraph-${lineNumber}`,
    x: 0,
    y,
    width,
    height: 1,
    textIds: [`txt-parser-text-${lineNumber}`]
  })
}

function makeTxtDocument(lineCount: number): TxtDocumentFixture {
  const texts = Array.from({ length: lineCount }, (_, index) =>
    makeLineText(index + 1)
  )
  const width = Math.max(...texts.map((text) => text.content.length), 1)
  const paragraphs = texts.map((text, index) =>
    makeLineParagraph(index + 1, text.content.length)
  )
  const sourcePage = new IntermediatePage({
    id: TXT_PAGE_ID,
    number: 1,
    width,
    height: lineCount,
    content: [],
    paragraphs,
    getContentFn: () => getContent()
  })
  const getContent = vi.fn(async () => texts)
  const getData = vi.fn(async () => sourcePage)

  return {
    document: new IntermediateDocument({
      id: TXT_DOCUMENT_ID,
      title: 'TXT Document',
      outline: undefined,
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: TXT_PAGE_ID,
          pageNumber: 1,
          size: { x: width, y: lineCount },
          getData
        }
      ])
    }),
    getData,
    getContent,
    texts,
    paragraphs
  }
}

function makeSparseDocument(): IntermediateDocument {
  return new IntermediateDocument({
    id: 'sparse-document',
    title: 'Sparse document',
    outline: undefined,
    pagesMap: IntermediatePageMap.makeByInfoList(
      [
        { pageNumber: 2, text: 'two' },
        { pageNumber: 4, text: 'four' },
        { pageNumber: 8, text: 'eight' }
      ].map(({ pageNumber, text }) => ({
        id: `sparse-page-${pageNumber}`,
        pageNumber,
        size: { x: text.length, y: 1 },
        getData: async () =>
          new IntermediatePage({
            id: `sparse-page-${pageNumber}`,
            number: pageNumber,
            width: text.length,
            height: 1,
            content: [makeLineText(pageNumber, text)],
            paragraphs: []
          })
      }))
    )
  })
}

function makeDeferredTextDocument() {
  let releaseContent: (() => void) | undefined
  const contentReady = new Promise<void>((resolve) => {
    releaseContent = resolve
  })
  const text = makeLineText(1, 'Deferred text')
  const page = new IntermediatePage({
    id: 'deferred-page-1',
    number: 1,
    width: text.content.length,
    height: 1,
    content: [],
    paragraphs: [],
    getContentFn: async () => {
      await contentReady
      return [text]
    }
  })
  return {
    document: new IntermediateDocument({
      id: 'deferred-document',
      title: 'Deferred document',
      outline: undefined,
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: page.id,
          pageNumber: 1,
          size: { x: page.width, y: page.height },
          getData: async () => page
        }
      ])
    }),
    releaseContent: () => releaseContent?.()
  }
}

const requirePage = async (
  document: IntermediateDocument,
  pageNumber: number
) => {
  const page = await document.getPageByPageNumber(pageNumber)
  if (!page) {
    throw new Error(`Expected page ${pageNumber} to exist`)
  }
  return page
}

const getTexts = async (page: IntermediatePage) => {
  const content = await page.getContent()
  return content.filter(
    (entry): entry is IntermediateText => entry instanceof IntermediateText
  )
}

describe('paginateTxtDocument', () => {
  it('rejects a non-positive-integer page size', () => {
    // Given: 可分页的 TXT 文档和会向下取整为零的小数页大小。
    const { document } = makeTxtDocument(TXT_DOCUMENT_LINES_PER_PAGE + 1)

    // When: 调用公开分页函数。
    const paginate = () => paginateTxtDocument(document, { linesPerPage: 0.5 })

    // Then: 边界返回明确错误，而不是在 Array.from 中以 Infinity 崩溃。
    expect(paginate).toThrow(RangeError)
    expect(paginate).toThrow('positive safe integer')
  })

  it('returns non-txt documents unchanged', () => {
    const fixture = makeTxtDocument(3)
    const otherDocument = new IntermediateDocument({
      id: 'other-document',
      title: 'Other',
      outline: undefined,
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: 'other-page-1',
          pageNumber: 1,
          size: { x: 10, y: 3 },
          getData: fixture.getData
        }
      ])
    })

    expect(paginateTxtDocument(otherDocument)).toBe(otherDocument)
    expect(fixture.getData).not.toHaveBeenCalled()
  })

  it('returns txt documents under the threshold unchanged', () => {
    const { document, getData } = makeTxtDocument(TXT_DOCUMENT_LINES_PER_PAGE)

    expect(paginateTxtDocument(document)).toBe(document)
    expect(getData).not.toHaveBeenCalled()
  })

  it('creates lazy synthetic pages with stable ids and sliced sizes', async () => {
    const { document, getData } = makeTxtDocument(5)

    const paginated = paginateTxtDocument(document, { linesPerPage: 2 })

    expect(paginated).not.toBe(document)
    expect(paginated.id).toBe(TXT_DOCUMENT_ID)
    expect(paginated.title).toBe('TXT Document')
    expect(paginated.pageCount).toBe(3)
    expect(paginated.pageNumbers).toEqual([1, 2, 3])
    expect(paginated.getPageSizeByPageNumber(1)).toEqual({ x: 6, y: 2 })
    expect(paginated.getPageSizeByPageNumber(2)).toEqual({ x: 6, y: 2 })
    expect(paginated.getPageSizeByPageNumber(3)).toEqual({ x: 6, y: 1 })
    expect(getData).not.toHaveBeenCalled()

    const page2 = await requirePage(paginated, 2)

    expect(page2.id).toBe('txt-parser-page-2')
    expect(page2.number).toBe(2)
    expect(page2.width).toBe(6)
    expect(page2.height).toBe(2)
  })

  it('does not load the original page or content during the transform', () => {
    const { document, getData, getContent } = makeTxtDocument(6)

    paginateTxtDocument(document, { linesPerPage: 2 })

    expect(getData).not.toHaveBeenCalled()
    expect(getContent).not.toHaveBeenCalled()
  })

  it('slices text rows lazily, shifts polygon y coordinates, and preserves text ids', async () => {
    const { document, getData, getContent } = makeTxtDocument(5)
    const paginated = paginateTxtDocument(document, { linesPerPage: 2 })

    const page2 = await requirePage(paginated, 2)
    const texts = await getTexts(page2)

    expect(getData).toHaveBeenCalledTimes(1)
    expect(getContent).toHaveBeenCalledTimes(1)
    expect(texts.map((text) => text.id)).toEqual([
      'txt-parser-text-3',
      'txt-parser-text-4'
    ])
    expect(texts.map((text) => text.content)).toEqual(['Line 3', 'Line 4'])
    expect(texts[0]?.polygon).toEqual([
      [0, 0],
      [6, 0],
      [6, 1],
      [0, 1]
    ])
    expect(texts[1]?.polygon).toEqual([
      [0, 1],
      [6, 1],
      [6, 2],
      [0, 2]
    ])
  })

  it('shifts paragraph rows and keeps paragraph textIds intact', async () => {
    const { document } = makeTxtDocument(5)
    const paginated = paginateTxtDocument(document, { linesPerPage: 2 })

    const page2 = await requirePage(paginated, 2)

    expect(page2.paragraphs.map((paragraph) => paragraph.y)).toEqual([0, 1])
    expect(page2.paragraphs.map((paragraph) => paragraph.textIds)).toEqual([
      ['txt-parser-text-3'],
      ['txt-parser-text-4']
    ])
  })

  it('does not mutate original page text or paragraph objects', async () => {
    const { document, texts, paragraphs } = makeTxtDocument(5)
    const originalPolygon = texts[2]?.polygon.map(([x, y]) => [x, y])
    const originalParagraphY = paragraphs[2]?.y
    const paginated = paginateTxtDocument(document, { linesPerPage: 2 })

    const page2 = await requirePage(paginated, 2)
    const [clonedText] = await getTexts(page2)
    const [clonedParagraph] = page2.paragraphs

    expect(clonedText).not.toBe(texts[2])
    expect(clonedParagraph).not.toBe(paragraphs[2])
    expect(texts[2]?.polygon).toEqual(originalPolygon)
    expect(paragraphs[2]?.y).toBe(originalParagraphY)
  })

  it('losslessly splits giant parser text across every synthetic page', async () => {
    // Given: txt-parser 0.3.0 把 501 行源文本编码为一个覆盖整页的 IntermediateText。
    const lineCount = TXT_DOCUMENT_LINES_PER_PAGE + 1
    const sourceContent = Array.from(
      { length: lineCount },
      (_, index) => `Line ${index + 1}`
    ).join('\n')
    const giantText = new IntermediateText({
      ...IntermediateText.serialize(makeLineText(1, sourceContent)),
      polygon: [
        [0, 0],
        [sourceContent.length, 0],
        [sourceContent.length, lineCount],
        [0, lineCount]
      ]
    })
    const sourcePage = new IntermediatePage({
      id: TXT_PAGE_ID,
      number: 1,
      width: sourceContent.length,
      height: lineCount,
      content: [],
      paragraphs: [],
      getContentFn: async () => [giantText]
    })
    const document = new IntermediateDocument({
      id: TXT_DOCUMENT_ID,
      title: 'TXT Document',
      outline: undefined,
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: TXT_PAGE_ID,
          pageNumber: 1,
          size: { x: sourceContent.length, y: lineCount },
          getData: async () => sourcePage
        }
      ])
    })

    // When: Reader 把该单页 TXT 转换为 synthetic pages。
    const paginated = paginateTxtDocument(document)
    const page1 = await requirePage(paginated, 1)
    const page2 = await requirePage(paginated, 2)
    const page1Texts = await getTexts(page1)
    const page2Texts = await getTexts(page2)

    // Then: 每页都有对应行，且拼接所有切片可精确恢复原始文本。
    expect(page1Texts).toHaveLength(TXT_DOCUMENT_LINES_PER_PAGE)
    expect(page2Texts).toHaveLength(1)
    expect(
      [...page1Texts, ...page2Texts].map((text) => text.content).join('')
    ).toBe(sourceContent)
    expect(page2Texts[0]?.content).toBe(`Line ${lineCount}`)
    expect(page2Texts[0]?.polygon).toEqual([
      [0, 0],
      [`Line ${lineCount}`.length, 0],
      [`Line ${lineCount}`.length, 1],
      [0, 1]
    ])
  })
})

describe('createTextModeDocument', () => {
  it('gets paginated text through the public API', async () => {
    // Given: Reader 默认会拆成两页的 501 行 TXT runtime document。
    const { document } = makeTxtDocument(TXT_DOCUMENT_LINES_PER_PAGE + 1)

    // When: 外部调用方使用和 Reader 一致的默认分页创建 Text Mode 文档。
    const textModeDocument = createTextModeDocument(document)
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const pages = await textModeDocument.getPages({ start: 2, end: 2 })

    // Then: 页码、公开 selection ID 和文字都与 Reader Text Mode 一致。
    expect(pages).toEqual([
      { pageNumber: 2, selectionId: 'page-2', text: 'Line 501' }
    ])
    expect(textModeDocument.pageCount).toBe(2)
    expect(textModeDocument.pageNumbers).toEqual([1, 2])
  })

  it('marks, updates, and removes a cross-page highlight', async () => {
    // Given: 已分页的 Text Mode 文档。
    const { document } = makeTxtDocument(TXT_DOCUMENT_LINES_PER_PAGE + 1)
    const changes: string[][] = []
    const textModeDocument = createTextModeDocument(document, {
      onHighlightsChange: (ranges) => {
        changes.push(ranges.map((range) => range.id))
      }
    })
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const [firstPage] = await textModeDocument.getPages({ start: 1, end: 1 })
    if (!firstPage) throw new Error('Expected the first Text Mode page')

    // When: 通过字符锚点跨页标记，然后修改颜色并删除。
    const marked = await textModeDocument.addHighlight({
      id: 'highlight-1',
      start: { selectionId: 'page-1', offset: firstPage.text.length - 1 },
      end: { selectionId: 'page-2', offset: 8 },
      createdAt: 1
    })
    const updated = textModeDocument.updateHighlight('highlight-1', {
      markerStyle: { backgroundColor: '#ffee58' }
    })
    const removed = textModeDocument.removeHighlight('highlight-1')

    // Then: 文字由同一分页内容提取，状态操作结果可查询且逐次通知宿主。
    expect(marked).toMatchObject({
      id: 'highlight-1',
      text: '0Line 501',
      rectsBySelectionId: {}
    })
    expect(updated?.markerStyle).toEqual({ backgroundColor: '#ffee58' })
    expect(removed).toBe(true)
    expect(textModeDocument.getHighlights()).toEqual([])
    expect(changes).toEqual([['highlight-1'], ['highlight-1'], []])
  })

  it('uses actual page numbers for sparse documents and highlights', async () => {
    // Given: 页码不连续且不从 1 开始的 Reader runtime document。
    const textModeDocument = createTextModeDocument(makeSparseDocument())
    if (!textModeDocument) throw new Error('Expected a Text Mode document')

    // When: 调用方按公开页码范围取页并跨越稀疏页创建高亮。
    const pages = await textModeDocument.getPages({ start: 2, end: 8 })
    const highlight = await textModeDocument.addHighlight({
      id: 'sparse-highlight',
      start: { selectionId: 'page-2', offset: 1 },
      end: { selectionId: 'page-8', offset: 1 },
      createdAt: 1
    })

    // Then: 只返回真实存在的页，文本按页面顺序拼接。
    expect(pages.map((page) => page.pageNumber)).toEqual([2, 4, 8])
    expect(highlight.text).toBe('wofoure')
  })

  it('recognizes structurally compatible text from another runtime', async () => {
    // Given: 类型兼容但原型链不同的 parser runtime 文本对象。
    const foreignText = new Proxy(makeLineText(1, 'Foreign text'), {
      getPrototypeOf: () => null
    })
    const page = new IntermediatePage({
      id: 'foreign-page',
      number: 1,
      width: 12,
      height: 1,
      content: [foreignText],
      paragraphs: []
    })
    const document = new IntermediateDocument({
      id: 'foreign-document',
      title: 'Foreign document',
      outline: undefined,
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: page.id,
          pageNumber: 1,
          size: { x: page.width, y: page.height },
          getData: async () => page
        }
      ])
    })

    // When: 控制器从 runtime 页面提取 Text Mode 文字。
    const textModeDocument = createTextModeDocument(document)
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const pages = await textModeDocument.getPages({ start: 1, end: 1 })

    // Then: 识别规则与 Reader 渲染侧一致，不依赖本包 class identity。
    expect(pages[0]?.text).toBe('Foreign text')
  })

  it('paginates structurally compatible foreign TXT lines without loss', async () => {
    // Given: 超过默认页大小、但文字实例来自另一原型链的 TXT runtime 文档。
    const lineCount = TXT_DOCUMENT_LINES_PER_PAGE + 1
    const foreignTexts = Array.from({ length: lineCount }, (_, index) => {
      const text = makeLineText(index + 1)
      Object.setPrototypeOf(text, null)
      return text
    })
    const sourcePage = new IntermediatePage({
      id: TXT_PAGE_ID,
      number: 1,
      width: 8,
      height: lineCount,
      content: [],
      paragraphs: [],
      getContentFn: async () => foreignTexts
    })
    const document = new IntermediateDocument({
      id: TXT_DOCUMENT_ID,
      title: 'Foreign TXT document',
      outline: undefined,
      pagesMap: IntermediatePageMap.makeByInfoList([
        {
          id: sourcePage.id,
          pageNumber: 1,
          size: { x: sourcePage.width, y: sourcePage.height },
          getData: async () => sourcePage
        }
      ])
    })

    // When: 公开控制器读取默认分页后的全部页面。
    const textModeDocument = createTextModeDocument(document)
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const pages = await textModeDocument.getPages({ start: 1, end: 2 })

    // Then: 第二页保留最后一行，所有 synthetic page 拼接后文字无损。
    expect(pages[1]?.text).toBe(`Line ${lineCount}`)
    expect(pages.map((page) => page.text).join('')).toBe(
      foreignTexts.map((text) => text.content).join('')
    )
  })

  it('derives highlight text and rejects invalid anchors', async () => {
    // Given: 单页 Text Mode 文档和一个试图伪造 text 的高亮输入。
    const { document } = makeTxtDocument(2)
    const textModeDocument = createTextModeDocument(document)
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const inputWithForgedText = {
      id: 'derived-text',
      text: 'forged',
      start: { selectionId: 'page-1', offset: 1 },
      end: { selectionId: 'page-1', offset: 4 },
      createdAt: 1
    }

    // When: 创建有效高亮，并尝试重复 ID、非规范页 ID、小数和空范围。
    const highlight = await textModeDocument.addHighlight(inputWithForgedText)

    // Then: text 始终从锚点派生，非法或含混锚点全部被拒绝。
    expect(highlight.text).toBe('ine')
    await expect(
      textModeDocument.addHighlight(inputWithForgedText)
    ).rejects.toThrow('already exists')
    await expect(
      textModeDocument.addHighlight({
        ...inputWithForgedText,
        id: 'leading-zero',
        start: { selectionId: 'page-01', offset: 0 }
      })
    ).rejects.toThrow('selection ID')
    await expect(
      textModeDocument.addHighlight({
        ...inputWithForgedText,
        id: 'fractional-offset',
        start: { selectionId: 'page-1', offset: 0.5 }
      })
    ).rejects.toThrow('offset')
    await expect(
      textModeDocument.addHighlight({
        ...inputWithForgedText,
        id: 'empty-range',
        start: { selectionId: 'page-1', offset: 1 },
        end: { selectionId: 'page-1', offset: 1 }
      })
    ).rejects.toThrow('must not be empty')
  })

  it('isolates highlight state from caller mutation', () => {
    // Given: 外部持有初始 range、查询结果和 change callback payload。
    const initial = {
      id: 'initial-highlight',
      text: 'Line',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 4 },
      createdAt: 1,
      rectsBySelectionId: {},
      markerStyle: { backgroundColor: '#ffee58' }
    }
    let notified: readonly import('../src').ReaderSelectionRange[] = []
    const textModeDocument = createTextModeDocument(
      makeTxtDocument(1).document,
      {
        highlights: [initial],
        onHighlightsChange: (ranges) => {
          notified = ranges
        }
      }
    )
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const queried = textModeDocument.getHighlights()[0]
    if (!queried) throw new Error('Expected the initial highlight')

    // When: 调用方修改传入对象、查询结果和 callback 收到的对象。
    initial.start.offset = 2
    queried.end.offset = 2
    textModeDocument.updateHighlight(initial.id, {
      markerStyle: { backgroundColor: '#abcdef' }
    })
    const notifiedRange = notified[0]
    if (!notifiedRange) throw new Error('Expected a change notification')
    notifiedRange.start.offset = 3

    // Then: 控制器内部状态只能通过显式 mutation API 改变。
    expect(textModeDocument.getHighlights()[0]).toMatchObject({
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 4 },
      markerStyle: { backgroundColor: '#abcdef' }
    })
  })

  it('snapshots highlight input before asynchronous page loading', async () => {
    // Given: 页面内容延迟返回，调用方仍持有高亮输入对象。
    const fixture = makeDeferredTextDocument()
    const textModeDocument = createTextModeDocument(fixture.document)
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const input = {
      id: 'deferred-highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 8 },
      createdAt: 1,
      markerStyle: { backgroundColor: '#ffee58' }
    }

    // When: 添加操作等待页面期间，调用方修改端点和样式。
    const pendingHighlight = textModeDocument.addHighlight(input)
    input.start.offset = 2
    input.markerStyle.backgroundColor = '#abcdef'
    fixture.releaseContent()
    const highlight = await pendingHighlight

    // Then: 已验证、提取和存储的范围全部来自调用入口快照。
    expect(highlight).toMatchObject({
      text: 'Deferred',
      start: { selectionId: 'page-1', offset: 0 },
      markerStyle: { backgroundColor: '#ffee58' }
    })
  })

  it('reserves highlight ids while asynchronous additions are pending', async () => {
    // Given: 两个同 ID 高亮会等待同一份页面内容。
    const fixture = makeDeferredTextDocument()
    const textModeDocument = createTextModeDocument(fixture.document)
    if (!textModeDocument) throw new Error('Expected a Text Mode document')
    const input = {
      id: 'concurrent-highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 8 },
      createdAt: 1
    }

    // When: 两次添加在首个 Promise 完成前并发启动。
    const additions = [
      textModeDocument.addHighlight(input),
      textModeDocument.addHighlight(input)
    ]
    fixture.releaseContent()
    const results = await Promise.allSettled(additions)

    // Then: ID 唯一约束在 pending 期间仍生效，控制器只保存一条记录。
    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected'
    ])
    expect(textModeDocument.getHighlights()).toHaveLength(1)
  })
})
