import type { IntermediateDocument } from '@hamster-note/types'

/** Original sources stay outside persisted ReaderData. Memoize this object per file. */
export type ReaderEngineSource = {
  readonly workerSrc?: string
  readonly documentOptions?: Readonly<Record<string, unknown>>
  /** Resolve the compatibility index only when the PDF text view mounts. */
  readonly loadTextDocument?: () => Promise<IntermediateDocument>
} & (
  | { readonly format: 'epub' | 'pdf'; readonly data: Uint8Array }
  | { readonly format: 'pdf'; readonly url: string }
  | {
      readonly format: 'pdf'
      readonly createRange: () => import('pdfjs-dist').PDFDataRangeTransport
    }
)
