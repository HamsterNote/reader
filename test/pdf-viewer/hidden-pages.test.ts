import { describe, expect, it } from 'vitest'
import {
  groupHiddenPages,
  normalizeHiddenPageNumbers,
  removeHiddenPageNumbers
} from '../../src/pdf/hiddenPages'

describe('hidden page groups', () => {
  it('builds maximal consecutive groups including single-page groups', () => {
    expect(
      groupHiddenPages([2, 'page-4', 5, 6, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    ).toEqual([
      { start: 2, end: 2, pages: [2] },
      { start: 4, end: 6, pages: [4, 5, 6] },
      { start: 9, end: 9, pages: [9] }
    ])
  })

  it('deduplicates aliases, filters excluded and invalid pages, and preserves input', () => {
    const hiddenPages = Object.freeze([
      1,
      2,
      'page-2',
      3,
      7,
      'page-x',
      1.5,
      -1
    ] as const)
    const allowedPages = Object.freeze([2, 3, 4, 5, 6] as const)
    expect(groupHiddenPages(hiddenPages, allowedPages)).toEqual([
      { start: 2, end: 3, pages: [2, 3] }
    ])
    expect(hiddenPages).toEqual([1, 2, 'page-2', 3, 7, 'page-x', 1.5, -1])
    expect(allowedPages).toEqual([2, 3, 4, 5, 6])
  })

  it('covers head, tail, and a fully hidden document', () => {
    expect(groupHiddenPages([1, 2], [1, 2, 3])[0]).toMatchObject({
      start: 1,
      end: 2
    })
    expect(
      groupHiddenPages([9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])[0]
    ).toMatchObject({
      start: 9,
      end: 10
    })
    expect(groupHiddenPages([1, 2, 3], [1, 2, 3])).toEqual([
      { start: 1, end: 3, pages: [1, 2, 3] }
    ])
  })

  it('normalizes only valid positive integer pages and page-N aliases', () => {
    expect(
      normalizeHiddenPageNumbers([1, 'page-2', 'page-02', 0, 3.5, 'other'])
    ).toEqual(new Set([1, 2]))
  })

  it('removes every alias of selected pages without dropping unrelated data', () => {
    expect(
      removeHiddenPageNumbers([2, 'page-4', 4, 'invalid', 7], [2, 4])
    ).toEqual(['invalid', 7])
  })
})
