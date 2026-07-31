import type { IntermediateText } from '@hamster-note/types'

export const HAMSTER_DEMO_OCR_STORAGE_VERSION = 2

export type DemoOcrMode = 'off' | 'automatic' | 'manual'

export type DemoOcrStorageData = {
  readonly mode: DemoOcrMode
  readonly pages: number[]
  readonly textsByPage: Record<number, IntermediateText[]>
}

type OcrStorageV2 = {
  readonly version: typeof HAMSTER_DEMO_OCR_STORAGE_VERSION
  readonly mode: DemoOcrMode
  readonly pages: readonly number[]
  readonly textsByPage: Readonly<Record<string, readonly unknown[]>>
}

export function parseOcrStorage(raw: string | null): DemoOcrStorageData {
  if (raw === null || raw.trim() === '') {
    return { mode: 'off', pages: [], textsByPage: {} }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed)) {
      return { mode: 'off', pages: [], textsByPage: {} }
    }
    if (parsed.version !== 1 && parsed.version !== 2) {
      return { mode: 'off', pages: [], textsByPage: {} }
    }

    const pages = parsePageList(parsed.pages)
    const textsByPage = parseTextsByPage(parsed.textsByPage)

    const validPages = pages.filter(
      (page) => page > 0 && Number.isInteger(page)
    )

    let mode: DemoOcrMode = validPages.length > 0 ? 'manual' : 'off'
    if (parsed.version === 2 && isDemoOcrMode(parsed.mode)) {
      mode = parsed.mode
    }

    return { mode, pages: validPages, textsByPage }
  } catch {
    return { mode: 'off', pages: [], textsByPage: {} }
  }
}

export function serializeOcrStorage(data: DemoOcrStorageData): string {
  const storage: OcrStorageV2 = {
    version: HAMSTER_DEMO_OCR_STORAGE_VERSION,
    mode: data.mode,
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

    if (texts.every(isIntermediateTextLike)) {
      result[pageNumber] = texts
    }
  }
  return result
}

function isDemoOcrMode(value: unknown): value is DemoOcrMode {
  return value === 'off' || value === 'automatic' || value === 'manual'
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
