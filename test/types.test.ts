import { describe, expect, it } from 'vitest'

import type { ReaderLinkedSelectionRange, ReaderSelectionRange } from '../src'

type AssertFalse<Value extends false> = Value

type LegacySelectionRangeFixture = {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly createdAt: number
  readonly rects: readonly [
    {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  ]
}

type LegacyRangeAssignableToReaderRange =
  LegacySelectionRangeFixture extends ReaderSelectionRange ? true : false

const legacyRangeRejected: AssertFalse<LegacyRangeAssignableToReaderRange> = false

const linkedRange = {
  id: 'r1',
  text: 't',
  start: { selectionId: 'page-2', offset: 0 },
  end: { selectionId: 'page-2', offset: 5 },
  createdAt: 1,
  rectsBySelectionId: {
    'page-2': [{ x: 1, y: 2, width: 3, height: 4 }]
  }
} satisfies ReaderSelectionRange

const linkedRangeAlias: ReaderLinkedSelectionRange = linkedRange

describe('Reader public selection types', () => {
  it('accepts linked ranges keyed by public page selection ids', () => {
    expect(legacyRangeRejected).toBe(false)
    expect(linkedRangeAlias.start.selectionId).toBe('page-2')
    expect(linkedRangeAlias.end.selectionId).toBe('page-2')
    expect(linkedRangeAlias.rectsBySelectionId['page-2']).toEqual([
      { x: 1, y: 2, width: 3, height: 4 }
    ])
  })
})
