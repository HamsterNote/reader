declare module '@hamster-note/image-parser' {
  import type { IntermediateDocument } from '@hamster-note/types'
  export const ImageParser: {
    encode(
      input: ArrayBuffer | ArrayBufferView | Blob
    ): Promise<IntermediateDocument>
  }
}
