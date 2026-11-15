import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IntermediatePage, IntermediateText } from '@hamster-note/types'
import {
  fetchOcrContent as fetchNativeOcrContent,
  prefixOcrTextIds as prefixNativeIds
} from '../../src/components/IntermediateDocumentViewer/ocrContent.native'
import {
  fetchOcrContent as fetchWebOcrContent,
  prefixOcrTextIds as prefixWebIds
} from '../../src/components/IntermediateDocumentViewer/ocrContent'

const browser = vi.hoisted(() => ({ encode: vi.fn() }))
vi.mock('@hamster-note/image-parser', () => ({
  ImageParser: { encode: browser.encode }
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  browser.encode.mockReset()
})

const image = 'data:image/png;base64,original-image'
const texts = [
  {
    id: 'original',
    content: 'OCR 文字',
    polygon: [
      [0.1, 0.2],
      [0.5, 0.2],
      [0.5, 0.3],
      [0.1, 0.3]
    ]
  }
] as IntermediateText[]
const page = (content: IntermediateText[] = texts) =>
  ({ getContent: () => content }) as unknown as IntermediatePage

describe('native/browser OCR provider boundary', () => {
  it.each([fetchNativeOcrContent, fetchWebOcrContent])(
    'passes the original image to a configured provider without browser I/O',
    async (fetchContent) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const provider = vi.fn(async () => page())
      expect(await fetchContent(image, provider)).toBe(texts)
      expect(provider).toHaveBeenCalledExactlyOnceWith(image)
      expect(fetch).not.toHaveBeenCalled()
      expect(browser.encode).not.toHaveBeenCalled()
    }
  )

  it('also accepts a synchronous provider and preserves empty results', async () => {
    expect(await fetchNativeOcrContent(image, () => page([]))).toEqual([])
  })

  it('propagates provider failure instead of treating it as empty success', async () => {
    const error = new Error('provider unavailable')
    await expect(
      fetchNativeOcrContent(image, () => {
        throw error
      })
    ).rejects.toBe(error)
  })

  it('explicitly fails without a native provider and never loads browser OCR', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchNativeOcrContent(image)).rejects.toThrow(
      'extraOCR provider'
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(browser.encode).not.toHaveBeenCalled()
  })

  it('keeps browser default recognition through ImageParser', async () => {
    const input = new Blob(['image'])
    const fetch = vi.fn(async () => ({ blob: async () => input }))
    vi.stubGlobal('fetch', fetch)
    browser.encode.mockResolvedValue({
      pages: Promise.resolve([{ content: texts }])
    })
    expect(await fetchWebOcrContent(image)).toBe(texts)
    expect(fetch).toHaveBeenCalledWith(image)
    expect(browser.encode).toHaveBeenCalledExactlyOnceWith(input)
  })

  it('shares page-scoped IDs and transparent boxes without mutating provider results', () => {
    expect(prefixNativeIds).toBe(prefixWebIds)
    expect(prefixNativeIds(texts, 3)).toEqual([
      { ...texts[0], id: 'ocr-3-original', color: 'transparent' }
    ])
    expect(texts[0]?.id).toBe('original')
    expect(texts[0]).not.toHaveProperty('color')
  })
})
