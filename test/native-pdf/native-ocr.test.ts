import { describe, expect, it } from 'vitest'
import {
  nativeCanonicalPageFromOcr,
  nativeOcrFailurePreservesData,
  nativeOcrSessionKey,
  shouldRequestNativeOcr
} from '../../src/nativePdf/ocr'

describe('native OCR contract', () => {
  it('does not request OCR while disabled and distinguishes missing pages', () => {
    const availability = { 1: 'noTextLayer' as const }
    expect(shouldRequestNativeOcr(false, 1, availability, 1)).toBe(false)
    expect(shouldRequestNativeOcr(true, 2, availability, 1)).toBe(false)
    expect(shouldRequestNativeOcr(true, 1, availability, 1)).toBe(true)
  })

  it('maps provider text boxes to UTF-16 native boundaries', () => {
    const page = nativeCanonicalPageFromOcr(3, 1000, 500, [
      {
        id: 'word',
        content: 'Scan',
        polygon: [
          [0.1, 0.2],
          [0.5, 0.2],
          [0.5, 0.3],
          [0.1, 0.3]
        ]
      }
    ])
    expect(page?.text).toBe('Scan')
    expect(page?.boundaries).toHaveLength(5)
    expect(page?.glyphs[0]).toMatchObject({
      start: 0,
      end: 4,
      rect: { x: 100, y: 100, width: 400, height: 50 }
    })
  })

  it('treats an empty provider result as failure rather than success', () => {
    expect(nativeCanonicalPageFromOcr(1, 100, 100, [])).toBeNull()
    const existing = { rangeId: 'kept', progress: 42 }
    expect(nativeOcrFailurePreservesData(existing)).toBe(existing)
  })

  it('keeps OCR state isolated by file and page', () => {
    expect(nativeOcrSessionKey('a', 1)).not.toBe(nativeOcrSessionKey('b', 1))
    expect(nativeOcrSessionKey('a', 1)).not.toBe(nativeOcrSessionKey('a', 2))
  })
})
