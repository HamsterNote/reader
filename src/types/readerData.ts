import type { DrawingValue } from '@hamster-note/painting'

import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from './selection'

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

/** VirtualPaper 可持久化的最后浏览位置与缩放。 */
export type ReaderVirtualPaperState = {
  readonly x: number
  readonly y: number
  readonly scale: number
}

/**
 * Reader 可持久化文档数据的统一入口。
 *
 * 传入本对象的字段优先于同名旧版扁平 props。
 */
export type ReaderData = {
  readonly edgeCrop?: ReaderPageEdgeCrop
  readonly hiddenPages?: readonly (number | string)[]
  /** Layout 与 Text 模式共享的规范化高亮数据。Text 模式会实时重算渲染矩形。 */
  readonly ranges?: ReaderSelectionRange[]
  readonly rects?: ReaderSelectionRectangle[]
  readonly pagePaintings?: Record<string, DrawingValue>
  readonly virtualPaper?: ReaderVirtualPaperState
  readonly bookmarkedPageNumbers?: readonly number[]
}
