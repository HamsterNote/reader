declare module '@hamster-note/html-parser' {
  import type {
    IntermediateDocument,
    IntermediatePage
  } from '@hamster-note/types'

  export interface DecodeOptions {
    background?: {
      backgroundQuality?: number
    }
  }

  export const HtmlParser: {
    decodeToHtml(
      intermediateDocument: IntermediateDocument,
      options?: DecodeOptions
    ): Promise<string>
    decodePageToHtml(
      page: IntermediatePage | unknown,
      options?: DecodeOptions
    ): Promise<string>
  }
}
