import {
  IntermediateDocument,
  type IntermediateDocumentSerialized,
  IntermediatePageMap
} from '@hamster-note/types'

import { getReaderImageAlt } from './intermediateImage'
import {
  type PaginateTxtDocumentOptions,
  paginateTxtDocument
} from './paginateTxtDocument'

export type ReaderDocumentInput =
  | IntermediateDocument
  | IntermediateDocumentSerialized
  | null
  | undefined

export const isRuntimeDocument = (
  document: IntermediateDocument | IntermediateDocumentSerialized
): document is IntermediateDocument =>
  typeof Reflect.get(document, 'getPageByPageNumber') === 'function'

const serializedPageUsesFlowLayout = (page: object): boolean =>
  'useFlowLayout' in page && page.useFlowLayout === true

const getSerializedImageAlts = (
  serializedDocument: IntermediateDocumentSerialized
): ReadonlyMap<number, ReadonlyMap<string, string>> => {
  const imageAltsByPage = new Map<number, ReadonlyMap<string, string>>()

  for (const page of serializedDocument.pages) {
    const imageAlts = new Map<string, string>()
    for (const content of page.content ?? []) {
      const alt = getReaderImageAlt(content)
      if ('src' in content && alt) imageAlts.set(content.id, alt)
    }
    if (imageAlts.size > 0) imageAltsByPage.set(page.number, imageAlts)
  }

  return imageAltsByPage
}

const restoreSerializedFlowLayout = (
  runtimeDocument: IntermediateDocument,
  serializedDocument: IntermediateDocumentSerialized
): IntermediateDocument => {
  const flowLayoutPageNumbers = new Set(
    serializedDocument.pages
      .filter(serializedPageUsesFlowLayout)
      .map((page) => page.number)
  )
  const imageAltsByPage = getSerializedImageAlts(serializedDocument)
  if (flowLayoutPageNumbers.size === 0 && imageAltsByPage.size === 0) {
    return runtimeDocument
  }

  const pagesMap = IntermediatePageMap.makeByInfoList(
    serializedDocument.pages.map((serializedPage) => ({
      id: serializedPage.id,
      pageNumber: serializedPage.number,
      size: { x: serializedPage.width, y: serializedPage.height },
      getData: async () => {
        const pagePromise = runtimeDocument.getPageByPageNumber(
          serializedPage.number
        )
        if (!pagePromise) {
          throw new Error(`Missing runtime page ${serializedPage.number}`)
        }

        const page = await pagePromise
        if (flowLayoutPageNumbers.has(serializedPage.number)) {
          Object.defineProperty(page, 'useFlowLayout', {
            configurable: true,
            enumerable: true,
            value: true
          })
        }

        const imageAlts = imageAltsByPage.get(serializedPage.number)
        if (imageAlts) {
          for (const content of await page.getContent()) {
            const alt = imageAlts.get(content.id)
            if (!alt || !('src' in content)) continue

            Object.defineProperty(content, 'alt', {
              configurable: true,
              enumerable: true,
              value: alt
            })
          }
        }
        return page
      }
    }))
  )

  return new IntermediateDocument({
    id: runtimeDocument.id,
    title: runtimeDocument.title,
    outline: runtimeDocument.getOutline(),
    pagesMap
  })
}

export function getRuntimeDocument(
  inputDocument: ReaderDocumentInput,
  options: PaginateTxtDocumentOptions = {}
): IntermediateDocument | null {
  if (!inputDocument) return null
  const runtimeDocument = isRuntimeDocument(inputDocument)
    ? inputDocument
    : restoreSerializedFlowLayout(
        IntermediateDocument.parse(inputDocument),
        inputDocument
      )

  return paginateTxtDocument(runtimeDocument, options)
}
