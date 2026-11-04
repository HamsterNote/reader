import { describe, expect, it } from 'vitest'
import {
  normalizeBookmark,
  normalizeTextProgress,
  resolveReadingProgress
} from '../src/readingProgress'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../src/host/readerSnapshot'

describe('display-only progress compatibility', () => {
  const anchor = { pageNumber: 2, textId: 'old', text: 'word', offset: 3 }
  it('keeps current-mode priority and legacy transforms without migration writes', () => {
    const envelope = {
      readerData: {
        virtualPaper: { x: 10, y: -40, scale: 2, anchor },
        layoutReadingProgress: { pageNumber: 3, verticalPercentage: 42.5 },
        textReadingProgress: { currentPageNumber: 4, verticalPercentage: 60 }
      }
    }
    const original = JSON.stringify(envelope)
    const snapshot = restoreReaderSnapshot(envelope, {
      textReadingProgress: { currentPageNumber: 1 }
    })
    expect(resolveReadingProgress(snapshot.data, 'layout')).toEqual(
      envelope.readerData.layoutReadingProgress
    )
    expect(resolveReadingProgress(snapshot.data, 'text')).toEqual({
      pageNumber: 4,
      verticalPercentage: 60
    })
    expect(
      resolveReadingProgress(
        { virtualPaper: envelope.readerData.virtualPaper },
        'layout'
      )
    ).toEqual(anchor)
    expect(
      resolveReadingProgress(
        { virtualPaper: { x: 1, y: 2, scale: 3 } },
        'layout'
      )
    ).toBeUndefined()
    expect(normalizeTextProgress({ currentPageNumber: 2 })).toEqual({
      currentPageNumber: 2
    })
    expect(snapshot.migrated).toBe(false)
    expect(serializeReaderSnapshot(snapshot).readerData).toEqual(
      envelope.readerData
    )
    expect(JSON.stringify(envelope)).toBe(original)
  })
  it('validates pages, offsets and anchor-page identity, and clamps finite ratios', () => {
    expect(
      normalizeBookmark({ pageNumber: 2, verticalPercentage: 140 })
    ).toEqual({ pageNumber: 2, verticalPercentage: 100 })
    expect(
      normalizeBookmark({ pageNumber: 0, verticalPercentage: 10 })
    ).toBeUndefined()
    expect(normalizeBookmark({ ...anchor, offset: -1 })).toEqual({
      pageNumber: 2,
      verticalPercentage: 0
    })
    expect(
      normalizeTextProgress({
        currentPageNumber: 1,
        anchor,
        verticalPercentage: -3
      })
    ).toEqual({ currentPageNumber: 1, verticalPercentage: 0 })
    for (const verticalPercentage of [NaN, Infinity, -Infinity])
      expect(
        resolveReadingProgress(
          { textReadingProgress: { currentPageNumber: 2, verticalPercentage } },
          'text'
        )
      ).toEqual({ pageNumber: 2, verticalPercentage: 0 })
  })
})
