import type { ReaderTextAnchor } from '../types/readerData'

/**
 * Native beta.3 used page-N plus the whole displayed chapter. Its offsets
 * exclude display-only newlines and image placeholders. Unlike the reader
 * compatibility stream, that parser did not insert spaces around inline tags.
 * Validate the entire source stream before projecting; never search for a
 * matching excerpt (which would silently rebind repeated paragraphs).
 */
export const resolveEpubTextAnchor = (
  anchor: ReaderTextAnchor,
  pageText: string
): ReaderTextAnchor => {
  let offset = anchor.offset
  if (anchor.textId === `page-${anchor.pageNumber}`) {
    offset = projectNativeOffset(anchor.text, offset, pageText)
  }
  if (!Number.isInteger(offset) || offset < 0 || offset >= pageText.length)
    throw new Error('无法精确恢复阅读位置：源字符已失效')
  // Reflows and subsequent captures must use the engine coordinate system,
  // not the incoming native identifier/text with an already projected offset.
  return {
    pageNumber: anchor.pageNumber,
    textId: `page-${anchor.pageNumber}-text`,
    text: pageText.slice(offset, offset + 1),
    offset
  }
}

const projectNativeOffset = (
  text: string,
  offset: number,
  pageText: string
): number => {
  const source = text.replace(/[\r\n\uFFFC]/g, '')
  if (!Number.isInteger(offset) || offset < 0 || offset >= source.length)
    throw new Error('无法精确恢复阅读位置：原生源字符已失效')
  let sourceIndex = 0
  let projected = -1
  for (let targetIndex = 0; targetIndex < pageText.length; targetIndex++) {
    if (pageText[targetIndex] === source[sourceIndex]) {
      if (sourceIndex === offset) projected = targetIndex
      sourceIndex++
    } else if (pageText[targetIndex] !== ' ') {
      throw new Error('无法精确恢复阅读位置：原生源文本不匹配')
    }
  }
  if (sourceIndex !== source.length || projected < 0)
    throw new Error('无法精确恢复阅读位置：原生源文本不匹配')
  return projected
}
