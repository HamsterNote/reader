import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readPackagedAsset,
  readPackagedText
} from '../webview/src/packagedAsset'

function mockLocalRead(
  bytes: ArrayBuffer | null,
  status = 0,
  event: 'onload' | 'onerror' | 'onabort' | 'ontimeout' = 'onload'
) {
  const request = {
    open: vi.fn(),
    send: vi.fn(() => request[event]()),
    responseType: '',
    timeout: 0,
    status,
    response: bytes,
    onload: () => undefined,
    onerror: () => undefined,
    onabort: () => undefined,
    ontimeout: () => undefined
  }
  vi.stubGlobal('XMLHttpRequest', function () {
    return request
  })
  return request
}

beforeEach(() => {
  vi.stubGlobal('location', {
    href: 'file:///Documents/webreader/build/index.html?selftest=1'
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('file fetch unsupported'))
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('packaged resource reads on WKWebView', () => {
  it('reads status-0 file bytes without fetch and decodes UTF-8 JSON', async () => {
    const text = '{"title":"仓鼠","files":["epub.js"]}'
    const encoded = new TextEncoder().encode(text)
    const bytes = new ArrayBuffer(encoded.length)
    new Uint8Array(bytes).set(encoded)
    const request = mockLocalRead(bytes)
    expect(await readPackagedText('asset-manifest.json')).toBe(text)
    expect(request.open).toHaveBeenCalledWith(
      'GET',
      'file:///Documents/webreader/build/asset-manifest.json',
      true
    )
    expect(request.responseType).toBe('arraybuffer')
    expect(request.timeout).toBe(8000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves binary font bytes, including NUL and non-UTF8 bytes', async () => {
    const bytes = new Uint8Array([0, 1, 128, 255]).buffer
    mockLocalRead(bytes)
    expect(await readPackagedAsset('pdfjs/standard_fonts/font.ttf')).toEqual(
      bytes
    )
  })

  it.each([null, new ArrayBuffer(0)])(
    'rejects missing/empty status-0 files (%s)',
    async (bytes) => {
      mockLocalRead(bytes)
      await expect(readPackagedAsset('missing.js')).rejects.toThrow(
        '读取失败或为空'
      )
    }
  )

  it.each(['onerror', 'onabort', 'ontimeout'] as const)(
    'does not accept a status-0 %s as a successful read',
    async (event) => {
      mockLocalRead(new ArrayBuffer(4), 0, event)
      await expect(readPackagedAsset('missing.js')).rejects.toThrow(
        '本地资源读取'
      )
    }
  )

  it('rejects error status even when a nonempty body is present', async () => {
    mockLocalRead(new ArrayBuffer(4), 404)
    await expect(readPackagedAsset('missing.js')).rejects.toThrow('状态 404')
  })

  it.each([
    '../reader-files/other.pdf',
    '%2e%2e%2freader-files/other.pdf',
    'file://other-host/Documents/webreader/build/a.js',
    'https://example.com/a.js',
    'data:text/plain,content'
  ])('rejects paths outside the packaged directory: %s', async (path) => {
    const request = mockLocalRead(new ArrayBuffer(4))
    await expect(readPackagedAsset(path)).rejects.toThrow('超出阅读目录')
    expect(request.send).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps normal HTTP reads working', async () => {
    vi.stubGlobal('location', {
      href: 'http://localhost:8080/reader/index.html'
    })
    vi.mocked(fetch).mockResolvedValue(new Response('worker source'))
    expect(await readPackagedText('pdfjs/worker.mjs')).toBe('worker source')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/reader/pdfjs/worker.mjs'
    )
  })

  it.each([0, 404, 500])(
    'rejects HTTP status %s instead of accepting it as a local file',
    async (status) => {
      vi.stubGlobal('location', {
        href: 'https://example.com/reader/index.html'
      })
      vi.mocked(fetch).mockResolvedValue({ ok: false, status } as Response)
      await expect(readPackagedAsset('missing.js')).rejects.toThrow(
        `HTTP ${status}`
      )
    }
  )

  it('rejects an empty successful HTTP response', async () => {
    vi.stubGlobal('location', { href: 'https://example.com/reader/index.html' })
    vi.mocked(fetch).mockResolvedValue(new Response(''))
    await expect(readPackagedAsset('missing.js')).rejects.toThrow('资源为空')
  })
})
