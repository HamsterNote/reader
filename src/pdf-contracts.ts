/** Host-owned local input. Adapters must copy bytes before transferring them. */
export type PdfSource =
  | {
      readonly kind: 'bytes'
      readonly bytes: Uint8Array
      readonly name?: string
    }
  | {
      readonly kind: 'uri'
      /** Local file/content/blob URI; remote schemes must fail before I/O. */
      readonly uri: string
      readonly name?: string
      readonly mimeType?: string
    }

/** Every asynchronous result belongs to exactly one opening of a source. */
export type PdfSessionIdentity = {
  readonly sessionId: string
  readonly generation: number
}

export type PdfMetadata = PdfSessionIdentity & {
  readonly pageCount: number
}

export type PdfPageState = PdfMetadata & {
  /** Original physical page number, starting at 1. */
  readonly pageNumber: number
}

/** Logical points/CSS px relative to the reader content area's top-left. */
export type PdfRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type PdfSelection = PdfSessionIdentity & {
  readonly selectionId: string
  readonly text: string
  readonly rects: readonly PdfRect[]
  readonly coordinateSpace: 'reader'
}

export type PdfThumbnail = PdfSessionIdentity & {
  readonly pageNumber: number
  /** Reader-owned image URI. Never the original host document URI. */
  readonly uri: string
  readonly width: number
  readonly height: number
}

export type PdfError = {
  readonly category: 'read' | 'invalid' | 'unsupported' | 'drm' | 'render'
  readonly code: string
  readonly message: string
}

export type PdfLoadState =
  | { readonly status: 'idle' }
  | (PdfSessionIdentity & { readonly status: 'loading' })
  | (PdfPageState & { readonly status: 'ready' })
  | (PdfSessionIdentity & {
      readonly status: 'error'
      readonly error: PdfError
    })

export type PdfSessionEvents = {
  readonly onStateChange: (state: PdfLoadState) => void
  readonly onMetadata: (metadata: PdfMetadata) => void
  readonly onPageChange: (page: PdfPageState) => void
  readonly onSelectionChange: (
    identity: PdfSessionIdentity,
    selection: PdfSelection | null
  ) => void
}

/** Engine operations; no EPUB locations, annotations, storage or DOM handles. */
export interface PdfSession {
  readonly identity: PdfSessionIdentity
  /** Invalid/out-of-range requests return false and preserve the current page. */
  goToPage(pageNumber: number): Promise<boolean>
  /** Failure is local to this thumbnail, not a document load failure. */
  getThumbnail(pageNumber: number): Promise<PdfThumbnail | null>
  clearSelection(): void
  /** Idempotent; cancels work and releases only reader-owned resources. */
  dispose(): void
}

export interface PdfAdapter {
  open(
    source: PdfSource,
    identity: PdfSessionIdentity,
    events: PdfSessionEvents
  ): PdfSession
}

export function isPdfPageNumber(value: number, pageCount: number): boolean {
  return (
    Number.isSafeInteger(pageCount) &&
    pageCount > 0 &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= pageCount
  )
}

/** Shared temporary overlay geometry, in reader-local logical coordinates. */
export function getPdfPopoverPosition(
  selection: PdfSelection | null,
  width: number,
  height: number
): { left: number; top: number } | null {
  const rect = selection?.rects[0]
  if (!rect || width <= 0 || height <= 0) return null
  return {
    left: Math.max(4, Math.min(rect.x, width - 80)),
    top: Math.max(
      4,
      Math.min(
        rect.y >= 44 ? rect.y - 42 : rect.y + rect.height + 6,
        height - 42
      )
    )
  }
}
