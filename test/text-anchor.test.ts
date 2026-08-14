import { describe, expect, it, vi } from 'vitest'

import {
  findTopTextAnchor,
  findTextAnchorAtOrBelow,
  getBookmarkKey,
  getTextAnchorKey,
  resolveTextAnchorElement,
  type TextAnchorElementRecord
} from '../src/components/IntermediateDocumentViewer/textAnchor'
import type { ReaderTextAnchor } from '../src/types/readerData'

function makeElementRect(
  element: HTMLElement,
  top: number,
  height: number
): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, top, 200, height)
  )
}

describe('text anchors', () => {
  it('captures the top text with an offset local to its page', () => {
    // Given: the viewport top crosses the second text on page 2.
    const viewport = document.createElement('div')
    const firstElement = document.createElement('span')
    const secondElement = document.createElement('span')
    makeElementRect(viewport, 100, 400)
    makeElementRect(firstElement, 20, 40)
    makeElementRect(secondElement, 80, 40)
    const pageTexts = [
      { id: 'page-2-first', content: 'first' },
      { id: 'page-2-second', content: 'second' }
    ]
    const records = new Map<string, TextAnchorElementRecord>([
      [
        'page-2-first',
        { text: pageTexts[0], pageNumber: 2, element: firstElement }
      ],
      [
        'page-2-second',
        { text: pageTexts[1], pageNumber: 2, element: secondElement }
      ]
    ])

    // When: the current reading anchor is sampled from the viewport.
    const anchor = findTopTextAnchor(
      viewport,
      records,
      new Map([[2, pageTexts]])
    )

    // Then: the offset counts only text before it on page 2.
    expect(anchor).toEqual({
      pageNumber: 2,
      textId: 'page-2-second',
      text: 'second',
      offset: 5
    })
  })

  it('captures the first text below a textless percentage position', () => {
    // Given: page 2 is at a textless percentage with more text farther down the page.
    const viewport = document.createElement('div')
    const previousElement = document.createElement('span')
    const nextElement = document.createElement('span')
    const laterElement = document.createElement('span')
    makeElementRect(viewport, 100, 100)
    makeElementRect(previousElement, 20, 40)
    makeElementRect(nextElement, 240, 40)
    makeElementRect(laterElement, 320, 40)
    const page2Texts = [
      { id: 'page-2-previous', content: 'previous' },
      { id: 'page-2-next', content: 'next' }
    ]
    const page3Texts = [{ id: 'page-3-later', content: 'later' }]
    const records = new Map<string, TextAnchorElementRecord>([
      [
        'page-2-previous',
        { text: page2Texts[0], pageNumber: 2, element: previousElement }
      ],
      [
        'page-2-next',
        { text: page2Texts[1], pageNumber: 2, element: nextElement }
      ],
      [
        'page-3-later',
        { text: page3Texts[0], pageNumber: 3, element: laterElement }
      ]
    ])

    // When: the anchor is sampled while Layout mode still identifies page 2.
    const anchor = findTextAnchorAtOrBelow(
      viewport,
      records,
      new Map([
        [2, page2Texts],
        [3, page3Texts]
      ]),
      2
    )

    // Then: scanning continues downward to the first text instead of jumping to a page top.
    expect(anchor).toEqual({
      pageNumber: 2,
      textId: 'page-2-next',
      text: 'next',
      offset: 8
    })
  })

  it('resolves an existing text id before considering its offset', () => {
    // Given: the persisted offset points to the first text but the id points to the second.
    const firstElement = document.createElement('span')
    const secondElement = document.createElement('span')
    const pageTexts = [
      { id: 'first', content: 'first' },
      { id: 'second', content: 'second' }
    ]
    const records = new Map<string, TextAnchorElementRecord>([
      ['first', { text: pageTexts[0], pageNumber: 3, element: firstElement }],
      ['second', { text: pageTexts[1], pageNumber: 3, element: secondElement }]
    ])
    const anchor: ReaderTextAnchor = {
      pageNumber: 3,
      textId: 'second',
      text: 'second',
      offset: 0
    }

    // When: the anchor is restored.
    const element = resolveTextAnchorElement(
      anchor,
      records,
      new Map([[3, pageTexts]])
    )

    // Then: the stable id wins.
    expect(element).toBe(secondElement)
  })

  it('falls back to the page-local offset when the text id is missing', () => {
    // Given: the saved text id disappeared while the same page content remains.
    const firstElement = document.createElement('span')
    const secondElement = document.createElement('span')
    const pageTexts = [
      { id: 'new-first', content: 'first' },
      { id: 'new-second', content: 'second' }
    ]
    const records = new Map<string, TextAnchorElementRecord>([
      [
        'new-first',
        { text: pageTexts[0], pageNumber: 4, element: firstElement }
      ],
      [
        'new-second',
        { text: pageTexts[1], pageNumber: 4, element: secondElement }
      ]
    ])
    const anchor: ReaderTextAnchor = {
      pageNumber: 4,
      textId: 'removed-id',
      text: 'second',
      offset: 5
    }

    // When: restoration cannot find the original id.
    const element = resolveTextAnchorElement(
      anchor,
      records,
      new Map([[4, pageTexts]])
    )

    // Then: offset 5 selects the second text on page 4.
    expect(element).toBe(secondElement)
  })

  it('uses page, id, and offset as bookmark identity', () => {
    const anchor: ReaderTextAnchor = {
      pageNumber: 7,
      textId: 'paragraph-2',
      text: 'Changed display text',
      offset: 18
    }

    expect(getTextAnchorKey(anchor)).toBe('7:paragraph-2:18')
  })

  it('uses page and vertical percentage as textless bookmark identity', () => {
    // Given: a bookmark points 37% down a page without text.
    const bookmark = { pageNumber: 4, verticalPercentage: 37 } as const

    // When: its stable identity is derived.
    const key = getBookmarkKey(bookmark)

    // Then: it cannot collide with a text-anchor identity.
    expect(key).toBe('page:4:37')
  })
})
