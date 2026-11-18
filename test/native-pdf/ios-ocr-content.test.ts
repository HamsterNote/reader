import { describe, expect, it, vi } from 'vitest'
import type { ReaderExtraOcr } from '../../src/types/readerOcr'
import { fetchOcrContent } from '../../src/components/IntermediateDocumentViewer/ocrContent.ios'

describe('iOS provider OCR boundary', () => {
  it('uses the configured provider without loading a browser OCR runtime', async () => {
    const content = [{ type: 'text', id: 'ocr', content: 'scan' }]
    const provider = vi.fn(async () => ({ getContent: () => content }))
    expect(
      await fetchOcrContent(
        'data:image/png;base64,fixture',
        provider as unknown as ReaderExtraOcr
      )
    ).toEqual(content)
    expect(provider).toHaveBeenCalledWith('data:image/png;base64,fixture')
  })

  it('reports missing and failed providers explicitly', async () => {
    await expect(fetchOcrContent('image')).rejects.toThrow('extraOCR provider')
    const provider = vi.fn(async () => {
      throw new Error('provider unavailable')
    })
    await expect(fetchOcrContent('image', provider)).rejects.toThrow(
      'provider unavailable'
    )
  })
})
