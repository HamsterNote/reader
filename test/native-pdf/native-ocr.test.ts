import { describe, expect, it } from 'vitest'
import {
  canRequestNativeOcrPage,
  nativeCanonicalPageFromOcr,
  nativeOcrFailurePreservesData,
  nativeOcrSessionKey,
  shouldRequestNativeOcr
} from '../../src/nativePdf/ocr'
import {
  nativePdfErrorMessage,
  shouldReplaceNativePdfError
} from '../../src/nativePdf/errors'

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

  it('deduplicates a same-page provider request and keeps the canonical hit map', () => {
    const requested = new Set<string>()
    const completed = new Set<string>()
    expect(canRequestNativeOcrPage('book:3', requested, completed)).toBe(true)
    requested.add('book:3')
    expect(canRequestNativeOcrPage('book:3', requested, completed)).toBe(false)

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
    expect(page?.boundaries.map(({ offset }) => offset)).toEqual([0, 1, 2, 3, 4])
    expect(page?.glyphs[0]).toMatchObject({ start: 0, end: 4 })
  })

  it('keeps native password classification ahead of a later WebView failure', () => {
    const native = { code: 'PASSWORD_REQUIRED', message: 'PDF 已加密' }
    expect(shouldReplaceNativePdfError(null, native)).toBe(true)
    expect(
      shouldReplaceNativePdfError(native, {
        code: 'CORRUPT',
        message: 'WebView 初始化异常'
      })
    ).toBe(false)
    expect(nativePdfErrorMessage(native)).toBe('No password given')
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
