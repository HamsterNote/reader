import type { PDFDocumentProxy } from './pdfjsRuntime'

/**
 * 从目录标注页向后查找标题的最大页数。偏移量随书增长（实测一本 294 页的
 * 书，末章标注页与实际页相差 238 页），窗口需覆盖整本书的实际偏移。
 */
export const OUTLINE_TITLE_SEARCH_LIMIT = 300

/** 只匹配页面文字开头这一长度内的内容。 */
const OUTLINE_TITLE_HEAD_CHARS = 160

const OUTLINE_PAGE_TEXT_TIMEOUT_MS = 10_000

export type OutlineTitleCorrectionTarget = {
  readonly id: string
  readonly title: string
  readonly pageNumber: number
}

const pageTextCaches = new WeakMap<
  PDFDocumentProxy,
  Map<number, Promise<string>>
>()

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

/** 页面文字开头是否为该标题（忽略空白/引号/破折号）。 */
export function pageStartsWithOutlineTitle(
  pageText: string,
  title: string
): boolean {
  const normalizedTitle = normalizeOutlineTitle(title)
  if (!normalizedTitle) return false
  const head = normalizeOutlineTitle(pageText).slice(
    0,
    OUTLINE_TITLE_HEAD_CHARS
  )
  return head.startsWith(normalizedTitle)
}

function readPageText(
  document: PDFDocumentProxy,
  pageNumber: number
): Promise<string> {
  let cache = pageTextCaches.get(document)
  if (!cache) {
    cache = new Map()
    pageTextCaches.set(document, cache)
  }
  const cached = cache.get(pageNumber)
  if (cached) return cached
  const request = withinTimeout(document.getPage(pageNumber))
    .then((page) => withinTimeout(page.getTextContent()))
    .then((content) =>
      content.items.map((item) => ('str' in item ? item.str : '')).join('')
    )
    .catch((error) => {
      cache.delete(pageNumber)
      throw error
    })
  cache.set(pageNumber, request)
  return request
}

/**
 * 内嵌目录可能来自另一版次，标注页与正文标题页不一致。这里从标注页开始
 * 向后有限范围内查找标题实际所在页；未命中时保留标注页。结果按文档缓存
 * 页面文字，目录每次打开只需计算一次，且不阻塞目录展示。
 */
export async function correctOutlineTitlePages(
  document: PDFDocumentProxy,
  targets: readonly OutlineTitleCorrectionTarget[]
): Promise<ReadonlyMap<string, number>> {
  const corrections = new Map<string, number>()
  for (const target of targets) {
    corrections.set(target.id, target.pageNumber)
  }
  if (typeof document.getPage !== 'function' || !targets.length) {
    return corrections
  }
  for (const target of targets) {
    if (
      !Number.isInteger(target.pageNumber) ||
      target.pageNumber < 1 ||
      !normalizeOutlineTitle(target.title)
    ) {
      continue
    }
    const lastPage = Math.min(
      document.numPages,
      target.pageNumber + OUTLINE_TITLE_SEARCH_LIMIT
    )
    for (
      let pageNumber = target.pageNumber;
      pageNumber <= lastPage;
      pageNumber++
    ) {
      let text: string
      try {
        text = await readPageText(document, pageNumber)
      } catch {
        break
      }
      if (pageStartsWithOutlineTitle(text, target.title)) {
        corrections.set(target.id, pageNumber)
        break
      }
    }
  }
  return corrections
}
