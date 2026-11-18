import type { IntermediateContent } from '@hamster-note/types'
import type { ReaderExtraOcr } from '../../types/readerOcr'

export { prefixOcrTextIds } from './ocrTextIds'

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
