import type { IntermediateText } from '@hamster-note/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ReaderSavedSelection,
  ReaderSelectionOverlayRect
} from '../src/components/IntermediateDocumentViewer'
import {
  buildSavedSelection,
  denormalizePageRects,
  normalizePageRects,
  resolveSavedSelection,
  textHash,
  type TextElementInfo
} from '../src/components/selection/savedSelection'
import type { ReaderSelectedTextSegment } from '../src/components/selection/selectionPayloadSerializer'

type DomRectInput = {
  x: number
  y: number
  width: number
  height: number
}

type RectElement = HTMLElement & { __readerTestRect?: DomRectInput }

const makeDomRect = (rect: DomRectInput): DOMRect =>
  ({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => rect
  }) as DOMRect

const makeText = (
  id: string,
  content: string,
  polygon: IntermediateText['polygon'] = [
    [10, 20],
    [90, 20],
    [90, 36],
    [10, 36]
  ]
): IntermediateText =>
  ({
    id,
    content,
    fontSize: 12,
    fontFamily: 'Arial',
    fontWeight: 400,
    italic: false,
    color: '#111111',
    polygon,
    lineHeight: 16,
    ascent: 10,
    descent: 2,
    dir: 'ltr',
    skew: 0,
    isEOL: false
  }) as IntermediateText

const makeSegment = (options: {
  id: string
  content: string
  selectedText: string
  startCharIndex: number
  endCharIndex: number
  pageNumber?: number
  polygon?: IntermediateText['polygon']
}): ReaderSelectedTextSegment =>
  ({
    ...makeText(options.id, options.content, options.polygon),
    selectedText: options.selectedText,
    startCharIndex: options.startCharIndex,
    endCharIndex: options.endCharIndex,
    pageNumber: options.pageNumber
  }) as ReaderSelectedTextSegment

const makeTextElement = (
  text: IntermediateText,
  pageNumber: number,
  rect: DomRectInput = { x: 10, y: 20, width: 80, height: 16 }
): TextElementInfo => {
  const element = document.createElement('span') as RectElement
  element.dataset.textId = text.id
  element.dataset.pageNumber = String(pageNumber)
  element.textContent = text.content ?? ''
  element.__readerTestRect = rect
  document.body.append(element)
  return { element, text, pageNumber }
}

const makeSelection = (
  textNode: Text,
  start: number,
  end: number
): Selection => {
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, end)
  return {
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: textNode,
    focusNode: textNode,
    anchorOffset: start,
    focusOffset: end,
    getRangeAt: () => range,
    toString: () => textNode.data.slice(start, end)
  } as unknown as Selection
}

const makeSavedSelection = (
  overrides: Partial<ReaderSavedSelection> = {}
): ReaderSavedSelection => ({
  version: 1,
  id: 'saved-1',
  text: 'quick',
  start: {
    pageNumber: 1,
    textId: 'text-1',
    textHash: textHash('The quick brown fox'),
    charIndex: 4,
    contextBefore: 'The ',
    contextAfter: 'quick brown fox',
    bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
  },
  end: {
    pageNumber: 1,
    textId: 'text-1',
    textHash: textHash('The quick brown fox'),
    charIndex: 9,
    contextBefore: 'The quick',
    contextAfter: ' brown fox',
    bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
  },
  segments: [
    {
      pageNumber: 1,
      textId: 'text-1',
      textHash: textHash('The quick brown fox'),
      startCharIndex: 4,
      endCharIndex: 9,
      selectedText: 'quick',
      contextBefore: 'The ',
      contextAfter: ' brown fox',
      bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
    }
  ],
  visual: [
    {
      pageNumber: 1,
      pageSize: { width: 100, height: 100 },
      rects: [{ x: 0.1, y: 0.2, width: 0.8, height: 0.16 }]
    }
  ],
  ...overrides
})

describe('saved selection helpers', () => {
  let originalGetClientRects: Range['getClientRects'] | undefined
  let originalGetBoundingClientRect: Range['getBoundingClientRect'] | undefined

  beforeEach(() => {
    originalGetClientRects = Range.prototype.getClientRects
    originalGetBoundingClientRect = Range.prototype.getBoundingClientRect
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value(this: Range) {
        const parent = this.startContainer.parentElement as RectElement | null
        const rect = parent?.__readerTestRect
        return rect
          ? ([makeDomRect(rect)] as unknown as DOMRectList)
          : ([] as unknown as DOMRectList)
      }
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Range) {
        const parent = this.startContainer.parentElement as RectElement | null
        return makeDomRect(
          parent?.__readerTestRect ?? { x: 0, y: 0, width: 0, height: 0 }
        )
      }
    })
  })

  afterEach(() => {
    if (originalGetClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', {
        configurable: true,
        value: originalGetClientRects
      })
    } else {
      Reflect.deleteProperty(Range.prototype, 'getClientRects')
    }
    if (originalGetBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: originalGetBoundingClientRect
      })
    } else {
      Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    }
    document.body.replaceChildren()
  })

  it('produces deterministic hashes and normalized saved payloads', () => {
    const element = document.createElement('span')
    element.textContent = 'The quick brown fox'
    const textNode = element.firstChild as Text
    const selection = makeSelection(textNode, 4, 9)
    const segments = [
      makeSegment({
        id: 'text-1',
        content: 'The quick brown fox',
        selectedText: 'quick',
        startCharIndex: 4,
        endCharIndex: 9,
        pageNumber: 1
      })
    ]
    const saved = buildSavedSelection({
      id: 'saved-1',
      document: 'doc-1',
      selection,
      segments,
      rects: [{ x: 10, y: 20, width: 80, height: 16, pageNumber: 1 }],
      pageSizes: new Map([[1, { width: 100, height: 100 }]])
    })

    expect(textHash('The quick brown fox')).toBe(
      textHash('The quick brown fox')
    )
    expect(saved).toMatchObject({
      version: 1,
      id: 'saved-1',
      document: 'doc-1',
      text: 'quick',
      start: {
        pageNumber: 1,
        textId: 'text-1',
        charIndex: 4,
        contextBefore: 'The ',
        contextAfter: 'quick brown fox'
      },
      end: { pageNumber: 1, textId: 'text-1', charIndex: 9 },
      segments: [{ pageNumber: 1, selectedText: 'quick' }],
      visual: [
        {
          pageNumber: 1,
          pageSize: { width: 100, height: 100 },
          rects: [{ x: 0.1, y: 0.2, width: 0.8, height: 0.16 }]
        }
      ]
    })
  })

  it('clamps normalized rects and rejects invalid page sizes', () => {
    const rects: ReaderSelectionOverlayRect[] = [
      { x: -10, y: 20, width: 140, height: 90, pageNumber: 1 }
    ]

    expect(normalizePageRects(rects, { width: 100, height: 100 })).toEqual([
      { x: 0, y: 0.2, width: 1, height: 0.8 }
    ])
    expect(normalizePageRects(rects, { width: 0, height: 100 })).toEqual([])
    expect(
      denormalizePageRects([{ x: -0.5, y: 0.2, width: 1.5, height: 2 }], {
        width: 100,
        height: 100
      })
    ).toEqual([{ x: 0, y: 20, width: 100, height: 100, pageNumber: 0 }])
  })

  it('restores exact anchors before fallback paths', () => {
    const info = makeTextElement(makeText('text-1', 'The quick brown fox'), 1)
    const result = resolveSavedSelection(makeSavedSelection(), [info])

    expect(result.status).toBe('resolved')
    expect(result.range?.toString()).toBe('quick')
    expect(result.rects).toEqual([
      { x: 10, y: 20, width: 80, height: 16, pageNumber: 1 }
    ])
    expect(result.segments).toHaveLength(1)
  })

  it('restores by context when text id changes', () => {
    const info = makeTextElement(
      makeText('renamed-text', 'The quick brown fox'),
      1
    )
    // All saved references use the old id 'text-1' but the element now has id 'renamed-text'
    const saved = makeSavedSelection()

    const result = resolveSavedSelection(saved, [info])

    expect(result.status).toBe('resolved')
    expect(result.range?.toString()).toBe('quick')
    expect(result.rects).toEqual([
      { x: 10, y: 20, width: 80, height: 16, pageNumber: 1 }
    ])
  })

  it('marks ambiguous context matches unresolved when no visual data exists', () => {
    const first = makeTextElement(makeText('first', 'The quick brown fox'), 1)
    const second = makeTextElement(makeText('second', 'The quick brown fox'), 1)
    const saved = makeSavedSelection({
      start: { ...makeSavedSelection().start, textId: 'missing-id' },
      end: { ...makeSavedSelection().end, textId: 'missing-id' },
      visual: []
    })

    const result = resolveSavedSelection(saved, [first, second])

    expect(result.status).toBe('unresolved')
    expect(result.range).toBeUndefined()
  })

  it('restores by selected text after anchor mismatch', () => {
    const info = makeTextElement(makeText('text-2', 'A quick choice'), 1)
    const saved = makeSavedSelection({
      text: 'quick',
      start: {
        pageNumber: 1,
        textId: 'missing',
        textHash: 'stale',
        charIndex: 0
      },
      end: {
        pageNumber: 1,
        textId: 'missing',
        textHash: 'stale',
        charIndex: 5
      },
      segments: [
        {
          pageNumber: 1,
          textId: 'missing',
          selectedText: 'quick',
          bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.16 }
        }
      ]
    })

    const result = resolveSavedSelection(saved, [info])

    expect(result.status).toBe('resolved')
    expect(result.range?.toString()).toBe('quick')
  })

  it('uses visual fallback when text cannot resolve', () => {
    const result = resolveSavedSelection(makeSavedSelection(), [])

    expect(result.status).toBe('visual-fallback')
    expect(result.range).toBeUndefined()
    expect(result.rects).toEqual([
      { x: 10, y: 20, width: 80, height: 16, pageNumber: 1 }
    ])
    expect(result.segments).toEqual([])
  })

  it('restores cross-page selections with one editable range', () => {
    const first = makeTextElement(makeText('p1', 'Alpha start'), 1, {
      x: 5,
      y: 10,
      width: 50,
      height: 12
    })
    const second = makeTextElement(makeText('p2', 'finish Omega'), 2, {
      x: 6,
      y: 30,
      width: 70,
      height: 12
    })
    const saved: ReaderSavedSelection = {
      version: 1,
      id: 'cross-page',
      text: 'startfinish',
      start: {
        pageNumber: 1,
        textId: 'p1',
        textHash: textHash('Alpha start'),
        charIndex: 6
      },
      end: {
        pageNumber: 2,
        textId: 'p2',
        textHash: textHash('finish Omega'),
        charIndex: 6
      },
      segments: [
        {
          pageNumber: 1,
          textId: 'p1',
          startCharIndex: 6,
          endCharIndex: 11,
          selectedText: 'start'
        },
        {
          pageNumber: 2,
          textId: 'p2',
          startCharIndex: 0,
          endCharIndex: 6,
          selectedText: 'finish'
        }
      ],
      visual: []
    }

    const result = resolveSavedSelection(saved, [first, second])

    expect(result.status).toBe('resolved')
    expect(result.range).toBeInstanceOf(Range)
    expect(result.rects.map((rect) => rect.pageNumber)).toEqual([1, 2])
  })

  it('restores OCR text only when the OCR element is registered', () => {
    const ocrText = makeText('ocr-1', 'Detected OCR text')
    const saved = makeSavedSelection({
      text: 'OCR',
      start: {
        pageNumber: 1,
        textId: 'ocr-1',
        textHash: textHash('Detected OCR text'),
        charIndex: 9
      },
      end: {
        pageNumber: 1,
        textId: 'ocr-1',
        textHash: textHash('Detected OCR text'),
        charIndex: 12
      },
      segments: [
        {
          pageNumber: 1,
          textId: 'ocr-1',
          textHash: textHash('Detected OCR text'),
          startCharIndex: 9,
          endCharIndex: 12,
          selectedText: 'OCR'
        }
      ]
    })

    expect(resolveSavedSelection(saved, []).status).toBe('visual-fallback')
    expect(
      resolveSavedSelection(saved, [makeTextElement(ocrText, 1)]).status
    ).toBe('resolved')
  })
})
