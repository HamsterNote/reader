import type { PdfError } from '../pdf-contracts'

export type ReaderSourceLoadState =
  | { readonly status: 'idle' | 'loading' | 'ready' }
  | { readonly status: 'error'; readonly error: PdfError }
