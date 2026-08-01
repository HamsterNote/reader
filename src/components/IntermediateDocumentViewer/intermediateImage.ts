import type {
  IntermediateImage,
  IntermediateImageSerialized
} from '@hamster-note/types'

/** Reader 对内容图片补充的可访问文本契约。 */
export type ReaderIntermediateImage = IntermediateImage & {
  readonly alt?: string
}

/** 序列化文档中与 ReaderIntermediateImage 对应的扩展。 */
export type ReaderIntermediateImageSerialized = IntermediateImageSerialized & {
  readonly alt?: string
}

export function getReaderImageAlt(image: object): string | undefined {
  const alt = Reflect.get(image, 'alt')
  if (typeof alt !== 'string') return undefined

  const normalized = alt.trim()
  return normalized || undefined
}
