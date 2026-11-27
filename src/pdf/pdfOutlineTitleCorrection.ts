import type { PDFDocumentProxy } from './pdfjsRuntime'

/**
 * 从目录标注页向后查找标题的最大页数。偏移量随书增长（实测一本 294 页的
 * 书，末章标注页与实际页相差 238 页），窗口需覆盖整本书的实际偏移。
 *
 * 只向后搜索是有意取舍：负偏移（真实页早于标注页）无法发现，此时保留
 * 标注页。需要向前修正时应在更高层提供页面级匹配，而不是扩大搜索方向。
 */
export const OUTLINE_TITLE_SEARCH_LIMIT = 300

/** 跳页/恢复位置后，从当前页向回查找最近章节标题的窗口大小。 */
export const OUTLINE_LOCAL_SEARCH_PAGES = 8

/** 只保留页面开头这一长度内的文本，避免缓存整页文字。 */
const OUTLINE_TITLE_HEAD_CHARS = 160

const OUTLINE_PAGE_TEXT_TIMEOUT_MS = 10_000

const ALPHANUMERIC = /[\p{L}\p{N}]/u

export type OutlineTitleCorrectionTarget = {
  readonly id: string
  readonly title: string
  readonly pageNumber: number
}

export type OutlineTitleScanOptions = {
  readonly signal?: AbortSignal
}

export type OutlinePageTitleMatch = {
  readonly matched: boolean
  readonly standalone: boolean
}

export type TrustedOutlinePageMatch = {
  readonly id: string
  readonly title: string
  readonly annotatedPage: number
  readonly pageNumber: number
  readonly standalone: boolean
  /** weak 只表示标注页可读但页首无标题；不能据此校正页码或写入会话校正。 */
  readonly confidence: 'strong' | 'weak'
}

type PageHeadCacheEntry = {
  readonly promise: Promise<string>
  readonly signal?: AbortSignal
  done: boolean
}

const pageHeadCaches = new WeakMap<
  PDFDocumentProxy,
  Map<number, PageHeadCacheEntry>
>()

function cancelled() {
  const error = new Error('PDF outline scan cancelled')
  error.name = 'AbortError'
  return error
}

function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('PDF outline text request timed out')),
        OUTLINE_PAGE_TEXT_TIMEOUT_MS
      )
    })
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/** 去掉空白、引号与破折号，用于跨版式比较目录标题与页面文字。 */
export function normalizeOutlineTitle(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/["'“”‘’「」『』—–―-]/g, '')
    .toLowerCase()
}

function titleMatches(candidate: string, normalizedTitle: string) {
  if (candidate === normalizedTitle) return true
  if (!candidate.startsWith(normalizedTitle)) return false
  // 完整标题之后必须是词/行边界：Intro 不能命中 Introductory material，
  // 章节标题后直接跟正文时也不能算命中。
  return !ALPHANUMERIC.test(candidate.charAt(normalizedTitle.length))
}

/**
 * 页面开头（首行及跨行标题的连续行前缀）是否就是该标题，以及标题是否
 * 独占行尾。独占行尾说明它是版面上的标题行，而不是标题后同一行继续正文；
 * 后者可能只是重复页眉，校正时需要额外证据。
 */
export function matchOutlinePageTitle(
  pageText: string,
  title: string
): OutlinePageTitleMatch {
  const normalizedTitle = normalizeOutlineTitle(title)
  if (!normalizedTitle) return { matched: false, standalone: false }
  const lines = pageText
    .split(/\r?\n/)
    .map(normalizeOutlineTitle)
    .filter(Boolean)
    .slice(0, 3)
  if (!lines.length) return { matched: false, standalone: false }
  let candidate = lines[0]
  const isStandalone = () => candidate.length === normalizedTitle.length
  if (titleMatches(candidate, normalizedTitle)) {
    return { matched: true, standalone: isStandalone() }
  }
  for (let index = 1; index < lines.length; index++) {
    candidate += lines[index]
    if (titleMatches(candidate, normalizedTitle)) {
      return { matched: true, standalone: isStandalone() }
    }
  }
  return { matched: false, standalone: false }
}

/**
 * 页面开头（首行及跨行标题的连续行前缀）是否就是该标题。
 * 只看页首行前缀，避免目录页或正文中提及标题时误命中。
 */
export function pageStartsWithOutlineTitle(
  pageText: string,
  title: string
): boolean {
  return matchOutlinePageTitle(pageText, title).matched
}

/** 当前页页首文字命中的目录项。用于按已读页面渐进校正，不扫描整本书。 */
export function findOutlineTitleMatches(
  pageText: string,
  targets: readonly OutlineTitleCorrectionTarget[]
): readonly OutlineTitleCorrectionTarget[] {
  return targets.filter(
    (target) =>
      Number.isInteger(target.pageNumber) &&
      target.pageNumber >= 1 &&
      Boolean(normalizeOutlineTitle(target.title)) &&
      pageStartsWithOutlineTitle(pageText, target.title)
  )
}

function pageHeadFromItems(items: readonly unknown[]): string {
  let text = ''
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const str = Reflect.get(item, 'str')
    if (typeof str === 'string') text += str
    if (Reflect.get(item, 'hasEOL') === true) text += '\n'
    if (text.length >= OUTLINE_TITLE_HEAD_CHARS) break
  }
  return text.slice(0, OUTLINE_TITLE_HEAD_CHARS)
}

/**
 * 读取页面开头文本。结果按文档/页缓存；调用方取消后不再发起新的读取，
 * 缓存也只保存匹配所需的页首文本。
 */
export function readOutlinePageHeadText(
  document: PDFDocumentProxy,
  pageNumber: number,
  options: OutlineTitleScanOptions = {}
): Promise<string> {
  const { signal } = options
  if (signal?.aborted) return Promise.reject(cancelled())
  let cache = pageHeadCaches.get(document)
  if (!cache) {
    cache = new Map()
    pageHeadCaches.set(document, cache)
  }
  const cached = cache.get(pageNumber)
  // 旧 effect 取消后仍可能在缓存里留下未完成的 Promise；不能把它交给
  // 新 signal 复用，否则新一轮读取会直接因旧 signal 已中止而失败。
  if (cached && (cached.done || !cached.signal?.aborted)) return cached.promise
  if (cached) cache.delete(pageNumber)
  const request: Promise<string> = withinTimeout(document.getPage(pageNumber))
    .then((page) => {
      if (signal?.aborted) throw cancelled()
      return withinTimeout(page.getTextContent())
    })
    .then((content) => {
      if (signal?.aborted) throw cancelled()
      return pageHeadFromItems(content.items)
    })
    .then((text) => {
      const entry = cache?.get(pageNumber)
      if (entry?.promise === request) entry.done = true
      return text
    })
    .catch((error) => {
      if (cache?.get(pageNumber)?.promise === request) cache.delete(pageNumber)
      throw error
    })
  cache.set(pageNumber, { promise: request, signal, done: false })
  return request
}

function isSearchableTarget(target: OutlineTitleCorrectionTarget) {
  return (
    Number.isInteger(target.pageNumber) &&
    target.pageNumber >= 1 &&
    Boolean(normalizeOutlineTitle(target.title))
  )
}

type OutlineTargetSearch = {
  readonly pageNumber: number | null
  readonly aborted: boolean
}

async function searchOutlineTargetPage(
  document: PDFDocumentProxy,
  target: OutlineTitleCorrectionTarget,
  options: OutlineTitleScanOptions
): Promise<OutlineTargetSearch> {
  const { signal } = options
  const lastPage = Math.min(
    document.numPages,
    target.pageNumber + OUTLINE_TITLE_SEARCH_LIMIT
  )
  for (
    let pageNumber = target.pageNumber;
    pageNumber <= lastPage;
    pageNumber++
  ) {
    if (signal?.aborted) return { pageNumber: null, aborted: true }
    let text: string
    try {
      text = await readOutlinePageHeadText(document, pageNumber, options)
    } catch {
      return { pageNumber: null, aborted: Boolean(signal?.aborted) }
    }
    if (pageStartsWithOutlineTitle(text, target.title)) {
      return { pageNumber, aborted: false }
    }
  }
  return { pageNumber: null, aborted: false }
}

/**
 * 显式扫描版式偏移时使用：从标注页开始向后有限范围内查找标题实际所在页，
 * 未命中时保留标注页。阅读器默认不在打开目录时调用它（避免冷开整本），
 * 而是用 {@link findTrustedOutlinePage} 在跳页后做局部窗口匹配。
 * 调用方应传入 AbortSignal，取消后停止读页。页面文字按文档/页缓存，
 * 且只保留页首片段。
 */
export async function correctOutlineTitlePages(
  document: PDFDocumentProxy,
  targets: readonly OutlineTitleCorrectionTarget[],
  options: OutlineTitleScanOptions = {}
): Promise<ReadonlyMap<string, number>> {
  const corrections = new Map<string, number>()
  for (const target of targets) {
    corrections.set(target.id, target.pageNumber)
  }
  if (typeof document.getPage !== 'function' || !targets.length) {
    return corrections
  }
  for (const target of targets) {
    if (!isSearchableTarget(target)) continue
    const result = await searchOutlineTargetPage(document, target, options)
    if (result.aborted) return corrections
    if (result.pageNumber !== null) {
      corrections.set(target.id, result.pageNumber)
    }
  }
  return corrections
}

type PageMatch = {
  readonly target: OutlineTitleCorrectionTarget
  readonly standalone: boolean
}

function matchingTargetsOnPage(
  pageText: string,
  targets: readonly OutlineTitleCorrectionTarget[],
  pageNumber: number
): readonly PageMatch[] {
  return targets.flatMap((target) => {
    if (!isSearchableTarget(target) || pageNumber < target.pageNumber) return []
    const match = matchOutlinePageTitle(pageText, target.title)
    return match.matched ? [{ target, standalone: match.standalone }] : []
  })
}

function bestPageMatch(matches: readonly PageMatch[]): PageMatch {
  return matches.reduce((best, current) =>
    normalizeOutlineTitle(current.target.title).length >
    normalizeOutlineTitle(best.target.title).length
      ? current
      : best
  )
}

function toTrustedMatch(
  match: PageMatch,
  pageNumber: number,
  confidence: TrustedOutlinePageMatch['confidence'] = 'strong'
): TrustedOutlinePageMatch {
  return {
    id: match.target.id,
    title: match.target.title,
    annotatedPage: match.target.pageNumber,
    pageNumber,
    standalone: match.standalone,
    confidence
  }
}

type AnnotatedTitleState = 'matched' | 'no-match' | 'unknown'

async function annotatedPageTitleState(
  document: PDFDocumentProxy,
  targets: readonly OutlineTitleCorrectionTarget[],
  pageNumber: number,
  options: OutlineTitleScanOptions
): Promise<AnnotatedTitleState> {
  try {
    const text = await readOutlinePageHeadText(document, pageNumber, options)
    return targets.some(
      (target) =>
        isSearchableTarget(target) &&
        pageStartsWithOutlineTitle(text, target.title)
    )
      ? 'matched'
      : 'no-match'
  } catch {
    return 'unknown'
  }
}

export type OutlinePageProbe = {
  readonly failed: boolean
  readonly titles: readonly string[]
  readonly result: TrustedOutlinePageMatch | null
  readonly nearest: TrustedOutlinePageMatch | null
}

export async function probeOutlinePage(
  document: PDFDocumentProxy,
  targets: readonly OutlineTitleCorrectionTarget[],
  pageNumber: number,
  currentPageNumber: number,
  windowStartPage: number,
  nearest: TrustedOutlinePageMatch | null,
  seenTitles: ReadonlySet<string>,
  options: OutlineTitleScanOptions
): Promise<OutlinePageProbe> {
  let text: string
  try {
    text = await readOutlinePageHeadText(document, pageNumber, options)
  } catch {
    return { failed: true, titles: [], result: null, nearest }
  }
  const matches = matchingTargetsOnPage(text, targets, pageNumber)
  if (!matches.length) {
    return { failed: false, titles: [], result: null, nearest }
  }
  const titles = matches.map((match) =>
    normalizeOutlineTitle(match.target.title)
  )
  const best = bestPageMatch(matches)
  const candidate = toTrustedMatch(best, pageNumber)
  if (best.target.pageNumber === pageNumber || !best.standalone) {
    return {
      failed: false,
      titles,
      result: candidate,
      nearest: nearest ?? candidate
    }
  }
  const annotatedState = await annotatedPageTitleState(
    document,
    targets,
    best.target.pageNumber,
    options
  )
  // 标注页读取失败时不能把这次候选当作依据，也不得让本页标题计入后续
  // 条目的证据门槛；后续读取仍可重试。
  if (annotatedState === 'unknown') {
    return { failed: false, titles: [], result: null, nearest }
  }
  const nextNearest = nearest ?? candidate
  const evidence = new Set([...seenTitles, ...titles])
  if (evidence.size >= 2) {
    return {
      failed: false,
      titles,
      result: { ...nextNearest, confidence: 'strong' },
      nearest: nextNearest
    }
  }
  if (annotatedState !== 'no-match') {
    return { failed: false, titles, result: null, nearest: nextNearest }
  }
  // 标注页在局部窗口之外、而当前页本身就是标题页时，位置本身构成额外
  // 证据；窗口内仍可能是同名页眉，因此只返回 weak。
  const currentPageIsTitlePage =
    pageNumber === currentPageNumber && best.target.pageNumber < windowStartPage
  return {
    failed: false,
    titles,
    result: toTrustedMatch(
      best,
      pageNumber,
      currentPageIsTitlePage ? 'strong' : 'weak'
    ),
    nearest: nextNearest
  }
}

/**
 * 跳页/恢复位置后，从当前页向回检查最多 {@link OUTLINE_LOCAL_SEARCH_PAGES}
 * 页，返回离当前页最近的、页首命中目录标题的页。
 *
 * 方向约束：校正页不得早于标注页。独占标题行但页号与标注页不同时，需要
 * 窗口内出现多个不同章节标题才接受；标注页可读但没有标题通常只作为 weak
 * 信号返回，调用方不得据此改判——只有当前页本身就是标题页、且标注页位于
 * 窗口外时，位置才是额外证据。标注页读取失败则返回 null，保留标注页并允许
 * 后续重试。
 */
export async function findTrustedOutlinePage(
  document: PDFDocumentProxy,
  targets: readonly OutlineTitleCorrectionTarget[],
  currentPageNumber: number,
  options: OutlineTitleScanOptions & { readonly pageWindow?: number } = {}
): Promise<TrustedOutlinePageMatch | null> {
  if (
    typeof document.getPage !== 'function' ||
    !targets.length ||
    !Number.isInteger(currentPageNumber) ||
    currentPageNumber < 1 ||
    currentPageNumber > document.numPages
  ) {
    return null
  }
  const { signal } = options
  const requestedWindow = Math.floor(
    options.pageWindow ?? OUTLINE_LOCAL_SEARCH_PAGES
  )
  const windowPages = Math.max(
    1,
    Math.min(OUTLINE_LOCAL_SEARCH_PAGES, requestedWindow)
  )
  const lastPage = Math.max(1, currentPageNumber - windowPages + 1)
  const seenTitles = new Set<string>()
  let nearest: TrustedOutlinePageMatch | null = null
  let weak: TrustedOutlinePageMatch | null = null

  for (
    let pageNumber = currentPageNumber;
    pageNumber >= lastPage;
    pageNumber--
  ) {
    if (signal?.aborted) return null
    const probe = await probeOutlinePage(
      document,
      targets,
      pageNumber,
      currentPageNumber,
      lastPage,
      nearest,
      seenTitles,
      options
    )
    if (probe.failed) return null
    for (const title of probe.titles) seenTitles.add(title)
    nearest = probe.nearest
    if (probe.result?.confidence === 'strong') return probe.result
    if (probe.result) weak ??= probe.result
  }
  return weak
}
