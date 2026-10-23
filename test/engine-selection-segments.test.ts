import { IntermediateDocument, TextDir } from '@hamster-note/types'
import type { IntermediateTextSerialized } from '@hamster-note/types'
import { describe, expect, it } from 'vitest'
import { engineSelectionSegments } from '../src/components/selection/engineSelectionSegments'

function fixture() {
  const text = (id: string, content: string): IntermediateTextSerialized => ({
    id,
    content,
    fontSize: 16,
    fontFamily: '',
    fontWeight: 400,
    italic: false,
    color: '#000000',
    polygon: [
      [0, 0],
      [100, 0],
      [100, 20],
      [0, 20]
    ],
    lineHeight: 20,
    ascent: 16,
    descent: 4,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: false
  })
  return IntermediateDocument.parse({
    id: 'callback',
    title: 'Callback',
    pages: [
      {
        id: 'page-1',
        number: 1,
        width: 100,
        height: 200,
        texts: [text('a', 'alpha'), text('b', 'beta')]
      },
      {
        id: 'page-2',
        number: 2,
        width: 100,
        height: 200,
        texts: [text('c', 'gamma')]
      }
    ]
  })
}

describe('engine legacy selection callbacks', () => {
  it('preserves original text objects and emits per-text offsets across pages', async () => {
    const document = fixture()
    const [first, second] = await document.pages
    const original = [
      ...(await first.getContent()),
      ...(await second.getContent())
    ]
    const result = await engineSelectionSegments(document, {
      start: { selectionId: 'page-1', offset: 3 },
      end: { selectionId: 'page-2', offset: 2 },
      text: 'habetaga'
    })
    expect(result.texts).toHaveLength(3)
    result.texts.forEach((text, index) => expect(text).toBe(original[index]))
    expect(
      result.segments.map(
        ({ selectedText, startCharIndex, endCharIndex, pageNumber }) => ({
          selectedText,
          startCharIndex,
          endCharIndex,
          pageNumber
        })
      )
    ).toEqual([
      { selectedText: 'ha', startCharIndex: 3, endCharIndex: 5, pageNumber: 1 },
      {
        selectedText: 'beta',
        startCharIndex: 0,
        endCharIndex: 4,
        pageNumber: 1
      },
      { selectedText: 'ga', startCharIndex: 0, endCharIndex: 2, pageNumber: 2 }
    ])
    expect(
      result.segments.map((segment) => segment.selectedText).join('')
    ).toBe('habetaga')
  })

  it('does not include adjacent text when an endpoint lies on a boundary', async () => {
    const result = await engineSelectionSegments(fixture(), {
      start: { selectionId: 'page-1', offset: 5 },
      end: { selectionId: 'page-1', offset: 9 },
      text: 'beta'
    })
    expect(result.texts.map((text) => text.id)).toEqual(['b'])
    expect(result.segments[0].selectedText).toBe('beta')
  })
})
