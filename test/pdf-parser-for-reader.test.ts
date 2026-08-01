import { describe, expect, it, vi } from 'vitest'

import { configurePdfParserForReader } from '../demo/pdfParserForReader'

describe('configurePdfParserForReader', () => {
  it('loads every PDF.js session with raw image decoding enabled', async () => {
    // Given: PDF parser 的 session loader 会收到调用方已有的 PDF.js 参数。
    const loadPdfSession = vi.fn(async () => ({ pdf: 'loaded' }))
    const parser = { loadPdfSession }

    // When: Reader 为真实内容图片配置 parser，并加载一个 session。
    expect(configurePdfParserForReader(parser)).toBe(true)
    const configuredLoader = Reflect.get(parser, 'loadPdfSession')
    if (typeof configuredLoader !== 'function')
      throw new Error('loader missing')
    await Reflect.apply(configuredLoader, parser, [
      new ArrayBuffer(1),
      { useWasm: false }
    ])

    // Then: 既有参数被保留，ImageBitmap 路径被关闭以返回 parser 支持的 raw image data。
    expect(loadPdfSession).toHaveBeenCalledWith(new ArrayBuffer(1), {
      useWasm: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false
    })
  })

  it('leaves parser test doubles without a session loader unchanged', () => {
    // Given: 单元测试或替代实现只暴露公开 encode 方法。
    const encode = vi.fn()
    const parser = { encode }

    // When: Reader 尝试启用可选的 PDF.js raw image 配置。
    const configured = configurePdfParserForReader(parser)

    // Then: 缺少内部loader不会阻断公开parser契约。
    expect(configured).toBe(false)
    expect(parser).toEqual({ encode })
  })

  it('waits for the PDF.js object callback when its synchronous result is null', async () => {
    // Given: PDF.js callback模式的对象存储同步返回null，随后异步交付raw image data。
    const rawImage = { data: new Uint8Array([1, 2, 3]) }
    const parser = {
      loadPdfSession: vi.fn(async () => ({ pdf: 'loaded' })),
      resolvePdfPageObject: vi.fn()
    }
    const page = {
      objs: {
        get: vi.fn((_objectId: string, resolve: (value: unknown) => void) => {
          queueMicrotask(() => resolve(rawImage))
          return null
        })
      }
    }

    // When: Reader配置后的parser解析页面图片对象。
    configurePdfParserForReader(parser)
    const resolver = Reflect.get(parser, 'resolvePdfPageObject')
    if (typeof resolver !== 'function') throw new Error('resolver missing')
    const resolved = await Reflect.apply(resolver, parser, [page, 'img-1'])

    // Then: null占位不会抢先结算，最终返回异步raw image data。
    expect(resolved).toBe(rawImage)
  })
})
