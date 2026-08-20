import type {
  OpenDocumentHandle,
  OpenDocumentOptions
} from '@hamster-note/pdf-parser'
import type { PdfPageStructure } from './pdfStructureStorage'

type PdfJsDocumentOverrides = Readonly<Record<string, unknown>>

type PdfParserForReader = {
  readonly openDocument: (
    source: ArrayBuffer,
    options?: OpenDocumentOptions
  ) => Promise<OpenDocumentHandle>
}

type PdfParserSessionLoader = (
  data: ArrayBuffer,
  overrides?: PdfJsDocumentOverrides
) => Promise<unknown>

type PdfOpenOptions = OpenDocumentOptions & {
  readonly cachedPages?: readonly PdfPageStructure[]
  readonly cachedPageCount?: number
}

type CachedScanState = {
  readonly pageCount: number | undefined
  readonly pagesByNumber: Map<number, PdfPageStructure>
}

type PdfPageObjectResolver = (
  page: object,
  objectId: string
) => Promise<unknown>

const configuredParsers = new WeakSet<object>()
const cachedScanByParser = new WeakMap<object, CachedScanState>()

function applyCachedPageSizes(
  session: unknown,
  cachedScan: CachedScanState | undefined
): void {
  if (
    cachedScan === undefined ||
    typeof session !== 'object' ||
    session === null
  ) {
    return
  }

  const pdf = Reflect.get(session, 'pdf')
  if (typeof pdf !== 'object' || pdf === null) return
  if (
    cachedScan.pageCount !== undefined &&
    Reflect.get(pdf, 'numPages') !== cachedScan.pageCount
  ) {
    return
  }
  const getPage = Reflect.get(pdf, 'getPage')
  if (typeof getPage !== 'function') return

  const getPageWithCachedScan = async (pageNumber: number) => {
    const cachedPage = cachedScan.pagesByNumber.get(pageNumber)
    if (cachedPage === undefined) {
      return Reflect.apply(getPage, pdf, [pageNumber])
    }
    cachedScan.pagesByNumber.delete(pageNumber)
    return {
      getViewport: () => ({
        width: cachedPage.width,
        height: cachedPage.height
      })
    }
  }
  Reflect.set(pdf, 'getPage', getPageWithCachedScan)
}

export async function openPdfDocumentForReader(
  parser: PdfParserForReader,
  source: ArrayBuffer,
  options: PdfOpenOptions = {}
): Promise<OpenDocumentHandle> {
  const { cachedPageCount, cachedPages, ...parserOptions } = options
  if (cachedPages === undefined || cachedPages.length === 0) {
    return parser.openDocument(source, parserOptions)
  }

  cachedScanByParser.set(parser, {
    pageCount: cachedPageCount,
    pagesByNumber: new Map(
      cachedPages
        .filter(
          (page) =>
            parserOptions.pages === undefined ||
            parserOptions.pages.includes(page.pageNumber)
        )
        .map((page) => [page.pageNumber, page] as const)
    )
  })
  try {
    return await parser.openDocument(source, parserOptions)
  } finally {
    cachedScanByParser.delete(parser)
  }
}

export function configurePdfParserForReader(parser: object): boolean {
  if (configuredParsers.has(parser)) return true

  const loader = Reflect.get(parser, 'loadPdfSession')
  if (typeof loader !== 'function') return false

  const loadPdfSession: PdfParserSessionLoader = async (data, overrides) => {
    const session = await Reflect.apply(loader, parser, [
      data,
      {
        ...overrides,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false
      }
    ])
    applyCachedPageSizes(session, cachedScanByParser.get(parser))
    return session
  }

  Reflect.set(parser, 'loadPdfSession', loadPdfSession)

  const resolver = Reflect.get(parser, 'resolvePdfPageObject')
  if (typeof resolver === 'function') {
    const resolvePdfPageObject: PdfPageObjectResolver = (page, objectId) =>
      new Promise((resolve, reject) => {
        let settled = false
        const resolveOnce = (value: unknown) => {
          if (settled) return
          settled = true
          resolve(value)
        }

        try {
          const objectStore = Reflect.get(page, 'objs')
          if (typeof objectStore !== 'object' || objectStore === null) {
            resolveOnce(undefined)
            return
          }

          const get = Reflect.get(objectStore, 'get')
          if (typeof get !== 'function') {
            resolveOnce(undefined)
            return
          }

          const maybeValue = Reflect.apply(get, objectStore, [
            objectId,
            resolveOnce
          ])
          if (maybeValue !== undefined && maybeValue !== null) {
            resolveOnce(maybeValue)
          }
        } catch (error) {
          if (settled) return
          settled = true
          reject(error)
        }
      })

    Reflect.set(parser, 'resolvePdfPageObject', resolvePdfPageObject)
  }

  configuredParsers.add(parser)
  return true
}
