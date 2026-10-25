// 宿主 WebView 导航策略。只允许阅读入口自身的 file:// 页面；
// 外部 http(s) 链接交给宿主显式打开，不进入 WebView；其余协议一律拒绝。
// WKWebView 也会上报章节 iframe 导航；它们需要单独验证主文档与 blob 来源。

export type ReaderNavigationDecision =
  | { readonly action: 'allow' }
  | { readonly action: 'external'; readonly url: string }
  | { readonly action: 'block'; readonly reason: string }

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export type ReaderNavigationContext = {
  readonly isTopFrame?: boolean
  readonly mainDocumentURL?: string
}

function isReaderChapter(
  candidate: URL,
  entry: URL,
  context: ReaderNavigationContext
): boolean {
  if (context.isTopFrame !== false || entry.protocol !== 'file:') return false
  let main: URL
  try {
    main = new URL(context.mainDocumentURL ?? '')
  } catch {
    return false
  }
  if (
    main.protocol !== entry.protocol ||
    main.host !== entry.host ||
    main.pathname !== entry.pathname ||
    main.search !== entry.search
  )
    return false
  // File origins serialize as file:// or null across WebKit/Chromium. Only
  // local object URLs are accepted, never remote-origin blobs. Publication
  // markup is sanitized before object URL creation and cannot create frames.
  return /^blob:(?:file:\/\/\/|null\/)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?:#.*)?$/i.test(
    candidate.href
  )
}

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
  entryUrl: string,
  context: ReaderNavigationContext = {}
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

  if (
    candidate.protocol === 'blob:' &&
    isReaderChapter(candidate, entry, context)
  ) {
    return { action: 'allow' }
  }

  if (EXTERNAL_PROTOCOLS.has(candidate.protocol)) {
    if (context.isTopFrame === false)
      return { action: 'block', reason: '不允许外部子帧导航' }
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
