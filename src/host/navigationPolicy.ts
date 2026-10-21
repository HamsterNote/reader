// 宿主 WebView 顶层导航策略。只允许阅读入口自身的 file:// 页面；
// 外部 http(s) 链接交给宿主显式打开，不进入 WebView；其余协议一律拒绝。
// 子资源（脚本/worker/图片）不经过该策略，由 WebView 的本地访问设置限制。

export type ReaderNavigationDecision =
  | { readonly action: 'allow' }
  | { readonly action: 'external'; readonly url: string }
  | { readonly action: 'block'; readonly reason: string }

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

function normalizePathname(pathname: string): string {
  // URL.pathname 保留百分号编码；统一解码后再检查 ..，避免编码绕过。
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function isWithinDirectory(candidatePath: string, basePath: string): boolean {
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`
  if (candidatePath === basePath) return true
  if (!candidatePath.startsWith(normalizedBase)) return false
  return !normalizePathname(candidatePath).split('/').includes('..')
}

/**
 * @param rawUrl WebView onShouldStartLoadWithRequest 给出的绝对 URL
 * @param entryUrl 打包阅读入口的 file:// URL
 */
export function decideReaderNavigation(
  rawUrl: string,
  entryUrl: string
): ReaderNavigationDecision {
  let candidate: URL
  let entry: URL
  try {
    candidate = new URL(rawUrl)
    entry = new URL(entryUrl)
  } catch {
    return { action: 'block', reason: 'URL 无法解析' }
  }

  if (candidate.protocol === 'about:' && candidate.pathname === 'blank') {
    return { action: 'allow' }
  }

  if (EXTERNAL_PROTOCOLS.has(candidate.protocol)) {
    return { action: 'external', url: candidate.toString() }
  }

  if (candidate.protocol !== 'file:' || entry.protocol !== 'file:') {
    return { action: 'block', reason: `不允许的协议：${candidate.protocol}` }
  }

  const candidatePath = normalizePathname(candidate.pathname)
  const entryPath = normalizePathname(entry.pathname)
  const basePath = entryPath.slice(0, entryPath.lastIndexOf('/') + 1)
  if (!isWithinDirectory(candidatePath, basePath)) {
    return { action: 'block', reason: '本地路径超出阅读资源目录' }
  }
  if (candidate.host !== entry.host) {
    return { action: 'block', reason: '本地资源 host 不匹配' }
  }
  return { action: 'allow' }
}
