import type { PDFDocumentProxy } from './pdfjsRuntime'

/**
 * 从目录标注页向后查找标题的最大页数。偏移量随书增长（实测一本 294 页的
 * 书，末章标注页与实际页相差 238 页），窗口需覆盖整本书的实际偏移。
 *
 * 只向后搜索是有意取舍：负偏移（真实页早于标注页）无法发现，此时保留
 * 标注页。需要向前修正时应在更高层提供页面级匹配，而不是扩大搜索方向。
 */
export const OUTLINE_TITLE_SEARCH_LIMIT = 300

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

/**
 * 点击目录项时向前查找该标题真实所在的页。目录标注页码整体偏移时（例如
 * 标注 16、实际 22），从标注页开始逐页匹配页首标题；找到第一处即返回，
 * 未找到返回 null，由调用方退回标注页。命中页永远不会早于标注页。
 */
export async function findOutlineTitlePage(
  document: PDFDocumentProxy,
  target: OutlineTitleCorrectionTarget,
  options: OutlineTitleScanOptions = {}
): Promise<number | null> {
  if (typeof document.getPage !== 'function' || !isSearchableTarget(target)) {
    return null
  }
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
    if (signal?.aborted) return null
    let text: string
    try {
      text = await readOutlinePageHeadText(document, pageNumber, options)
    } catch {
      return null
    }
    if (pageStartsWithOutlineTitle(text, target.title)) return pageNumber
  }
  return null
}

function matchingTargetIds(
  pageText: string,
  unmatched: ReadonlyMap<string, OutlineTitleCorrectionTarget>,
  pageNumber: number
): readonly string[] {
  const ids: string[] = []
  for (const [id, target] of unmatched) {
    if (
      pageNumber >= target.pageNumber &&
      pageStartsWithOutlineTitle(pageText, target.title)
    ) {
      ids.push(id)
    }
  }
  return ids
}

/**
 * 按页序把已读到的页首标题归到各目录项：每一项只认标注页之后的第一处
 * 命中，因此同一标题在正文或尾注里再次出现时不会覆盖真正的章节起点。
 *
 * 只扫描到调用方当前所在的页，打开目录时不会冷读整本书；结果按文档/页
 * 缓存，滚动过程中新增的页才需要真正读取。任一页读取失败即停止本轮，
 * 不把失败页当成“标题不在此页”的证据，下次调用会重试。
 */
export async function scanOutlineTitlePages(
  document: PDFDocumentProxy,
  targets: readonly OutlineTitleCorrectionTarget[],
  throughPage: number,
  options: OutlineTitleScanOptions = {}
): Promise<ReadonlyMap<string, number>> {
  const corrections = new Map<string, number>()
  if (
    typeof document.getPage !== 'function' ||
    !Number.isInteger(throughPage) ||
    throughPage < 1
  ) {
    return corrections
  }
  const lastPage = Math.min(document.numPages, throughPage)
  const pending = targets.filter(
    (target) => isSearchableTarget(target) && target.pageNumber <= lastPage
  )
  if (!pending.length) return corrections
  const unmatched = new Map(
    pending.map((target) => [target.id, target] as const)
  )
  let firstPage = lastPage
  for (const target of pending) {
    firstPage = Math.min(firstPage, target.pageNumber)
  }
  const { signal } = options
  for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber++) {
    if (signal?.aborted) return corrections
    let text: string
    try {
      text = await readOutlinePageHeadText(document, pageNumber, options)
    } catch {
      return corrections
    }
    for (const id of matchingTargetIds(text, unmatched, pageNumber)) {
      corrections.set(id, pageNumber)
      unmatched.delete(id)
    }
    if (!unmatched.size) break
  }
  return corrections
}
