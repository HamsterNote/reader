import type {
  IntermediateDocument,
  IntermediateText
} from '@hamster-note/types'
import type { ReaderSelectionRange } from '../../src/types/selection'

export function crossPageDocument(spaced: boolean) {
  const glyph = (content: string, index: number): IntermediateText =>
    ({
      id: `glyph-${index}`,
      content,
      fontSize: 12,
      polygon: [
        [index * 40, 20],
        [index * 40 + 30, 20],
        [index * 40 + 30, 32],
        [index * 40, 32]
      ],
      fontFamily: 'serif',
      fontWeight: 400,
      color: '#111',
      lineHeight: 18,
      ascent: 12,
      descent: 3,
      dir: 'ltr',
      skew: 0,
      isEOL: false
    }) as IntermediateText
  const page2 = spaced ? ['abc', '           ', 'def'] : ['abcdefg']
  return {
    id: 'cross-page',
    title: 'cross-page',
    pageCount: 2,
    pageNumbers: [1, 2],
    getPageSizeByPageNumber: () => ({ x: 300, y: 400 }),
    getPageByPageNumber: async (page: number) => ({
      getContent: async () => (page === 1 ? ['previous'] : page2).map(glyph)
    })
  } as unknown as IntermediateDocument
}

export const crossPageRange = (spaced: boolean): ReaderSelectionRange => ({
  id: 'saved',
  text: spaced ? 'previousabc def' : 'previousabcdefg',
  createdAt: 1,
  start: { selectionId: 'page-1', offset: 0 },
  end: { selectionId: 'page-2', offset: spaced ? 17 : 7 },
  selectionGroup: { id: 'logical', index: 0 },
  markerStyle: { backgroundColor: '#ff0000' },
  rectsBySelectionId: {}
})
