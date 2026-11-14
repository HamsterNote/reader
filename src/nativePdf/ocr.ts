import type { PdfCanonicalPage } from './contracts'

export type NativeOcrPageAvailability = 'textLayer' | 'noTextLayer'

export function shouldRequestNativeOcr(
  enabled: boolean,
  pageNumber: number,
  availability: Readonly<Record<number, NativeOcrPageAvailability>>,
  pageCount: number
): boolean {
  return (
    enabled &&
    Number.isInteger(pageNumber) &&
    pageNumber > 0 &&
    pageNumber <= pageCount &&
    availability[pageNumber] === 'noTextLayer'
  )
}

export function nativeOcrSessionKey(
  fileId: string,
  pageNumber: number
): string {
  return `${fileId}:${pageNumber}`
}

export function canRequestNativeOcrPage(
  key: string,
  requested: ReadonlySet<string>,
  completed: ReadonlySet<string>
): boolean {
  return !requested.has(key) && !completed.has(key)
}

type PolygonPoint = readonly [number, number]
type OcrTextLike = {
  readonly id?: string
  readonly content?: string
  readonly polygon?: readonly PolygonPoint[]
}

function isFinitePoint(point: unknown): point is PolygonPoint {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    typeof point[0] === 'number' &&
    Number.isFinite(point[0]) &&
    typeof point[1] === 'number' &&
    Number.isFinite(point[1])
  )
}

function bounds(text: OcrTextLike, width: number, height: number) {
  const points = (text.polygon ?? []).filter(isFinitePoint)
  if (points.length < 2) return null
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minX = Math.min(...xs) * width
  const maxX = Math.max(...xs) * width
  const minY = Math.min(...ys) * height
  const maxY = Math.max(...ys) * height
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null
  return {
    x: Math.min(minX, maxX),
    y: Math.min(minY, maxY),
    width: Math.max(0, Math.abs(maxX - minX)),
    height: Math.max(0, Math.abs(maxY - minY))
  }
}

/** Convert the existing provider's normalized text boxes to native UTF-16 geometry. */
export function nativeCanonicalPageFromOcr(
  pageNumber: number,
  width: number,
  height: number,
  texts: readonly OcrTextLike[]
): PdfCanonicalPage | null {
  const usable = texts.filter(
    (item) =>
      typeof item.content === 'string' &&
      item.content.length > 0 &&
      bounds(item, width, height) !== null
  )
  if (!usable.length) return null
  const text = usable.map((item) => item.content!).join('\n')
  const boundaries: PdfCanonicalPage['boundaries'][number][] = []
  const glyphs: PdfCanonicalPage['glyphs'][number][] = []
  let offset = 0
  for (const item of usable) {
    const content = item.content!
    const rect = bounds(item, width, height)!
    const units = [...content].reduce((total, char) => total + char.length, 0)
    for (let i = 0; i <= units; i++) {
      boundaries.push({
        offset: offset + i,
        textId: item.id ?? `ocr-${pageNumber}-${offset}`,
        rect: {
          x: rect.x + rect.width * (i / Math.max(1, units)),
          y: rect.y,
          width: rect.width / Math.max(1, units),
          height: rect.height
        }
      })
    }
    glyphs.push({
      start: offset,
      end: offset + units,
      text: content,
      rect
    })
    offset += units + 1
  }
  if (!glyphs.length) return null
  if (boundaries.at(-1)?.offset !== text.length) {
    boundaries.push({
      offset: text.length,
      textId: usable.at(-1)!.id ?? `ocr-${pageNumber}-end`,
      rect: glyphs.at(-1)!.rect
    })
  }
  return { pageNumber, text, width, height, boundaries, glyphs }
}

export function nativeOcrFailurePreservesData<T>(existing: T): T {
  return existing
}
