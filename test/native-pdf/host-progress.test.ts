import { describe, expect, it } from 'vitest'
import {
  nativeLayoutProgress,
  nativeLayoutProgressFromGeometry,
  nativeProgressKey,
  readerDataFromNativeSnapshot,
  withNativeLayoutProgress
} from '../../src/nativePdf/hostProgress'

describe('native host layout progress', () => {
  it('writes only the optional readerData layout bookmark', () => {
    const snapshot = {
      annotations: { version: 5, ranges: ['keep'] },
      readerData: { textReadingProgress: { currentPageNumber: 4 } },
      extra: 'keep'
    }
    const progress = nativeLayoutProgress(8, 120)!
    expect(withNativeLayoutProgress(snapshot, progress)).toEqual({
      ...snapshot,
      readerData: {
        textReadingProgress: { currentPageNumber: 4 },
        layoutReadingProgress: { pageNumber: 8, verticalPercentage: 100 }
      }
    })
    expect(
      readerDataFromNativeSnapshot(snapshot, {
        textReadingProgress: { currentPageNumber: 9 }
      })
    ).toEqual(snapshot.readerData)
  })

  it('rejects invalid pages and deduplicates the same page progress', () => {
    expect(nativeLayoutProgress(0)).toBeUndefined()
    expect(nativeLayoutProgress(1, Number.NaN)).toBeUndefined()
    expect(nativeProgressKey(nativeLayoutProgress(2)!)).toBe('2:0')
  })

  it('maps native page geometry to a bounded layout percentage', () => {
    const geometry = {
      pageNumber: 3,
      height: 1000,
      pageToViewport: [2, 0, 0, 2, 0, -400] as const
    }
    expect(nativeLayoutProgressFromGeometry(geometry, 600)).toMatchObject({
      pageNumber: 3,
      verticalPercentage: 28.57142857142857
    })
  })
})
