import { IntermediateDocument, IntermediatePageMap } from '@hamster-note/types'
import { describe, expect, it, vi } from 'vitest'

import {
  configurePdfParserForReader,
  openPdfDocumentForReader
} from '../demo/pdfParserForReader'

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
    // Given: 单元测试或替代实现只暴露公开 openDocument 方法。
    const openDocument = vi.fn()
    const parser = { openDocument }

    // When: Reader 尝试启用可选的 PDF.js raw image 配置。
    const configured = configurePdfParserForReader(parser)

    // Then: 缺少内部loader不会阻断公开parser契约。
    expect(configured).toBe(false)
    expect(parser).toEqual({ openDocument })
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

describe('openPdfDocumentForReader', () => {
  it('delegates to the published openDocument API and preserves its handle', async () => {
    // Given: 1.1.0 parser 公开 openDocument，并返回带生命周期所有权的句柄。
    const document = new IntermediateDocument({
      id: 'published-parser-document',
      title: 'Example',
      pagesMap: new IntermediatePageMap()
    })
    const dispose = vi.fn(async () => undefined)
    const handle = {
      id: 'pdf-session-1',
      title: 'Example',
      pageCount: 2,
      document,
      dispose
    }
    const openDocument = vi.fn(async () => handle)
    const parser = { openDocument }
    const source = new ArrayBuffer(4)
    const onProgress = vi.fn()
    const options = {
      pages: [2, 4],
      scanConcurrency: 3,
      onProgress
    }

    // When: Reader 通过统一入口打开 PDF。
    const openedHandle = await openPdfDocumentForReader(parser, source, options)

    // Then: 新版扫描参数原样传递，且保留 parser 的真实 dispose 生命周期。
    expect(openDocument).toHaveBeenCalledWith(source, options)
    expect(openedHandle).toBe(handle)
    await expect(openedHandle.dispose()).resolves.toBeUndefined()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('uses cached dimensions only for the initial page scan', async () => {
    // Given: parser 的 session 暴露真实 getPage，sidecar 已缓存第一页宽高。
    const realPage = { getViewport: vi.fn(() => ({ width: 1, height: 1 })) }
    const getPage = vi.fn(async () => realPage)
    const parser = {
      loadPdfSession: vi.fn(async () => ({
        loadingTask: { destroy: vi.fn() },
        pdf: { numPages: 1, getPage }
      })),
      openDocument: vi.fn()
    }
    configurePdfParserForReader(parser)
    const loader = Reflect.get(parser, 'loadPdfSession')
    if (typeof loader !== 'function') throw new Error('loader missing')
    parser.openDocument.mockImplementation(async (source: ArrayBuffer) => {
      const session = await Reflect.apply(loader, parser, [source])
      const pdf = Reflect.get(session, 'pdf')
      const cachedPage = await Reflect.apply(
        Reflect.get(pdf, 'getPage'),
        pdf,
        [1]
      )
      const contentPage = await Reflect.apply(
        Reflect.get(pdf, 'getPage'),
        pdf,
        [1]
      )
      if (typeof cachedPage !== 'object' || cachedPage === null) {
        throw new Error('cached page missing')
      }
      const getViewport = Reflect.get(cachedPage, 'getViewport')
      if (typeof getViewport !== 'function') {
        throw new Error('cached viewport missing')
      }
      expect(Reflect.apply(getViewport, cachedPage, [])).toEqual({
        width: 612,
        height: 792
      })
      expect(contentPage).toBe(realPage)
      return {
        id: 'cached-pdf',
        title: 'Cached',
        pageCount: 1,
        document: new IntermediateDocument({
          id: 'cached-pdf',
          title: 'Cached',
          pagesMap: new IntermediatePageMap()
        }),
        dispose: vi.fn(async () => undefined)
      }
    })

    // When: Reader 使用缓存结构打开 PDF。
    await openPdfDocumentForReader(parser, new ArrayBuffer(4), {
      cachedPageCount: 1,
      cachedPages: [{ pageNumber: 1, width: 612, height: 792 }]
    })

    // Then: 扫描不访问真实页面，后续正文加载只访问一次真实页面。
    expect(getPage).toHaveBeenCalledOnce()
  })
})
