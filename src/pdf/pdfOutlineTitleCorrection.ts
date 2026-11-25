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

const pageHeadCaches = new WeakMap<
  PDFDocumentProxy,
  Map<number, Promise<string>>
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
 * 页面开头（首行及跨行标题的连续行前缀）是否就是该标题。
 * 只看页首行前缀，避免目录页或正文中提及标题时误命中。
 */
export function pageStartsWithOutlineTitle(
  pageText: string,
  title: string
): boolean {
  const normalizedTitle = normalizeOutlineTitle(title)
  if (!normalizedTitle) return false
  const lines = pageText
    .split(/\r?\n/)
    .map(normalizeOutlineTitle)
    .filter(Boolean)
    .slice(0, 3)
  if (!lines.length) return false
  let candidate = lines[0]
  if (titleMatches(candidate, normalizedTitle)) return true
  for (let index = 1; index < lines.length; index++) {
    candidate += lines[index]
    if (titleMatches(candidate, normalizedTitle)) return true
  }
  return false
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
  if (cached) return cached
  const request = withinTimeout(document.getPage(pageNumber))
    .then((page) => {
      if (signal?.aborted) throw cancelled()
      return withinTimeout(page.getTextContent())
    })
    .then((content) => {
      if (signal?.aborted) throw cancelled()
      return pageHeadFromItems(content.items)
    })
    .catch((error) => {
      cache?.delete(pageNumber)
      throw error
    })
  cache.set(pageNumber, request)
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
 * 而是按当前页页首渐进匹配。调用方应传入 AbortSignal，取消后停止读页。
 * 页面文字按文档/页缓存，且只保留页首片段。
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
