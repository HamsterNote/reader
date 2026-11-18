import type { IntermediateContent } from '@hamster-note/types'
import type { ReaderExtraOcr } from '../../types/readerOcr'

export { prefixOcrTextIds } from './ocrTextIds'

/** The browser's ONNX/OpenCV parser cannot run inside the RN JS runtime. */
export const fetchOcrContent = async (
  imageSource: string,
  extraOCR?: ReaderExtraOcr
): Promise<IntermediateContent[]> => {
  if (!extraOCR) throw new Error('iOS 原生 OCR 需要配置 extraOCR provider')
  return (await extraOCR(imageSource)).getContent()
}
