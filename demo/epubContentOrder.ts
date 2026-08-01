import type {
  IntermediateContentSerialized,
  IntermediateImageSerialized
} from '@hamster-note/types'

import type { ReaderIntermediateImageSerialized } from '../src'

export type EpubImagePlacement = {
  readonly alt: string | null
  readonly textBefore: string
}

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim()

export function getTextBeforeImage(image: Element): string {
  const parts: string[] = []
  const visit = (node: Node): boolean => {
    if (node === image) return true
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
      parts.push(node.nodeValue)
      return false
    }
    if (
      node instanceof Element &&
      ['script', 'style'].includes(node.localName.toLowerCase())
    ) {
      return false
    }
    return Array.from(node.childNodes).some(visit)
  }

  const body = image.ownerDocument.getElementsByTagNameNS('*', 'body')[0]
  if (body) visit(body)
  return normalizeText(parts.join(' '))
}

const isSerializedImage = (
  entry: IntermediateContentSerialized
): entry is IntermediateImageSerialized => 'src' in entry && 'polygon' in entry

const isSerializedText = (entry: IntermediateContentSerialized): boolean =>
  'content' in entry && 'fontSize' in entry

function findTextInsertionIndex(
  texts: readonly IntermediateContentSerialized[],
  textBefore: string
): number | null {
  const target = normalizeText(textBefore)
  if (!target) return 0

  const prefix: string[] = []
  for (const [index, text] of texts.entries()) {
    if (!('content' in text) || typeof text.content !== 'string') return null
    prefix.push(text.content)
    const normalizedPrefix = normalizeText(prefix.join(' '))
    if (normalizedPrefix === target) return index + 1
    if (!target.startsWith(normalizedPrefix)) return null
  }
  return null
}

export function restoreEpubContentOrder(
  content: readonly IntermediateContentSerialized[],
  placements: readonly EpubImagePlacement[]
): IntermediateContentSerialized[] {
  const texts = content.filter((entry) => !isSerializedImage(entry))
  const images = content.filter(isSerializedImage)
  if (
    images.length !== placements.length ||
    texts.some((entry) => !isSerializedText(entry))
  ) {
    return [...content]
  }

  const preparedImages = images.map((image, index) => {
    const placement = placements[index]
    const withAlt: ReaderIntermediateImageSerialized = placement?.alt
      ? { ...image, alt: placement.alt }
      : image
    return {
      image: withAlt,
      insertionIndex: placement
        ? findTextInsertionIndex(texts, placement.textBefore)
        : null
    }
  })
  if (preparedImages.some(({ insertionIndex }) => insertionIndex === null)) {
    return content.map((entry) => {
      if (!isSerializedImage(entry)) return entry
      const prepared = preparedImages.shift()
      return prepared?.image ?? entry
    })
  }

  const ordered: IntermediateContentSerialized[] = []
  for (let index = 0; index <= texts.length; index += 1) {
    for (const prepared of preparedImages) {
      if (prepared.insertionIndex === index) ordered.push(prepared.image)
    }
    const text = texts[index]
    if (text) ordered.push(text)
  }
  return ordered
}
