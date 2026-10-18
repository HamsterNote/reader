import type { IntermediateDocumentSerialized } from '@hamster-note/types'

import type { PdfSource } from '../pdf-contracts'

export async function readLocalSource(
  source: PdfSource,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (signal.aborted) throw new Error('Source retired')
  if (source.kind === 'bytes') return source.bytes.slice()
  if (source.kind !== 'uri' || !/^blob:[^\s]+$/.test(source.uri)) {
    throw new LocalSourceError('unsupported', 'UNSUPPORTED_SOURCE')
  }
  const response = await fetch(source.uri, { signal })
  if (!response.ok) throw new LocalSourceError('read', 'READ_FAILED')
  return new Uint8Array(await response.arrayBuffer())
}

export function isPdfSource(bytes: Uint8Array): boolean {
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every(
    (value, index) => bytes[index] === value
  )
}

export class LocalSourceError extends Error {
  constructor(
    readonly category: 'unsupported' | 'read' | 'invalid',
    readonly code: string
  ) {
    super(
      category === 'unsupported'
        ? 'Select a local PDF or EPUB.'
        : 'The document could not be opened.'
    )
  }
}

export async function parseLocalEpub(
  bytes: Uint8Array
): Promise<IntermediateDocumentSerialized> {
  const { EpubParser } = await import('@hamster-note/epub-parser')
  const publication = await EpubParser.encode(bytes)
  const document = publication.getIntermediateDocument()
  const serializer = document.constructor as {
    serialize?: (
      value: typeof document
    ) => Promise<IntermediateDocumentSerialized>
  }
  if (!serializer.serialize)
    throw new LocalSourceError('invalid', 'INVALID_EPUB')
  return serializer.serialize(document)
}
