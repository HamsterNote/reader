import { readPackagedText } from './packagedAsset'

// file:// 下 module worker 不能直接以文件 URL 启动（Chromium/WebView 将
// 文件源视为不透明来源）。PDF worker 是自包含模块，可先取源码再以 Blob
// URL 启动；引擎 B 应通过 `GlobalWorkerOptions.workerPort` 使用它。
export async function createPdfWorkerFromAsset(
  workerPath = 'pdfjs/pdf.worker.min.mjs'
): Promise<Worker> {
  const source = await readPackagedText(workerPath)
  if (source.length < 1024) {
    throw new Error('PDF worker 内容异常')
  }
  const blobUrl = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' })
  )
  let worker: Worker | undefined
  try {
    worker = new Worker(blobUrl, { type: 'module' })
    await waitForPdfWorkerReady(worker)
    return worker
  } catch (error) {
    worker?.terminate()
    throw error
  } finally {
    // 等脚本完成加载后再释放 URL，避免 WebKit 异步取脚本时 URL 已失效。
    URL.revokeObjectURL(blobUrl)
  }
}

function waitForPdfWorkerReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onMessageError)
    }
    const onMessage = (event: MessageEvent): void => {
      const data: unknown = event.data
      if (
        data === null ||
        typeof data !== 'object' ||
        Reflect.get(data, 'sourceName') !== 'worker' ||
        Reflect.get(data, 'targetName') !== 'main' ||
        Reflect.get(data, 'action') !== 'ready'
      )
        return
      cleanup()
      resolve()
    }
    const onError = (event: ErrorEvent): void => {
      cleanup()
      reject(new Error(event.message || 'PDF worker 加载失败'))
    }
    const onMessageError = (): void => {
      cleanup()
      reject(new Error('PDF worker 消息解码失败'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('PDF worker 启动超时：未收到 ready'))
    }, 8000)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onMessageError)
  })
}
