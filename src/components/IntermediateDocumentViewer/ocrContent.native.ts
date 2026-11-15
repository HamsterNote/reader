import type { IntermediateContent } from '@hamster-note/types'
import type { ReaderExtraOcr } from '../../types/readerOcr'

export { prefixOcrTextIds } from './ocrTextIds'

/** Metro selects this provider boundary; ImageParser requires a browser. */
export const fetchOcrContent = async (
  imageSource: string,
  extraOCR?: ReaderExtraOcr
): Promise<IntermediateContent[]> => {
  if (!extraOCR) throw new Error('原生 OCR 需要配置 extraOCR provider')
  return (await extraOCR(imageSource)).getContent()
}
