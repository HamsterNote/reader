import { describe, expect, it } from 'vitest'
import type { IntermediateText } from '@hamster-note/types'
import {
  nativeLayoutProgress,
  nativeLayoutProgressFromGeometry,
  nativeProgressKey,
  readerDataFromNativeSnapshot,
  withNativeLayoutProgress,
  withNativeOcrTexts,
  MAX_NATIVE_OCR_BYTES,
  MAX_NATIVE_OCR_PAGES
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

  it('patches OCR content without replacing readerData siblings', () => {
    const snapshot = {
      readerData: {
        edgeCrop: { all: { top: 0.05 } },
        pagePaintings: { 'page-1': { objects: [{ id: 'ink' }] } }
      },
      comments: [{ id: 'comment-1', parentId: null }]
    }
    const text = [
      {
        id: 'ocr-1',
        content: 'scan',
        polygon: [
          [0, 0],
          [1, 1]
        ]
      }
    ] as unknown as IntermediateText[]
    expect(withNativeOcrTexts(snapshot, 1, text)).toEqual({
      ...snapshot,
      readerData: { ...snapshot.readerData, ocrTexts: { 1: text } }
    })
  })

  it('bounds persisted OCR by page count and serialized size', () => {
    let snapshot: Record<string, unknown> = { readerData: {} }
    for (let page = 1; page <= MAX_NATIVE_OCR_PAGES + 4; page++) {
      snapshot = withNativeOcrTexts(snapshot, page, [
        {
          id: `ocr-${page}`,
          content: 'scan',
          polygon: [
            [0, 0],
            [1, 1]
          ]
        } as never
      ])
    }
    const texts = (snapshot.readerData as Record<string, unknown>)
      .ocrTexts as Record<string, unknown>
    expect(Object.keys(texts)).toHaveLength(MAX_NATIVE_OCR_PAGES)
    expect(JSON.stringify(texts).length).toBeLessThanOrEqual(
      MAX_NATIVE_OCR_BYTES
    )
    expect(texts['1']).toBeUndefined()
    expect(texts[String(MAX_NATIVE_OCR_PAGES + 4)]).toBeDefined()
  })

  it('maps native page geometry to a bounded layout percentage', () => {
    const geometry = {
      pageNumber: 3,
      height: 1000,
      pageToViewport: [2, 0, 0, 2, 0, -400] as const
    }
    expect(nativeLayoutProgressFromGeometry(geometry, 600)).toMatchObject({
      pageNumber: 3,
      verticalPercentage: 20
    })
  })

  it('uses the complete page frame for cropped save and restore', () => {
    const geometry = {
      pageNumber: 3,
      height: 1000,
      crop: { top: 0.1 },
      // scale-one frame top is -100 crop points - 350 scrolled points.
      pageToViewport: [2, 0, 0, 2, 0, -900] as const
    }
    const saved = nativeLayoutProgressFromGeometry(geometry, 600)
    expect(saved).toEqual({ pageNumber: 3, verticalPercentage: 35 })
    // Native restore uses slot.minY + frame.height * 35%; for this page the
    // slot starts at 0, so it returns the same 350-point page position.
    expect(((saved?.verticalPercentage ?? 0) * 1000) / 100).toBe(350)
  })
})
