import type { DrawingValue } from '@hamster-note/painting'

import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from './selection'
import type { ReaderPageTool, ReaderRenderMode } from './readerOptions'

/** 单页四边裁切比例。每个值均以页面原尺寸为基准，取值范围为 0..1。 */
export type ReaderEdgeCrop = {
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
  readonly left?: number
}

/** 页面裁切配置；特殊页面配置覆盖全局配置，不与全局配置叠加。 */
export type ReaderPageEdgeCrop = {
  readonly all?: ReaderEdgeCrop
  readonly pages?: Readonly<Record<string, ReaderEdgeCrop>>
}

/** 指向页面内具体文字的可持久化定位锚点。 */
export type ReaderTextAnchor = {
  readonly pageNumber: number
  readonly textId: string
  readonly text: string
  /** 目标文字起始字符在当前页面内的偏移量，不是整篇文档的累计偏移量。 */
  readonly offset: number
}

/** 精确书签与文字锚点保持相同的数据形状。 */
export type ReaderBookmark = {
  readonly pageNumber: number
  readonly textId: string
  readonly text: string
  /** 目标文字起始字符在当前页面内的偏移量，不是整篇文档的累计偏移量。 */
  readonly offset: number
}

/** VirtualPaper 可持久化的最后浏览位置、缩放与文字锚点。 */
export type ReaderVirtualPaperState = {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly anchor?: ReaderTextAnchor
}

/** Text Mode 可持久化的当前阅读页与文字锚点。 */
export type ReaderTextReadingProgress = {
  readonly currentPageNumber: number
  readonly anchor?: ReaderTextAnchor
}

/**
 * Reader 可持久化文档数据的统一入口。
 *
 * 传入本对象的字段优先于同名旧版扁平 props。
 */
export type ReaderData = {
  readonly renderMode?: ReaderRenderMode
  readonly selectedTool?: ReaderPageTool
  readonly edgeCrop?: ReaderPageEdgeCrop
  readonly hiddenPages?: readonly (number | string)[]
  /** Layout 与 Text 模式共享的规范化高亮数据。Text 模式会实时重算渲染矩形。 */
  readonly ranges?: ReaderSelectionRange[]
  readonly rects?: ReaderSelectionRectangle[]
  readonly pagePaintings?: Record<string, DrawingValue>
  readonly virtualPaper?: ReaderVirtualPaperState
  readonly textReadingProgress?: ReaderTextReadingProgress
  readonly bookmarks?: readonly ReaderBookmark[]
  /** @deprecated 使用可精确定位到文字的 `bookmarks`。 */
  readonly bookmarkedPageNumbers?: readonly number[]
}
