import type { IntermediateContent, IntermediateText } from '@hamster-note/types'
import type { ReaderExtraOcr } from './IntermediateDocumentViewer'

export const prefixOcrTextIds = (
  texts: IntermediateText[],
  pageNumber: number
) =>
  texts.map((text) => ({
    ...text,
    id: `ocr-${pageNumber}-${text.id}`,
    color: 'transparent'
  }))

export const fetchOcrContent = async (
  imageSource: string,
  extraOCR?: ReaderExtraOcr
): Promise<IntermediateContent[]> => {
  if (extraOCR) return (await extraOCR(imageSource)).getContent()
  const { ImageParser } = await import('@hamster-note/image-parser')
  const input = await (await fetch(imageSource)).blob()
  const document = await ImageParser.encode(input)
  const pages = await document.pages
  return pages[0]?.content ?? []
}
