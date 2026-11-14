import type {
  ReaderSelectionEndpoint,
  ReaderSelectionRange
} from '../types/selection'

/** Independent channel: never extend the Web bridge v1 union. Runtime only. */
export const NATIVE_PDF_PROTOCOL = 1 as const
export type PdfIdentity = {
  readonly fileId: string
  readonly paneId: string
  readonly sessionId: string
  readonly generation: number
}
export type PdfRequest = PdfIdentity & { readonly requestId: string }
export type PdfSource = { readonly fileId: string; readonly localUri: string }
export type PdfPoint = { readonly x: number; readonly y: number }
export type PdfRect = PdfPoint & {
  readonly width: number
  readonly height: number
}
export type PdfMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number
]
export type PdfCrop = {
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
  readonly left?: number
}
export type PdfCapabilities = {
  readonly nativeLayout: boolean
  readonly thumbnails: boolean
  readonly textGeometry: boolean
  readonly pageImage: boolean
}
export type PdfGeometry = {
  /** Original one-based page, never the index in the filtered layout. */
  readonly pageNumber: number
  /** Rotation-applied scale-one visual size, same as saved px rectangles. */
  readonly width: number
  readonly height: number
  readonly rotation: number
  readonly crop: PdfCrop
  readonly pageToViewport: PdfMatrix
  readonly geometryRevision: number
}

/**
 * Native annotation boundary: native code exchanges source offsets and page
 * rectangles only. Reader business metadata, comments, storage keys and DOM
 * nodes stay in the host controller.
 */
export type NativePdfAnnotationIntent =
  | {
      readonly type: 'highlight'
      readonly rangeId?: string
      readonly start: ReaderSelectionEndpoint
      readonly end: ReaderSelectionEndpoint
      readonly rectsBySelectionId: Readonly<Record<string, readonly PdfRect[]>>
      readonly geometryRevision: number
    }
  | {
      readonly type: 'rectangle'
      readonly rectId?: string
      readonly pageNumber: number
      readonly rect: PdfRect
      readonly phase: 'preview' | 'commit' | 'cancel'
      readonly geometryRevision: number
    }

export type NativePdfAnnotationCommit = {
  readonly commitId: string
  readonly intent: NativePdfAnnotationIntent
}
export type PdfBoundary = {
  readonly offset: number
  readonly textId: string
  /** A source UTF-16 boundary in scale-one visual coordinates. */
  readonly rect: PdfRect
}
export type PdfGlyph = {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly rect: PdfRect
}
export type PdfCanonicalPage = {
  readonly pageNumber: number
  readonly text: string
  readonly width: number
  readonly height: number
  readonly boundaries: readonly PdfBoundary[]
  /** Text-only PNG; ephemeral and never serialized into ReaderData. */
  readonly textImage?: string
  readonly glyphs: readonly PdfGlyph[]
}
export type PdfErrorCode =
  | 'CORRUPT'
  | 'PASSWORD_REQUIRED'
  | 'PERMISSION'
  | 'CAPABILITY_MISSING'
  | 'MAPPING_NOT_READY'
  | 'INVALID_TARGET'
  | 'STALE_SESSION'
  | 'CANCELLED'
  | 'RENDER_FAILED'
export type PdfCommand = PdfRequest &
  (
    | { readonly type: 'open'; readonly source: PdfSource }
    | { readonly type: 'close' | 'cancel' | 'restoreComplete' }
    | {
        readonly type: 'navigate'
        readonly pageNumber: number
        readonly offset?: number
        readonly verticalPercentage?: number
      }
    | { readonly type: 'scale'; readonly value: number }
    | {
        readonly type: 'layout'
        readonly pages: readonly number[]
        readonly crops: Readonly<Record<string, PdfCrop>>
      }
    | {
        readonly type: 'text'
        readonly pages: readonly PdfCanonicalPage[]
        readonly retain: readonly number[]
      }
    | {
        readonly type: 'preview'
        readonly pageNumber: number
        readonly width: number
      }
    | {
        readonly type: 'annotations'
        readonly ranges: readonly ReaderSelectionRange[]
      }
    | {
        readonly type: 'selection'
        readonly range: ReaderSelectionRange | null
        readonly showMenu?: boolean
      }
  )
export type PdfEvent = PdfIdentity &
  (
    | { readonly type: 'loaded'; readonly pageCount: number }
    | {
        readonly type: 'displayed' | 'restored' | 'ready'
        readonly pageNumber: number
      }
    | {
        readonly type: 'geometry'
        readonly pages: readonly PdfGeometry[]
        readonly geometryRevision: number
      }
    | {
        readonly type: 'textNeeded'
        readonly pages: readonly number[]
        readonly retain: readonly number[]
        /** Per-page PDF text-layer classification. Missing pages are never emitted. */
        readonly textAvailability?: Readonly<
          Record<number, 'textLayer' | 'noTextLayer'>
        >
      }
    | {
        readonly type: 'selection'
        readonly start: ReaderSelectionEndpoint
        readonly end: ReaderSelectionEndpoint
        readonly rangeId?: string
        readonly phase: 'preview' | 'end'
        readonly geometryRevision: number
        readonly anchor: PdfRect
      }
    | { readonly type: 'cancelled' }
    | { readonly type: 'activate'; readonly rangeId: string }
    | { readonly type: 'link'; readonly url: string }
    | {
        readonly type: 'complete'
        readonly requestId: string
        readonly uri?: string
      }
    | {
        readonly type: 'error'
        readonly code: PdfErrorCode
        readonly requestId?: string
        readonly message?: string
      }
  )
export interface NativePdfAdapter {
  readonly capabilities: PdfCapabilities
  send(command: PdfCommand): void
  subscribe(listener: (event: PdfEvent) => void): () => void
}
