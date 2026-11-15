/**
 * HAM-278 S12：扫描版样本的 OCR 文字种子（仅 __DEV__ 调试入口）。
 *
 * 样例 PDF 没有文字层，真实识别需要 native OCR provider；S12 要验的是
 * 「canonical 文字先于 web-ready 到达并缓存重放」这条链路，因此用生成脚本
 * 产出的同名 `.ocr.json` 作为已持久化的 OCR 结果，写进快照的
 * `readerData.ocrTexts`，让宿主在打开时提前 publish。
 */
import type { IntermediateText } from '@hamster-note/types'

export type OcrSeed = {
  readonly version: number
  readonly pages: ReadonlyMap<number, readonly IntermediateText[]>
  /** 预置高亮：不依赖长按手势也能触发 activate/materialize。 */
  readonly ranges: readonly Record<string, unknown>[]
}

const MAX_PAGES = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTextItem(value: unknown): value is IntermediateText {
  if (!isRecord(value)) return false
  if (typeof value['content'] !== 'string' || value['content'].length === 0)
    return false
  const polygon = value['polygon']
  return (
    Array.isArray(polygon) &&
    polygon.length >= 2 &&
    polygon.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(
          (value) => typeof value === 'number' && Number.isFinite(value)
        )
    )
  )
}

function isRangeItem(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value['id'] !== 'string') return false
  const start = value['start']
  const end = value['end']
  return (
    isRecord(start) &&
    typeof start['selectionId'] === 'string' &&
    typeof start['offset'] === 'number' &&
    isRecord(end) &&
    typeof end['selectionId'] === 'string' &&
    typeof end['offset'] === 'number'
  )
}

/** 解析并校验种子文件；非法条目丢弃，不进入快照。 */
export function parseOcrSeed(raw: unknown): OcrSeed | null {
  if (!isRecord(raw) || raw['version'] !== 1) return null
  const pagesValue = raw['pages']
  if (!isRecord(pagesValue)) return null
  const pages = new Map<number, readonly IntermediateText[]>()
  for (const [key, value] of Object.entries(pagesValue)) {
    const pageNumber = Number(key)
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue
    if (!Array.isArray(value)) continue
    const texts = value.filter(isTextItem)
    if (texts.length > 0) pages.set(pageNumber, texts)
    if (pages.size >= MAX_PAGES) break
  }
  const ranges = Array.isArray(raw['ranges'])
    ? raw['ranges'].filter(isRangeItem).slice(0, MAX_PAGES)
    : []
  return pages.size > 0 ? { version: 1, pages, ranges } : null
}

export type MergedOcrTexts = {
  readonly data: Record<string, unknown>
  readonly pages: readonly number[]
  readonly texts: number
  readonly ranges: number
}

/** 把种子合并进快照 data（readerData.ocrTexts + annotations.ranges）。 */
export function mergeOcrTexts(
  snapshotData: unknown,
  seed: OcrSeed
): MergedOcrTexts {
  const data = isRecord(snapshotData) ? snapshotData : {}
  const readerData = isRecord(data['readerData']) ? data['readerData'] : {}
  const existing = isRecord(readerData['ocrTexts'])
    ? (readerData['ocrTexts'] as Record<string, readonly IntermediateText[]>)
    : {}
  const ocrTexts: Record<string, readonly IntermediateText[]> = { ...existing }
  let texts = 0
  for (const [pageNumber, items] of seed.pages) {
    ocrTexts[String(pageNumber)] = items
    texts += items.length
  }
  const annotations = isRecord(data['annotations']) ? data['annotations'] : {}
  const existingRanges = Array.isArray(annotations['ranges'])
    ? (annotations['ranges'] as unknown[])
    : []
  const known = new Set(
    existingRanges
      .filter(isRecord)
      .map((range) => range['id'])
      .filter((id): id is string => typeof id === 'string')
  )
  const ranges = [
    ...existingRanges,
    ...seed.ranges.filter((range) => !known.has(range['id'] as string))
  ]
  // 恢复逻辑按 v5 信封严格校验：补齐 version/rects/paintings 三个必需字段。
  const annotationsOut = seed.ranges.length
    ? {
        ...annotations,
        version: 5,
        ranges,
        rects: Array.isArray(annotations['rects']) ? annotations['rects'] : [],
        paintings: isRecord(annotations['paintings'])
          ? annotations['paintings']
          : {}
      }
    : annotations
  return {
    data: {
      ...data,
      readerData: { ...readerData, ocrTexts },
      ...(seed.ranges.length ? { annotations: annotationsOut } : {})
    },
    pages: [...seed.pages.keys()].sort((left, right) => left - right),
    texts,
    ranges: seed.ranges.length
  }
}
