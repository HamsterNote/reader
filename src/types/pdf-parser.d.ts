declare module '@hamster-note/pdf-parser' {
  import type { IntermediateDocument } from '@hamster-note/types'

  type ParserInput = ArrayBuffer | ArrayBufferView | Blob

  export interface EncodeOptions {
    filename?: string
  }

  export interface DecodeOptions {
    filename?: string
  }

  export interface ProgressInfo {
    loaded: number
    total: number
  }

  export type ProgressCallback = (info: ProgressInfo) => void

  export const PdfParser: {
    encode(
      fileOrBuffer: File | ArrayBuffer,
      options?: EncodeOptions,
      onProgress?: ProgressCallback
    ): Promise<IntermediateDocument | undefined>
    decode(
      intermediateDocument: IntermediateDocument,
      options?: DecodeOptions,
      onProgress?: ProgressCallback
    ): Promise<ParserInput>
  }

  export class GenerationError extends Error {
    constructor(message: string)
  }
}
