type PdfJsDocumentOverrides = Readonly<Record<string, unknown>>

type PdfEncodeProgress = {
  readonly current: number
  readonly total: number
}

type PdfEncodeProgressReporter = (progress: PdfEncodeProgress) => void

type PdfOpenOptions = {
  readonly onProgress?: PdfEncodeProgressReporter
  readonly pages?: number[]
  readonly signal?: AbortSignal
}

type PdfParserForReader<Document> = {
  readonly encode: (
    source: ArrayBuffer,
    options?: { readonly pages?: number[] },
    onProgress?: PdfEncodeProgressReporter
  ) => Promise<Document | undefined>
  readonly openDocument?: (
    source: ArrayBuffer,
    options?: PdfOpenOptions
  ) => Promise<PdfDocumentHandle<Document>>
}

export type PdfDocumentHandle<Document> = {
  readonly document: Document
  readonly dispose: () => Promise<void>
}

type PdfParserSessionLoader = (
  data: ArrayBuffer,
  overrides?: PdfJsDocumentOverrides
) => Promise<unknown>

type PdfPageObjectResolver = (
  page: object,
  objectId: string
) => Promise<unknown>

const configuredParsers = new WeakSet<object>()

export async function openPdfDocumentForReader<Document>(
  parser: PdfParserForReader<Document>,
  source: ArrayBuffer,
  options: PdfOpenOptions = {}
): Promise<PdfDocumentHandle<Document>> {
  if (parser.openDocument !== undefined) {
    return parser.openDocument(source, options)
  }

  const document = await parser.encode(
    source,
    { pages: options.pages },
    options.onProgress
  )
  if (document === undefined) throw new Error('PDF parser returned no document')

  return {
    document,
    dispose: async () => undefined
  }
}

export function configurePdfParserForReader(parser: object): boolean {
  if (configuredParsers.has(parser)) return true

  const loader = Reflect.get(parser, 'loadPdfSession')
  if (typeof loader !== 'function') return false

  const loadPdfSession: PdfParserSessionLoader = (data, overrides) =>
    Reflect.apply(loader, parser, [
      data,
      {
        ...overrides,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false
      }
    ])

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
