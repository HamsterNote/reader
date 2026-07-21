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
  paginateTxtDocument,
  TXT_DOCUMENT_LINES_PER_PAGE
} from '../src/components/IntermediateDocumentViewer/paginateTxtDocument'

const [TXT_DOCUMENT_ID, TXT_PAGE_ID] = ['txt-parser-document', 'txt-parser-page-1']

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

  it('falls back to the original giant-span content instead of slicing invalid rows', async () => {
    const lineCount = TXT_DOCUMENT_LINES_PER_PAGE + 1
    const giantText = new IntermediateText({
      ...IntermediateText.serialize(makeLineText(1, 'A\nB')),
      polygon: [
        [0, 0],
        [1, 0],
        [1, lineCount],
        [0, lineCount]
      ]
    })
    const sourcePage = new IntermediatePage({
      id: TXT_PAGE_ID,
      number: 1,
      width: 1,
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
          size: { x: 1, y: lineCount },
          getData: async () => sourcePage
        }
      ])
    })

    const paginated = paginateTxtDocument(document)
    const page1 = await requirePage(paginated, 1)
    const page2 = await requirePage(paginated, 2)

    expect(await page1.getContent()).toEqual([giantText])
    expect(await page2.getContent()).toEqual([])
  })
})
