const READ_TIMEOUT_MS = 8000

/** WKWebView 的 file:// 读取没有 HTTP 状态码；用 XHR load + 非空字节判断成功。 */
export async function readPackagedAsset(path: string): Promise<ArrayBuffer> {
  const root = new URL('.', location.href)
  const url = new URL(path, root)
  const pathname = decodeURIComponent(url.pathname)
  if (
    url.protocol !== root.protocol ||
    url.host !== root.host ||
    !pathname.startsWith(decodeURIComponent(root.pathname)) ||
    pathname.split('/').includes('..') ||
    /[\\\0]/.test(pathname)
  ) {
    throw new Error(`资源路径超出阅读目录：${path}`)
  }

  if (url.protocol !== 'file:') {
    const response = await fetch(url.href)
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`)
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength === 0) throw new Error(`资源为空：${path}`)
    return bytes
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', url.href, true)
    request.responseType = 'arraybuffer'
    request.timeout = READ_TIMEOUT_MS
    request.onload = () => {
      const bytes: unknown = request.response
      if (
        (request.status === 0 ||
          (request.status >= 200 && request.status < 300)) &&
        bytes instanceof ArrayBuffer &&
        bytes.byteLength > 0
      ) {
        resolve(bytes)
      } else {
        reject(
          new Error(`本地资源读取失败或为空：${path}（状态 ${request.status}）`)
        )
      }
    }
    request.onerror = () => reject(new Error(`本地资源读取失败：${path}`))
    request.onabort = () => reject(new Error(`本地资源读取已取消：${path}`))
    request.ontimeout = () => reject(new Error(`本地资源读取超时：${path}`))
    request.send()
  })
}

export async function readPackagedText(path: string): Promise<string> {
  return new TextDecoder().decode(await readPackagedAsset(path))
}
