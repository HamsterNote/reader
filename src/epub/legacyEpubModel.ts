// HAM-88 任务 2.3：旧 epub-parser 逻辑页模型。
// 复刻基线转换链路的页序规则：spine（剔除导航项）一项一页；manifest 封面
// 未被 spine 以"纯封面图页"引用时，在最前补独立封面页并重编号
// （demo/epubForReader.ts 的 addManifestCover + demo/epubImageMetadata.ts 的
// coverInSpine 判定）。页文本来自 legacyText.ts 的旧规范化管线。

import { type EpubPackage } from './epubPackage'
import { legacyPageTextFromChapter } from './legacyText'

export type LegacyEpubPage = {
  /** page-N 中的 N（1 起）。 */
  readonly pageNumber: number
  readonly pageId: string
  /** 对应 chapters 下标；补出的封面页为 null。 */
  readonly chapterIndex: number | null
  readonly text: string
}

export type LegacyEpubCover = {
  readonly id: string
  readonly href: string
  readonly alt: string | null
}

export type LegacyEpubModel = {
  readonly title: string | null
  readonly pages: readonly LegacyEpubPage[]
  readonly coverPrepended: boolean
  readonly cover: LegacyEpubCover | null
}

/**
 * demo/epubImageMetadata.ts 的 resolveArchivePath 移植：用于章节内 img src
 * 解析，拒绝 scheme/反斜杠并 decodeURIComponent（与封面判定输入一致）。
 */
const resolveChapterResourcePath = (
  basePath: string,
  pathReference: string
): string | null => {
  const trimmed = pathReference.trim()
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed) ||
    trimmed.includes('\\')
  ) {
    return null
  }
  const pathWithoutSuffix = trimmed.split(/[?#]/, 1)[0]
  if (!pathWithoutSuffix) return null
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathWithoutSuffix)
  } catch (error) {
    if (error instanceof URIError) return null
    throw error
  }
  const resolved: string[] = decodedPath.startsWith('/')
    ? []
    : basePath.split('/').slice(0, -1)
  for (const segment of decodedPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }
  return resolved.join('/') || null
}

const getElements = (document: Document, localName: string): Element[] =>
  Array.from(document.getElementsByTagNameNS('*', localName))

const parseXml = (xml: string): Document =>
  new DOMParser().parseFromString(xml, 'application/xml')

/**
 * demo isImageOnlyCoverPage 移植：章节 body 无文本且含解析到 coverPath 的
 * img 时，视为 spine 内封面页（不再额外补封面）。
 */
const isImageOnlyCoverPage = (
  chapterXml: string,
  chapterPath: string,
  coverPath: string
): boolean => {
  const chapterDocument = parseXml(chapterXml)
  const body = getElements(chapterDocument, 'body')[0]
  if (!body || body.textContent?.trim()) return false
  return getElements(body.ownerDocument, 'img').some((image) => {
    const source = image.getAttribute('src')
    return source
      ? resolveChapterResourcePath(chapterPath, source) === coverPath
      : false
  })
}

/** demo readPageImages 的封面 alt 提取：全量 xhtml 中首个引用封面图的 img alt。 */
const findCoverAlt = (
  chapterXmls: readonly (readonly [string, string])[],
  coverPath: string
): string | null => {
  for (const [chapterPath, chapterXml] of chapterXmls) {
    for (const image of getElements(parseXml(chapterXml), 'img')) {
      const source = image.getAttribute('src')
      if (
        source &&
        resolveChapterResourcePath(chapterPath, source) === coverPath
      ) {
        return image.getAttribute('alt')?.trim() || null
      }
    }
  }
  return null
}

export const buildLegacyEpubModel = async (
  pkg: EpubPackage
): Promise<LegacyEpubModel> => {
  const chapterXmls: [string, string][] = []
  for (const chapter of pkg.chapters) {
    const xml = await pkg.readText(chapter.href)
    if (xml === null) {
      throw new Error(`EPUB chapter missing from archive: ${chapter.href}`)
    }
    chapterXmls.push([chapter.href, xml])
  }

  const chapterPages: LegacyEpubPage[] = chapterXmls.map(([, xml], index) => ({
    pageNumber: index + 1,
    pageId: `page-${index + 1}`,
    chapterIndex: index,
    text: legacyPageTextFromChapter(xml)
  }))

  // 封面补页：coverItem 存在、封面图可读取、且 spine 内没有纯封面图页。
  let cover: LegacyEpubCover | null = null
  let coverPrepended = false
  if (pkg.coverItem) {
    const coverBytes = await pkg.readBytes(pkg.coverItem.href)
    if (coverBytes) {
      const coverPath = pkg.coverItem.href
      const coverInSpine = chapterXmls.some(([chapterPath, xml]) =>
        isImageOnlyCoverPage(xml, chapterPath, coverPath)
      )
      if (!coverInSpine) {
        cover = {
          id: pkg.coverItem.id,
          href: coverPath,
          alt: findCoverAlt(chapterXmls, coverPath)
        }
        coverPrepended = true
      }
    }
  }

  const pages: LegacyEpubPage[] = coverPrepended
    ? [
        {
          pageNumber: 1,
          pageId: 'page-1',
          chapterIndex: null,
          text: ''
        },
        ...chapterPages.map((page) => ({
          ...page,
          pageNumber: page.pageNumber + 1,
          pageId: `page-${page.pageNumber + 1}`
        }))
      ]
    : chapterPages

  return { title: pkg.title, pages, coverPrepended, cover }
}

/** 章节下标 → 逻辑页号；无对应页（如被过滤）返回 null。 */
export const pageNumberForChapter = (
  model: LegacyEpubModel,
  chapterIndex: number
): number | null => {
  const page = model.pages.find((entry) => entry.chapterIndex === chapterIndex)
  return page ? page.pageNumber : null
}

/** 逻辑页号 → 章节下标；补出的封面页返回 null。 */
export const chapterIndexForPage = (
  model: LegacyEpubModel,
  pageNumber: number
): number | null =>
  model.pages.find((entry) => entry.pageNumber === pageNumber)?.chapterIndex ??
  null
