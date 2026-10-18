import { describe, expect, it } from 'vitest'

import { isPdfPageNumber } from '../src/pdf-contracts'

describe('PDF physical page numbers', () => {
  it('accepts first and last pages without accepting wrapping or fractions', () => {
    expect(isPdfPageNumber(1, 4)).toBe(true)
    expect(isPdfPageNumber(4, 4)).toBe(true)
    for (const page of [0, -1, 5, 1.5, NaN, Infinity]) {
      expect(isPdfPageNumber(page, 4)).toBe(false)
    }
  })

  it('rejects unavailable or invalid page metadata', () => {
    for (const count of [0, -1, 1.5, NaN, Infinity]) {
      expect(isPdfPageNumber(1, count)).toBe(false)
    }
  })
})
