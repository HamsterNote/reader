import { describe, expect, it } from 'vitest'

import {
  parseHighlights,
  serializeHighlights,
  type ReaderSelectionRange,
  type ReaderSelectionRectangle
} from '../demo/highlightStorage'

const linkedRangeA: ReaderSelectionRange = {
  id: 'range-a',
  text: 'hello',
  start: { selectionId: 'page-1', offset: 2 },
  end: { selectionId: 'page-1', offset: 7 },
  createdAt: 1000,
  overlayRectType: 'percent',
  rectsBySelectionId: {
    'page-1': [{ x: 10, y: 20, width: 30, height: 40 }]
  }
}

const linkedRangeB: ReaderSelectionRange = {
  id: 'range-b',
  text: 'world',
  start: { selectionId: 'page-2', offset: 0 },
  end: { selectionId: 'page-3', offset: 5 },
  createdAt: 2000,
  rectsBySelectionId: {
    'page-2': [{ x: 1, y: 2, width: 3, height: 4 }],
    'page-3': [{ x: 5, y: 6, width: 7, height: 8 }]
  },
  markerStyle: { backgroundColor: 'rgba(255, 193, 7, 0.35)' }
}

const rectA: ReaderSelectionRectangle = {
  id: 'rect-a',
  createdAt: 3000,
  overlayRectType: 'percent',
  start: { x: 10, y: 20 },
  end: { x: 40, y: 60 },
  rect: { x: 10, y: 20, width: 30, height: 40 }
}

const rectB: ReaderSelectionRectangle = {
  id: 'rect-b',
  createdAt: 4000,
  overlayRectType: 'percent',
  start: { x: 1, y: 2 },
  end: { x: 4, y: 6 },
  rect: { x: 1, y: 2, width: 3, height: 4 }
}

describe('highlight storage helpers', () => {
  it('parses all valid linked ranges and rects when storage is v3', () => {
    const raw = JSON.stringify({
      version: 3,
      ranges: [linkedRangeA, linkedRangeB],
      rects: [rectA, rectB]
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({
      ranges: [linkedRangeA, linkedRangeB],
      rects: [rectA, rectB]
    })
  })

  it('serializes ranges and rects with the exact v3 envelope', () => {
    const ranges = [linkedRangeA, linkedRangeB]
    const rects = [rectA, rectB]

    const serialized = serializeHighlights(ranges, rects)

    expect(JSON.parse(serialized)).toEqual({
      version: 3,
      ranges,
      rects
    })
  })

  it('parses v2 envelopes and treats rects as missing', () => {
    const raw = JSON.stringify({
      version: 2,
      ranges: [linkedRangeA]
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({ ranges: [linkedRangeA], rects: [] })
  })

  it('returns empty arrays when storage is missing or empty', () => {
    const rawValues = [null, '', '   ']

    const parsedValues = rawValues.map((raw) => parseHighlights(raw))

    expect(parsedValues).toEqual([
      { ranges: [], rects: [] },
      { ranges: [], rects: [] },
      { ranges: [], rects: [] }
    ])
  })

  it('returns empty arrays when storage JSON is corrupt', () => {
    const raw = '{"version":3,"ranges":['

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({ ranges: [], rects: [] })
  })

  it('returns empty arrays when storage has the wrong shape', () => {
    const wrongShapes = [
      'null',
      '42',
      JSON.stringify({ version: 3 }),
      JSON.stringify({ version: 3, ranges: linkedRangeA }),
      JSON.stringify({ version: 3, ranges: [linkedRangeA], rects: rectA })
    ]

    const parsedValues = wrongShapes.map((raw) => parseHighlights(raw))

    expect(parsedValues).toEqual([
      { ranges: [], rects: [] },
      { ranges: [], rects: [] },
      { ranges: [], rects: [] },
      { ranges: [], rects: [] },
      { ranges: [], rects: [] }
    ])
  })

  it('keeps valid linked ranges and drops invalid entries in mixed v3 data', () => {
    const raw = JSON.stringify({
      version: 3,
      ranges: [
        linkedRangeA,
        { ...linkedRangeA, id: 123 },
        { ...linkedRangeA, start: { selectionId: 'page-0', offset: 2 } },
        { ...linkedRangeA, rectsBySelectionId: { 'page-1': [{ x: 1 }] } },
        null,
        linkedRangeB
      ],
      rects: [
        rectA,
        { ...rectA, id: 456 },
        { ...rectA, rect: { x: 1 } },
        null,
        rectB
      ]
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({
      ranges: [linkedRangeA, linkedRangeB],
      rects: [rectA, rectB]
    })
  })

  it('returns empty arrays for unversioned old bare arrays and legacy objects', () => {
    const oldBareArray = JSON.stringify([
      {
        id: 'old-range',
        text: 'legacy',
        start: 0,
        end: 6,
        createdAt: 100,
        rects: [{ x: 1, y: 2, width: 3, height: 4 }]
      }
    ])
    const legacyObject = JSON.stringify({
      id: 'old-range',
      text: 'legacy',
      start: 0,
      end: 6,
      createdAt: 100,
      rects: [{ x: 1, y: 2, width: 3, height: 4 }]
    })

    const parsedValues = [
      parseHighlights(oldBareArray),
      parseHighlights(legacyObject)
    ]

    expect(parsedValues).toEqual([
      { ranges: [], rects: [] },
      { ranges: [], rects: [] }
    ])
  })

  it('rejects persisted ranges containing runtime-scoped selection ids', () => {
    const runtimeEndpointRange = {
      ...linkedRangeA,
      start: { selectionId: 'reader-1:page-1', offset: 2 }
    }
    const runtimeRectKeyRange = {
      ...linkedRangeB,
      rectsBySelectionId: {
        'reader-1:page-2': [{ x: 1, y: 2, width: 3, height: 4 }]
      }
    }
    const raw = JSON.stringify({
      version: 3,
      ranges: [runtimeEndpointRange, runtimeRectKeyRange, linkedRangeA],
      rects: []
    })

    const parsed = parseHighlights(raw)

    expect(parsed).toEqual({ ranges: [linkedRangeA], rects: [] })
  })
})
