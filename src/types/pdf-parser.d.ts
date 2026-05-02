declare module '@hamster-note/pdf-parser' {
  import type { IntermediateDocument } from '@hamster-note/types'

  export const PdfParser: {
    encode(
      fileOrBuffer: File | ArrayBuffer
    ): Promise<IntermediateDocument | undefined>
  }
}
