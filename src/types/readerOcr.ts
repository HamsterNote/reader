import type { IntermediatePage } from '@hamster-note/types'

/** OCR 配置对象；pages 存在时仅识别列出的 1-based 页面。 */
export type ReaderOcrOptions = {
  enabled?: boolean
  pages?: readonly number[]
}

/** 既有外挂 OCR provider，输入页面原尺寸 base64 图片。 */
export type ReaderExtraOcr = (
  imageBase64: string
) => IntermediatePage | Promise<IntermediatePage>
