import { describe, expect, it, vi } from 'vitest'

import { loadFileToMemory } from '../demo/fileMemoryLoader'

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
}

type FileBytes = Uint8Array<ArrayBuffer>

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] = () => undefined
  let reject: Deferred<T>['reject'] = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

class StreamFile extends File {
  constructor(
    size: number,
    private readonly readable: ReadableStream<FileBytes>
  ) {
    super([new Uint8Array(size)], 'fixture.pdf', {
      type: 'application/pdf'
    })
  }

  override stream(): ReadableStream<FileBytes> {
    return this.readable
  }
}

async function collectUnhandledRejections(
  action: () => Promise<void>
): Promise<unknown[]> {
  const reasons: unknown[] = []
  const onUnhandledRejection = (reason: unknown) => {
    reasons.push(reason)
  }
  process.on('unhandledRejection', onUnhandledRejection)
  try {
    await action()
    await new Promise((resolve) => setTimeout(resolve, 0))
    return reasons
  } finally {
    process.off('unhandledRejection', onUnhandledRejection)
  }
}

describe('loadFileToMemory', () => {
  it('预分配目标缓冲区并报告单调递增的真实字节进度', async () => {
    // Given
    const stream = new ReadableStream<FileBytes>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2))
        controller.enqueue(Uint8Array.of(3))
        controller.enqueue(Uint8Array.of(4, 5, 6))
        controller.close()
      }
    })
    const file = new StreamFile(6, stream)
    const progress: Array<readonly [number, number]> = []

    // When
    const result = await loadFileToMemory(file, (loaded, total) => {
      progress.push([loaded, total])
    })

    // Then
    expect(result.file).toBe(file)
    expect(Array.from(new Uint8Array(result.buffer))).toEqual([
      1, 2, 3, 4, 5, 6
    ])
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(progress).toEqual([
      [2, 6],
      [3, 6],
      [6, 6]
    ])
    const reacquiredReader = stream.getReader()
    reacquiredReader.releaseLock()
  })

  it('首块后读取永久 pending 时由 abort 立即唤醒并释放 reader lock', async () => {
    // Given
    const secondReadStarted = createDeferred<void>()
    let pullCount = 0
    const cancel = vi.fn()
    const stream = new ReadableStream<FileBytes>(
      {
        cancel,
        pull(controller) {
          pullCount += 1
          if (pullCount === 1) {
            controller.enqueue(Uint8Array.of(1, 2))
            return
          }
          secondReadStarted.resolve()
          return new Promise<void>(() => undefined)
        }
      },
      { highWaterMark: 0 }
    )
    const file = new StreamFile(4, stream)
    const abortController = new AbortController()
    const loading = loadFileToMemory(
      file,
      () => undefined,
      abortController.signal
    )
    await secondReadStarted.promise

    // When
    abortController.abort()

    // Then
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledTimes(1)
    const reacquiredReader = stream.getReader()
    reacquiredReader.releaseLock()
  })

  it('cancel 算法拒绝时保留原始 AbortError、仅取消一次且不产生未处理拒绝', async () => {
    // Given
    const readStarted = createDeferred<void>()
    const cancelError = new Error('cancel failed')
    const cancel = vi.fn(() => Promise.reject(cancelError))
    const stream = new ReadableStream<FileBytes>(
      {
        cancel,
        pull() {
          readStarted.resolve()
          return new Promise<void>(() => undefined)
        }
      },
      { highWaterMark: 0 }
    )
    const file = new StreamFile(2, stream)
    const abortController = new AbortController()

    // When
    const unhandledRejections = await collectUnhandledRejections(async () => {
      const loading = loadFileToMemory(
        file,
        () => undefined,
        abortController.signal
      )
      await readStarted.promise
      abortController.abort()
      await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    })

    // Then
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(unhandledRejections).toEqual([])
    const reacquiredReader = stream.getReader()
    reacquiredReader.releaseLock()
  })

  it('read 与 cancel 都拒绝时仍抛出原始读取错误且无未处理拒绝', async () => {
    // Given
    const readError = new Error('read failed')
    const cancelError = new Error('cancel failed')
    const stream = new ReadableStream<FileBytes>({})
    const reader = stream.getReader()
    const read = vi.spyOn(reader, 'read').mockRejectedValue(readError)
    const cancel = vi.spyOn(reader, 'cancel').mockRejectedValue(cancelError)
    vi.spyOn(stream, 'getReader').mockReturnValueOnce(reader)
    const file = new StreamFile(2, stream)

    // When
    const unhandledRejections = await collectUnhandledRejections(async () => {
      await expect(loadFileToMemory(file, () => undefined)).rejects.toBe(
        readError
      )
    })

    // Then
    expect(read).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(unhandledRejections).toEqual([])
    const reacquiredReader = stream.getReader()
    reacquiredReader.releaseLock()
  })

  it('pre-aborted signal 不启动首次 read、仅取消一次并释放 reader lock', async () => {
    // Given
    const pull = vi.fn(() => new Promise<void>(() => undefined))
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
    const stream = new ReadableStream<FileBytes>(
      { cancel, pull },
      { highWaterMark: 0 }
    )
    const file = new StreamFile(2, stream)
    const abortController = new AbortController()
    abortController.abort()

    // When
    const unhandledRejections = await collectUnhandledRejections(async () => {
      await expect(
        loadFileToMemory(file, () => undefined, abortController.signal)
      ).rejects.toMatchObject({ name: 'AbortError' })
    })

    // Then
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(unhandledRejections).toEqual([])
    const reacquiredReader = stream.getReader()
    reacquiredReader.releaseLock()
  })

  it('流结束时真实字节数与 File.size 不一致则拒绝并释放 reader lock', async () => {
    // Given
    const stream = new ReadableStream<FileBytes>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2))
        controller.close()
      }
    })
    const file = new StreamFile(3, stream)

    // When / Then
    await expect(loadFileToMemory(file, () => undefined)).rejects.toThrow(
      '文件读取字节数不匹配：期望 3，实际 2'
    )
    const reacquiredReader = stream.getReader()
    reacquiredReader.releaseLock()
  })
})
