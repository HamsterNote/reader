import type { IntermediateDocument } from '@hamster-note/types'
import { vi } from 'vitest'

export const ImageParser = {
  encode: vi.fn(
    async (
      _input: ArrayBuffer | ArrayBufferView | Blob
    ): Promise<IntermediateDocument> => {
      return {
        id: 'ocr-doc',
        title: 'OCR Document',
        pageCount: 1,
        pageNumbers: [1],
        pages: [
          {
            id: 'ocr-page-1',
            number: 1,
            width: 100,
            height: 150,
            texts: [
              {
                id: 'ocr-text-1',
                content: 'OCR text',
                fontSize: 12,
                fontFamily: 'Arial',
                fontWeight: 400,
                italic: false,
                color: '#000000',
                polygon: [
                  [0, 0],
                  [50, 0],
                  [50, 20],
                  [0, 20]
                ],
                lineHeight: 16,
                ascent: 10,
                descent: 2,
                dir: 'ltr',
                skew: 0,
                isEOL: false
              }
            ]
          }
        ],
        getPageSizeByPageNumber: () => ({ x: 100, y: 150 }),
        getPageByPageNumber: (_pageNumber: number) =>
          Promise.resolve({
            getTexts: async () => []
          })
      } as unknown as IntermediateDocument
    }
  )
}
