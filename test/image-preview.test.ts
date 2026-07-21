import { ImageParser } from '@hamster-note/image-parser'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createImagePreviewDocument } from '../demo/imagePreview'

class PreviewImage {
  naturalWidth = 640
  naturalHeight = 480
  width = 0
  height = 0
  onload: ((event: Event) => void) | null = null
  onerror: ((event: Event | string) => void) | null = null

  set src(_source: string) {
    this.onload?.(new Event('load'))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('image preview document', () => {
  it('builds a dimensioned image page without starting OCR', async () => {
    // Given: 浏览器可以将图片读取为 data URL 并解码出固有尺寸。
    const source = 'data:image/png;base64,aW1hZ2U='
    const file = new File(['image'], 'scan.png', {
      type: 'image/png',
      lastModified: 123
    })
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(
      function (this: FileReader) {
        Object.defineProperty(this, 'result', {
          configurable: true,
          value: source
        })
        this.dispatchEvent(new ProgressEvent('load'))
      }
    )
    vi.stubGlobal('Image', PreviewImage)

    // When: 创建第一阶段的纯图片预览文档。
    const document = await createImagePreviewDocument(file)
    const page = await document.getPageByPageNumber(1)
    const thumbnail = await page?.getThumbnail()

    // Then: 页面保留原图和尺寸，但不会调用执行 OCR 的 encode。
    expect(ImageParser.encode).not.toHaveBeenCalled()
    expect(document.title).toBe('scan.png')
    expect(page).toMatchObject({ width: 640, height: 480, content: [] })
    expect(thumbnail).toMatchObject({
      src: source,
      polygon: [
        [0, 0],
        [640, 0],
        [640, 480],
        [0, 480]
      ]
    })
  })
})
