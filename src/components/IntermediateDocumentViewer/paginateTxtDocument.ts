import {
  type IntermediateContent,
  IntermediateDocument,
  IntermediatePage,
  IntermediatePageMap,
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'

export const TXT_DOCUMENT_LINES_PER_PAGE = 500

// 与 @hamster-note/txt-parser 0.3.0 dist、以及 per-line 分支源码保持一致。
// reader core 不能 import txt-parser，避免把解析器耦合进渲染核心。
const TXT_PARSER_DOCUMENT_ID = 'txt-parser-document'
const TXT_PARSER_PAGE_ID_PREFIX = 'txt-parser-page-'

type PaginateTxtDocumentOptions = {
  readonly linesPerPage?: number
}

type TextPolygon = IntermediateText['polygon']

type PageRange = {
  readonly pageNumber: number
  readonly lineOffset: number
  readonly lineCount: number
}

type LoadedSourcePage = {
  readonly page: IntermediatePage
  readonly content: readonly IntermediateContent[]
  readonly paragraphs: readonly IntermediateParagraph[]
}

type SourceContentResult =
  | {
      readonly kind: 'per-line'
      readonly source: LoadedSourcePage
    }
  | {
      readonly kind: 'fallback'
      readonly source: LoadedSourcePage
    }

function getPositiveLinesPerPage(linesPerPage: number | undefined): number {
  if (
    typeof linesPerPage === 'number' &&
    Number.isFinite(linesPerPage) &&
    linesPerPage > 0
  ) {
    return Math.floor(linesPerPage)
  }

  return TXT_DOCUMENT_LINES_PER_PAGE
}

function isTextContent(content: IntermediateContent): content is IntermediateText {
  return content instanceof IntermediateText
}

function getPolygonLineStart(text: IntermediateText): number | null {
  const [topLeft, topRight, bottomRight, bottomLeft] = text.polygon
  const topY = topLeft[1]
  const bottomY = bottomRight[1]
  const hasPerLineShape =
    topRight[1] === topY &&
    bottomLeft[1] === bottomY &&
    bottomY === topY + 1 &&
    Number.isInteger(topY) &&
    topY >= 0

  return hasPerLineShape ? topY : null
}

function isPerLineTxtContent(
  content: readonly IntermediateContent[],
  sourceHeight: number
): boolean {
  const texts = content.filter(isTextContent)
  if (texts.length !== sourceHeight) return false

  const expectedRows = new Set(
    Array.from({ length: sourceHeight }, (_, index) => index)
  )

  for (const text of texts) {
    const row = getPolygonLineStart(text)
    if (row === null || !expectedRows.delete(row)) return false
  }

  return expectedRows.size === 0
}

function shiftPolygonY(polygon: TextPolygon, lineOffset: number): TextPolygon {
  return [
    [polygon[0][0], polygon[0][1] - lineOffset],
    [polygon[1][0], polygon[1][1] - lineOffset],
    [polygon[2][0], polygon[2][1] - lineOffset],
    [polygon[3][0], polygon[3][1] - lineOffset]
  ]
}

function isRowInRange(row: number, range: PageRange): boolean {
  return row >= range.lineOffset && row < range.lineOffset + range.lineCount
}

function cloneShiftedText(
  text: IntermediateText,
  lineOffset: number
): IntermediateText {
  return new IntermediateText({
    ...IntermediateText.serialize(text),
    polygon: shiftPolygonY(text.polygon, lineOffset),
  })
}

function cloneShiftedParagraph(
  paragraph: IntermediateParagraph,
  lineOffset: number
): IntermediateParagraph {
  return new IntermediateParagraph({
    ...IntermediateParagraph.serialize(paragraph),
    y: paragraph.y - lineOffset,
  })
}

function slicePerLineContent(
  source: LoadedSourcePage,
  range: PageRange
): IntermediateContent[] {
  const content: IntermediateContent[] = []

  for (const entry of source.content) {
    if (entry instanceof IntermediateText) {
      const row = getPolygonLineStart(entry)
      if (row !== null && isRowInRange(row, range)) {
        content.push(cloneShiftedText(entry, range.lineOffset))
      }
      continue
    }

    // 当前 txt-parser 不会产生非文本内容。若未来出现图片等内容，按其
    // polygon 顶边 y 所在行归入对应 synthetic page，避免跨页重复渲染。
    const row = Math.floor(entry.polygon[0][1])
    if (isRowInRange(row, range)) {
      content.push(entry)
    }
  }

  return content
}

function sliceParagraphs(
  paragraphs: readonly IntermediateParagraph[],
  range: PageRange
): IntermediateParagraph[] {
  return paragraphs.flatMap((paragraph) => {
    if (!isRowInRange(paragraph.y, range)) return []
    return [cloneShiftedParagraph(paragraph, range.lineOffset)]
  })
}

function makeSyntheticPage(
  source: LoadedSourcePage,
  range: PageRange,
  width: number,
  content: IntermediateContent[],
  paragraphs: IntermediateParagraph[]
): IntermediatePage {
  return new IntermediatePage({
    id: `${TXT_PARSER_PAGE_ID_PREFIX}${range.pageNumber}`,
    number: range.pageNumber,
    width,
    height: range.lineCount,
    content,
    paragraphs,
    getThumbnailFn: (scale) => source.page.getThumbnail(scale)
  })
}

export function paginateTxtDocument(
  document: IntermediateDocument,
  options: PaginateTxtDocumentOptions = {}
): IntermediateDocument {
  const linesPerPage = getPositiveLinesPerPage(options.linesPerPage)
  const sourcePageNumbers = document.pageNumbers
  const hasTxtSinglePageShape =
    document.id === TXT_PARSER_DOCUMENT_ID &&
    document.pageCount === 1 &&
    sourcePageNumbers.length === 1 &&
    sourcePageNumbers[0] === 1

  if (!hasTxtSinglePageShape) return document

  const sourcePageSize = document.getPageSizeByPageNumber(1)
  const sourceWidth = sourcePageSize?.x
  const sourceHeight = sourcePageSize?.y
  const hasValidTxtPageSize =
    typeof sourceWidth === 'number' &&
    Number.isFinite(sourceWidth) &&
    sourceWidth > 0 &&
    typeof sourceHeight === 'number' &&
    Number.isInteger(sourceHeight) &&
    sourceHeight > 0

  if (!hasValidTxtPageSize || sourceHeight <= linesPerPage) {
    return document
  }

  // synthetic page loader 共享同一个 source promise；首次可见页加载时才读取
  // 原始 txt 单页内容，分页 transform 本身不触发 getContent()。
  let sourceContentPromise: Promise<SourceContentResult> | undefined
  const getSourceContentResult = () => {
    if (sourceContentPromise) return sourceContentPromise

    const sourcePagePromise = document.getPageByPageNumber(1)
    if (!sourcePagePromise) return undefined

    sourceContentPromise = sourcePagePromise.then(async (page) => {
      const content = await page.getContent()
      const source = {
        page,
        content,
        paragraphs: page.paragraphs
      } satisfies LoadedSourcePage

      if (!isPerLineTxtContent(content, sourceHeight)) {
        return { kind: 'fallback', source } satisfies SourceContentResult
      }

      return { kind: 'per-line', source } satisfies SourceContentResult
    })

    return sourceContentPromise
  }

  const pageCount = Math.ceil(sourceHeight / linesPerPage)
  const ranges = Array.from({ length: pageCount }, (_, index) => {
    const lineOffset = index * linesPerPage
    return {
      pageNumber: index + 1,
      lineOffset,
      lineCount: Math.min(linesPerPage, sourceHeight - lineOffset)
    } satisfies PageRange
  })

  return new IntermediateDocument({
    id: document.id,
    title: document.title,
    outline: document.outline,
    pagesMap: IntermediatePageMap.makeByInfoList(
      ranges.map((range) => ({
        id: `${TXT_PARSER_PAGE_ID_PREFIX}${range.pageNumber}`,
        pageNumber: range.pageNumber,
        size: { x: sourceWidth, y: range.lineCount },
        getData: async () => {
          const result = await getSourceContentResult()
          if (!result) {
            return new IntermediatePage({
              id: `${TXT_PARSER_PAGE_ID_PREFIX}${range.pageNumber}`,
              number: range.pageNumber,
              width: sourceWidth,
              height: range.lineCount,
              content: [],
              paragraphs: []
            })
          }

          if (result.kind === 'fallback') {
            return makeSyntheticPage(
              result.source,
              range,
              sourceWidth,
              range.pageNumber === 1 ? [...result.source.content] : [],
              range.pageNumber === 1 ? [...result.source.paragraphs] : []
            )
          }

          return makeSyntheticPage(
            result.source,
            range,
            sourceWidth,
            slicePerLineContent(result.source, range),
            sliceParagraphs(result.source.paragraphs, range)
          )
        }
      }))
    )
  })
}
