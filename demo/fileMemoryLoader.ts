export type LoadedFileMemory = {
  readonly file: File
  readonly buffer: ArrayBuffer
  readonly elapsedMs: number
}

class FileSizeMismatchError extends Error {
  readonly name = 'FileSizeMismatchError'

  constructor(expected: number, actual: number) {
    super(`文件读取字节数不匹配：期望 ${expected}，实际 ${actual}`)
  }
}

function createAbortError(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException('The operation was aborted.', 'AbortError')
  )
}

export async function loadFileToMemory(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<LoadedFileMemory> {
  const startedAt = performance.now()
  const reader = file.stream().getReader()
  const bytes = new Uint8Array(file.size)
  let offset = 0
  let completionReason: unknown
  let cancelPromise: Promise<void> | undefined

  const cancelOnce = (reason?: unknown): Promise<void> => {
    cancelPromise ??= reader.cancel(reason)
    return cancelPromise
  }
  const onAbort = () => {
    const abortError = signal ? createAbortError(signal) : undefined
    // eslint-disable-next-line sonarjs/void-use -- abort 监听器不能 await，计划要求显式消费取消拒绝。
    void cancelOnce(abortError).catch(() => undefined)
  }

  signal?.addEventListener('abort', onAbort)

  try {
    if (signal?.aborted) {
      const abortError = createAbortError(signal)
      await cancelOnce(abortError).catch(() => undefined)
      throw abortError
    }

    while (true) {
      const result = await reader.read()

      if (signal?.aborted) {
        const abortError = createAbortError(signal)
        await cancelOnce(abortError).catch(() => undefined)
        throw abortError
      }

      if (result.done) break

      bytes.set(result.value, offset)
      offset += result.value.byteLength
      onProgress(offset, file.size)
    }

    if (offset !== file.size) {
      throw new FileSizeMismatchError(file.size, offset)
    }

    return {
      file,
      buffer: bytes.buffer,
      elapsedMs: performance.now() - startedAt
    }
  } catch (error) {
    completionReason = error
    await cancelOnce(error).catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await cancelOnce(completionReason).catch(() => undefined)
    reader.releaseLock()
  }
}
