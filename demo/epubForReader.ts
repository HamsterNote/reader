import type { EpubParser } from '@hamster-note/epub-parser'
import type {
  IntermediateContentSerialized,
  IntermediateDocumentSerialized,
  IntermediateImageSerialized
} from '@hamster-note/types'

import type { ReaderIntermediateImageSerialized } from '../src'

import {
  type EpubImagePlacement,
  restoreEpubContentOrder
} from './epubContentOrder'
import { type EpubBinaryInput, getEpubImageMetadata } from './epubImageMetadata'

type EpubParserDocument = Awaited<ReturnType<typeof EpubParser.encode>>
type EpubRuntimeDocument = ReturnType<
  EpubParserDocument['getIntermediateDocument']
>
type EpubDocumentSerializer = {
  readonly serialize: (
    document: EpubRuntimeDocument
  ) => Promise<IntermediateDocumentSerialized>
}
type EpubCover = {
  readonly href: string
  readonly id: string
  readonly src: string
}

function isEpubDocumentSerializer(
  value: unknown
): value is EpubDocumentSerializer {
  if ((typeof value !== 'object' && typeof value !== 'function') || !value) {
    return false
  }

  return typeof Reflect.get(value, 'serialize') === 'function'
}

function isSerializedImage(
  content: IntermediateContentSerialized
): content is IntermediateImageSerialized {
  return 'src' in content && 'polygon' in content
}

function addImageAlts(
  pages: IntermediateDocumentSerialized['pages'],
  imageAltsByPage: readonly (readonly (string | null)[])[]
): IntermediateDocumentSerialized['pages'] {
  return pages.map((page, pageIndex) => {
    const imageAlts = imageAltsByPage[pageIndex]
    if (!imageAlts || imageAlts.length === 0 || !page.content) return page

    let imageIndex = 0
    const content = page.content.map((entry) => {
      if (!isSerializedImage(entry)) return entry

      const alt = imageAlts[imageIndex]
      imageIndex += 1
      return alt ? { ...entry, alt } : entry
    })

    return { ...page, content }
  })
}

function restorePageContentOrder(
  pages: IntermediateDocumentSerialized['pages'],
  imagePlacementsByPage: readonly (readonly EpubImagePlacement[])[]
): IntermediateDocumentSerialized['pages'] {
  return pages.map((page, pageIndex) =>
    page.content
      ? {
          ...page,
          content: restoreEpubContentOrder(
            page.content,
            imagePlacementsByPage[pageIndex] ?? []
          )
        }
      : page
  )
}

function getEpubCover(document: object): EpubCover | null {
  const cover = Reflect.get(document, 'epubCover')
  if (!cover || typeof cover !== 'object') return null

  const href = Reflect.get(cover, 'href')
  const id = Reflect.get(cover, 'id')
  const src = Reflect.get(cover, 'src')
  if (typeof href !== 'string' || typeof src !== 'string') return null

  const normalizedHref = href.trim()
  const normalizedSrc = src.trim()
  if (!normalizedHref || !normalizedSrc) return null

  return {
    href: normalizedHref,
    id: typeof id === 'string' && id.trim() ? id.trim() : 'cover',
    src: normalizedSrc
  }
}

function addManifestCover(
  document: IntermediateDocumentSerialized,
  cover: EpubCover,
  alt: string | null
): IntermediateDocumentSerialized {
  const width = document.pages[0]?.width ?? 595
  const height = document.pages[0]?.height ?? 842
  const image = {
    id: cover.id,
    src: cover.src,
    polygon: [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height]
    ],
    opacity: 1
  } satisfies ReaderIntermediateImageSerialized
  const coverPage = {
    id: `${document.id}-cover-page`,
    content: [alt ? { ...image, alt } : image],
    width,
    height,
    number: 1,
    useFlowLayout: true
  }

  return {
    ...document,
    pages: [
      coverPage,
      ...document.pages.map((page, index) => ({
        ...page,
        number: index + 2
      }))
    ]
  }
}

export async function convertEpubDocumentForReader(
  epubDocument: EpubParserDocument,
  source?: EpubBinaryInput
): Promise<IntermediateDocumentSerialized> {
  const document = epubDocument.getIntermediateDocument()
  // EPUB parser 内部携带另一版 @hamster-note/types；先由其 runtime 序列化，再交给 Reader 解析。
  const documentClass = document.constructor
  if (!isEpubDocumentSerializer(documentClass)) {
    throw new Error('EPUB document serializer is unavailable')
  }

  const serializedDocument = await documentClass.serialize(document)
  const cover = getEpubCover(document)
  const imageMetadata = source
    ? await getEpubImageMetadata(source, cover?.href ?? null)
    : null
  const pages = imageMetadata
    ? restorePageContentOrder(
        addImageAlts(serializedDocument.pages, imageMetadata.altsByPage),
        imageMetadata.imagePlacementsByPage
      )
    : serializedDocument.pages
  const documentWithImageAlts = { ...serializedDocument, pages }

  return cover && imageMetadata && !imageMetadata.coverInSpine
    ? addManifestCover(
        documentWithImageAlts,
        cover,
        imageMetadata.coverAlt ?? serializedDocument.title ?? 'Cover'
      )
    : documentWithImageAlts
}
