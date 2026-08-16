import type { EpubParser } from '@hamster-note/epub-parser'
import type { IntermediateDocumentSerialized } from '@hamster-note/types'

type EpubRuntimeDocument = Awaited<ReturnType<EpubParser['encode']>>
type EpubDocumentSerializer = {
  readonly serialize: (
    document: EpubRuntimeDocument
  ) => Promise<IntermediateDocumentSerialized>
}

function isEpubDocumentSerializer(
  value: unknown
): value is EpubDocumentSerializer {
  if ((typeof value !== 'object' && typeof value !== 'function') || !value) {
    return false
  }

  return typeof Reflect.get(value, 'serialize') === 'function'
}

export async function convertEpubDocumentForReader(
  document: EpubRuntimeDocument
): Promise<IntermediateDocumentSerialized> {
  // EPUB parser 内部携带另一版 @hamster-note/types；先由其 runtime 序列化，再交给 Reader 解析。
  const documentClass = document.constructor
  if (!isEpubDocumentSerializer(documentClass)) {
    throw new Error('EPUB document serializer is unavailable')
  }

  return documentClass.serialize(document)
}
