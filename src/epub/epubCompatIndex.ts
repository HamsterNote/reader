// HAM-88 任务 2.3：整书双向兼容索引。
// 旧 epub-parser 逻辑页/offset ↔ spine 节 DOM Range：
// - 旧高亮定位：逐条校验文本契约（同页切片 / 跨页 后缀+前缀 拼接），
//   契约不成立、节降级、端点越界时返回 unlocatable 并保留原数据，
//   绝不按相似文本重锚（design.md 决策 3）。
// - 新高亮反向序列化：节内 DOM Range → 旧 page-N/offset 端点与规范化文本。
// 定位基于位置而非文本搜索，重复段落天然锚定到正确的页与偏移。

import type { EpubPackage } from './epubPackage'
import type { LegacyEpubModel } from './legacyEpubModel'
import {
  buildSectionTextIndex,
  type SectionTextIndex
} from './sectionTextIndex'
import { legacyPageTextFromChapter } from './legacyText'

export type LegacyEndpoint = {
  readonly selectionId: string
  readonly offset: number
}

export type LegacyRangeLike = {
  readonly text: string
  readonly start: LegacyEndpoint
  readonly end: LegacyEndpoint
}

export type LocatedRangePart = {
  readonly chapterIndex: number
  readonly range: Range
}

export type UnlocatableReason =
  | 'invalid-endpoints'
  | 'text-mismatch'
  | 'degraded-section'
  | 'empty-page'

export type RangeLocation =
  | { readonly status: 'located'; readonly parts: readonly LocatedRangePart[] }
  | { readonly status: 'unlocatable'; readonly reason: UnlocatableReason }

export type SerializedSelection = {
  readonly start: LegacyEndpoint
  readonly end: LegacyEndpoint
  readonly text: string
}

const PAGE_ID_PATTERN = /^page-[1-9]\d*$/

const parsePageNumber = (selectionId: string): number | null => {
  if (!PAGE_ID_PATTERN.test(selectionId)) return null
  return Number(selectionId.slice('page-'.length))
}

export class EpubCompatIndex {
  readonly #model: LegacyEpubModel
  readonly #sectionIndexes: (SectionTextIndex | null)[]
  readonly #staticIndexes: (SectionTextIndex | null)[]

  private constructor(
    model: LegacyEpubModel,
    sectionIndexes: (SectionTextIndex | null)[]
  ) {
    this.#model = model
    this.#sectionIndexes = sectionIndexes
    this.#staticIndexes = [...sectionIndexes]
  }

  /**
   * 用解析好的节文档构建索引。parseDocument 默认 DOMParser
   * （application/xhtml+xml）；浏览器运行时传 foliate 的活文档更稳，
   * 用 attachSectionDocument 覆盖。
   */
  static async create(
    pkg: EpubPackage,
    model: LegacyEpubModel,
    parseDocument: (xml: string) => Document = (xml) =>
      new DOMParser().parseFromString(xml, 'application/xhtml+xml')
  ): Promise<EpubCompatIndex> {
    const sectionIndexes: (SectionTextIndex | null)[] = []
    for (const chapter of pkg.chapters) {
      const xml = await pkg.readText(chapter.href)
      if (xml === null) {
        sectionIndexes.push(null)
        continue
      }
      sectionIndexes.push(
        buildSectionTextIndex(
          parseDocument(xml),
          legacyPageTextFromChapter(xml)
        )
      )
    }
    return new EpubCompatIndex(model, sectionIndexes)
  }

  /** 运行时用 foliate 渲染出的活文档替换静态解析的索引。 */
  attachSectionDocument(chapterIndex: number, doc: Document): boolean {
    const current = this.#sectionIndexes[chapterIndex]
    if (!current) return false
    const next = buildSectionTextIndex(doc, current.legacyText)
    this.#sectionIndexes[chapterIndex] = next
    return next.healthy
  }

  detachSectionDocument(chapterIndex: number): void {
    this.#sectionIndexes[chapterIndex] = this.#staticIndexes[chapterIndex]
  }

  /** Only replace the dragged endpoint; a local iframe Range is not the whole highlight. */
  updateEndpoint(
    original: LegacyRangeLike,
    localRange: Range,
    chapterIndex: number,
    end: boolean
  ): SerializedSelection | null {
    const local = this.serializeRange(chapterIndex, localRange)
    if (!local) return null
    const start = end ? original.start : local.start
    const finish = end ? local.end : original.end
    const startPage = parsePageNumber(start.selectionId)
    const endPage = parsePageNumber(finish.selectionId)
    if (startPage === null || endPage === null || startPage > endPage)
      return null
    const startText = this.pageText(startPage)
    const endText = this.pageText(endPage)
    if (startText === null || endText === null) return null
    const text =
      startPage === endPage
        ? startText.slice(start.offset, finish.offset)
        : startText.slice(start.offset) + endText.slice(0, finish.offset)
    const next = { start, end: finish, text }
    return text && !this.#verifyTextContract(next) ? next : null
  }

  sectionStatus(chapterIndex: number): 'healthy' | 'degraded' | 'missing' {
    const index = this.#sectionIndexes[chapterIndex]
    if (!index) return 'missing'
    return index.healthy ? 'healthy' : 'degraded'
  }

  pageText(pageNumber: number): string | null {
    return (
      this.#model.pages.find((page) => page.pageNumber === pageNumber)?.text ??
      null
    )
  }

  #chapterIndexForPage(pageNumber: number): number | null {
    return (
      this.#model.pages.find((page) => page.pageNumber === pageNumber)
        ?.chapterIndex ?? null
    )
  }

  /** 文本契约校验：返回 null 表示契约成立，否则为失败原因。 */
  #verifyTextContract(range: LegacyRangeLike): UnlocatableReason | null {
    const startPage = parsePageNumber(range.start.selectionId)
    const endPage = parsePageNumber(range.end.selectionId)
    if (startPage === null || endPage === null || endPage < startPage) {
      return 'invalid-endpoints'
    }
    const startText = this.pageText(startPage)
    const endText = this.pageText(endPage)
    if (startText === null || endText === null) return 'invalid-endpoints'
    const { start, end } = range
    if (
      !Number.isInteger(start.offset) ||
      !Number.isInteger(end.offset) ||
      start.offset < 0 ||
      end.offset < 0
    ) {
      return 'invalid-endpoints'
    }
    if (startPage === endPage) {
      if (end.offset > startText.length || start.offset > end.offset) {
        return 'invalid-endpoints'
      }
      return startText.slice(start.offset, end.offset) === range.text
        ? null
        : 'text-mismatch'
    }
    if (start.offset > startText.length || end.offset > endText.length) {
      return 'invalid-endpoints'
    }
    return startText.slice(start.offset) + endText.slice(0, end.offset) ===
      range.text
      ? null
      : 'text-mismatch'
  }

  /**
   * 旧高亮定位：文本契约成立且相关节 healthy 时给出 DOM Range 部件
   * （同页一段、跨页两段）；否则 unlocatable，调用方原样保留数据。
   */
  locateRange(range: LegacyRangeLike): RangeLocation {
    const failure = this.#verifyTextContract(range)
    if (failure) return { status: 'unlocatable', reason: failure }

    const startPage = Number(range.start.selectionId.slice(5))
    const endPage = Number(range.end.selectionId.slice(5))
    const pageSpan: readonly [number, number, number][] =
      startPage === endPage
        ? [[startPage, range.start.offset, range.end.offset]]
        : [
            [startPage, range.start.offset, this.pageText(startPage)!.length],
            [endPage, 0, range.end.offset]
          ]

    const parts: LocatedRangePart[] = []
    for (const [pageNumber, start, end] of pageSpan) {
      if (start === end) continue
      const chapterIndex = this.#chapterIndexForPage(pageNumber)
      if (chapterIndex === null)
        return { status: 'unlocatable', reason: 'empty-page' }
      const sectionIndex = this.#sectionIndexes[chapterIndex]
      if (!sectionIndex?.healthy) {
        return { status: 'unlocatable', reason: 'degraded-section' }
      }
      const domRange = sectionIndex.rangeFromOffsets(start, end)
      if (!domRange)
        return { status: 'unlocatable', reason: 'invalid-endpoints' }
      parts.push({ chapterIndex, range: domRange })
    }
    if (parts.length === 0 && pageSpan.length > 0) {
      // 起止重合的退化 range：没有可绘制内容，按空定位处理。
      return { status: 'located', parts: [] }
    }
    return { status: 'located', parts }
  }

  /**
   * 新高亮反向序列化：节内 DOM Range → 旧端点结构与规范化文本。
   * 跨节选区不存在（各节独立文档），调用方保证 range 属于该节。
   */
  serializeRange(
    chapterIndex: number,
    range: Range
  ): SerializedSelection | null {
    const sectionIndex = this.#sectionIndexes[chapterIndex]
    if (!sectionIndex?.healthy) return null
    const offsets = sectionIndex.offsetsFromRange(range)
    if (!offsets || offsets.start === offsets.end) return null
    const page = this.#model.pages.find(
      (entry) => entry.chapterIndex === chapterIndex
    )
    if (!page) return null
    return {
      start: { selectionId: page.pageId, offset: offsets.start },
      end: { selectionId: page.pageId, offset: offsets.end },
      text: sectionIndex.legacyText.slice(offsets.start, offsets.end)
    }
  }
}
