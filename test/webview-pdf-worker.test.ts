import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readPackagedText } from '../webview/src/packagedAsset'
import { createPdfWorkerFromAsset } from '../webview/src/pdfWorker'

vi.mock('../webview/src/packagedAsset', () => ({ readPackagedText: vi.fn() }))

let worker: MockWorker
const createObjectURL = vi.fn(() => 'blob:null/pdf-worker')
const revokeObjectURL = vi.fn()

class MockWorker extends EventTarget {
  readonly terminate = vi.fn()
  constructor(
    readonly url: string,
    readonly options: WorkerOptions
  ) {
    super()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(readPackagedText).mockResolvedValue('x'.repeat(2048))
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal('Worker', function (url: string, options: WorkerOptions) {
    worker = new MockWorker(url, options)
    return worker
  })
  vi.stubGlobal(
    'URL',
    class extends URL {
      static readonly createObjectURL = createObjectURL
      static readonly revokeObjectURL = revokeObjectURL
    }
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PDF module worker startup', () => {
  it('waits for the actual PDF.js ready packet and retains the blob URL until then', async () => {
    const promise = createPdfWorkerFromAsset()
    await Promise.resolve()
    expect(readPackagedText).toHaveBeenCalledWith('pdfjs/pdf.worker.min.mjs')
    expect(worker.url).toBe('blob:null/pdf-worker')
    expect(worker.options).toEqual({ type: 'module' })
    expect(revokeObjectURL).not.toHaveBeenCalled()
    const settled = vi.fn()
    const settledPromise = promise.then(settled)
    worker.dispatchEvent(
      new MessageEvent('message', { data: { action: 'ready' } })
    )
    await vi.advanceTimersByTimeAsync(1200)
    expect(settled).not.toHaveBeenCalled()
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { sourceName: 'worker', targetName: 'main', action: 'ready' }
      })
    )
    expect(await promise).toBe(worker)
    await settledPromise
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith(worker.url)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a silent worker instead of reporting success after a delay', async () => {
    const promise = createPdfWorkerFromAsset()
    const failure = expect(promise).rejects.toThrow('未收到 ready')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(8000)
    await failure
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['error', 'messageerror'] as const)(
    'cleans up when startup emits %s',
    async (event) => {
      const promise = createPdfWorkerFromAsset()
      const failure = expect(promise).rejects.toThrow('PDF worker')
      await Promise.resolve()
      worker.dispatchEvent(
        event === 'error'
          ? new ErrorEvent('error', { message: 'PDF worker failed to load' })
          : new MessageEvent('messageerror')
      )
      await failure
      expect(worker.terminate).toHaveBeenCalledOnce()
      expect(revokeObjectURL).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('releases the blob URL if the Worker constructor rejects', async () => {
    vi.stubGlobal('Worker', function () {
      throw new Error('worker blocked')
    })
    await expect(createPdfWorkerFromAsset()).rejects.toThrow('worker blocked')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:null/pdf-worker')
  })

  it('does not create a blob worker for missing or truncated source', async () => {
    vi.mocked(readPackagedText).mockResolvedValue('')
    await expect(createPdfWorkerFromAsset()).rejects.toThrow('内容异常')
    expect(createObjectURL).not.toHaveBeenCalled()
    vi.mocked(readPackagedText).mockRejectedValue(new Error('本地资源读取失败'))
    await expect(createPdfWorkerFromAsset()).rejects.toThrow('本地资源读取失败')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
