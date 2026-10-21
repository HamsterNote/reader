// file:// 下 module worker 不能直接以文件 URL 启动（Chromium/WebView 将
// 文件源视为不透明来源）。PDF worker 是自包含模块，可先取源码再以 Blob
// URL 启动；引擎 B 应通过 `GlobalWorkerOptions.workerPort` 使用它。
export async function createPdfWorkerFromAsset(
  workerPath = 'pdfjs/pdf.worker.min.mjs'
): Promise<Worker> {
  const url = new URL(workerPath, location.href).href
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`PDF worker 加载失败：HTTP ${response.status}`)
  }
  const source = await response.text()
  if (source.length < 1024) {
    throw new Error('PDF worker 内容异常')
  }
  const blobUrl = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' })
  )
  try {
    return new Worker(blobUrl, { type: 'module' })
  } finally {
    // Worker 已创建后可释放 Blob URL；脚本内容已由 Worker 持有。
    URL.revokeObjectURL(blobUrl)
  }
}
