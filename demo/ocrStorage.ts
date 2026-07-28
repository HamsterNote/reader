import type { IntermediateText } from '@hamster-note/types'

export const HAMSTER_DEMO_OCR_STORAGE_VERSION = 1

/**
 * Demo 的 OCR 持久化数据：pages 为已开启 OCR 的页码列表，
 * textsByPage 为每页 OCR 识别出的文本（键为页码字符串，JSON 序列化所致）。
 */
export type DemoOcrStorageData = {
  readonly pages: number[]
  readonly textsByPage: Record<number, IntermediateText[]>
}

type OcrStorageV1 = {
  readonly version: typeof HAMSTER_DEMO_OCR_STORAGE_VERSION
  readonly pages: readonly number[]
  readonly textsByPage: Readonly<Record<string, readonly unknown[]>>
}

export function parseOcrStorage(raw: string | null): DemoOcrStorageData {
  if (raw === null || raw.trim() === '') return { pages: [], textsByPage: {} }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed)) return { pages: [], textsByPage: {} }
    if (parsed.version !== HAMSTER_DEMO_OCR_STORAGE_VERSION) {
      return { pages: [], textsByPage: {} }
    }

    const pages = parsePageList(parsed.pages)
    const textsByPage = parseTextsByPage(parsed.textsByPage)

    // 只保留 textsByPage 中有数据或明确开启的页，二者取交集避免脏数据
    const validPages = pages.filter(
      (page) => page > 0 && Number.isInteger(page)
    )

    return { pages: validPages, textsByPage }
  } catch {
    return { pages: [], textsByPage: {} }
  }
}

export function serializeOcrStorage(data: DemoOcrStorageData): string {
  const storage: OcrStorageV1 = {
    version: HAMSTER_DEMO_OCR_STORAGE_VERSION,
    pages: data.pages,
    textsByPage: Object.fromEntries(
      Object.entries(data.textsByPage).map(([page, texts]) => [
        page,
        texts.map((text) => ({ ...text }))
      ])
    )
  }
  return JSON.stringify(storage)
}

function parsePageList(value: unknown): number[] {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value.filter(
        (page): page is number =>
          typeof page === 'number' && Number.isInteger(page) && page > 0
      )
    )
  ).sort((left, right) => left - right)
}

function parseTextsByPage(value: unknown): Record<number, IntermediateText[]> {
  if (!isPlainRecord(value)) return {}

  const result: Record<number, IntermediateText[]> = {}
  for (const [key, texts] of Object.entries(value)) {
    const pageNumber = Number(key)
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) continue
    if (!Array.isArray(texts)) continue

    const validTexts = texts.filter(isIntermediateTextLike)
    if (validTexts.length > 0) {
      result[pageNumber] = validTexts
    }
  }
  return result
}

// 轻量形状校验：OCR 文本必须带 id/content/polygon 才能被渲染层消费
function isIntermediateTextLike(value: unknown): value is IntermediateText {
  if (!isPlainRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.content === 'string' &&
    Array.isArray(value.polygon)
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
