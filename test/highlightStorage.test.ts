import { describe, expect, it } from 'vitest'

import {
  parseHighlights,
  serializeHighlights,
  type ReaderSelectionRange
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

describe('highlight storage helpers', () => {
  it('parses all valid linked ranges when storage is v2', () => {
    // Given: persisted storage uses the exact v2 envelope.
    const raw = JSON.stringify({
      version: 2,
      ranges: [linkedRangeA, linkedRangeB]
    })

    // When: the demo reads highlights from persisted JSON.
    const parsed = parseHighlights(raw)

    // Then: every valid linked range survives unchanged.
    expect(parsed).toEqual([linkedRangeA, linkedRangeB])
  })

  it('serializes ranges with the exact v2 envelope', () => {
    // Given: the demo has typed linked ranges in memory.
    const ranges = [linkedRangeA, linkedRangeB]

    // When: the demo serializes them for persistence.
    const serialized = serializeHighlights(ranges)

    // Then: the output is exactly the versioned v2 shape.
    expect(JSON.parse(serialized)).toEqual({ version: 2, ranges })
  })

  it('returns an empty array when storage is missing or empty', () => {
    // Given: localStorage has no usable value.
    const rawValues = [null, '', '   ']

    // When: each missing/empty value is parsed.
    const parsedValues = rawValues.map((raw) => parseHighlights(raw))

    // Then: every value produces empty highlights.
    expect(parsedValues).toEqual([[], [], []])
  })

  it('returns an empty array when storage JSON is corrupt', () => {
    // Given: localStorage contains invalid JSON.
    const raw = '{"version":2,"ranges":['

    // When: the corrupt payload is parsed.
    const parsed = parseHighlights(raw)

    // Then: parsing is crash-free and returns no highlights.
    expect(parsed).toEqual([])
  })

  it('returns an empty array when storage has the wrong shape', () => {
    // Given: JSON is valid but not the v2 highlight envelope.
    const wrongShapes = [
      'null',
      '42',
      JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 2, ranges: linkedRangeA }),
      JSON.stringify({ version: 3, ranges: [linkedRangeA] })
    ]

    // When: each wrong shape is parsed.
    const parsedValues = wrongShapes.map((raw) => parseHighlights(raw))

    // Then: none of the untyped payloads enter app state.
    expect(parsedValues).toEqual([[], [], [], [], []])
  })

  it('keeps valid linked ranges and drops invalid entries in mixed v2 ranges', () => {
    // Given: a v2 envelope contains one valid linked range and several bad entries.
    const raw = JSON.stringify({
      version: 2,
      ranges: [
        linkedRangeA,
        { ...linkedRangeA, id: 123 },
        { ...linkedRangeA, start: { selectionId: 'page-0', offset: 2 } },
        { ...linkedRangeA, rectsBySelectionId: { 'page-1': [{ x: 1 }] } },
        null,
        linkedRangeB
      ]
    })

    // When: the mixed array is parsed.
    const parsed = parseHighlights(raw)

    // Then: valid entries are kept exactly and invalid entries are dropped.
    expect(parsed).toEqual([linkedRangeA, linkedRangeB])
  })

  it('returns an empty array for unversioned old bare arrays and legacy objects', () => {
    // Given: old demo storage lacks page ownership information.
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

    // When: legacy data is parsed.
    const parsedValues = [
      parseHighlights(oldBareArray),
      parseHighlights(legacyObject)
    ]

    // Then: no best-effort page-1 migration occurs.
    expect(parsedValues).toEqual([[], []])
  })

  it('rejects persisted ranges containing runtime-scoped selection ids', () => {
    // Given: runtime-scoped ids accidentally appear in persisted endpoints or rect keys.
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
      version: 2,
      ranges: [runtimeEndpointRange, runtimeRectKeyRange, linkedRangeA]
    })

    // When: the v2 payload is parsed.
    const parsed = parseHighlights(raw)

    // Then: scoped-id ranges are dropped, while public page ids remain valid.
    expect(parsed).toEqual([linkedRangeA])
  })
})
