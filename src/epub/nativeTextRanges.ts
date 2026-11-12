import type { LegacyRangeLike } from './epubCompatIndex'

const BLOCKS = 'p,div,section,article,header,footer,li,aside,h1,h2,h3,h4,h5,h6'
export const EPUB_COMPAT_COORDINATES = 'reader-compat-v1' as const

export type NativeTextSource = {
  readonly text: string
  readonly display: string
  readonly displayOffsets: readonly number[]
  readonly first: readonly number[]
  readonly last: readonly number[]
}

/** Reproduce beta.3's leaf-block/line text contract from the actual chapter.
 * Image placement and differing cover/page order need more provenance; reject
 * them instead of interpreting a native offset in the compatibility stream. */
export function nativeTextSource(
  xml: string,
  compatibilityText: string
): NativeTextSource | null {
  const doc = new DOMParser().parseFromString(xml, 'text/html')
  if (doc.querySelector('img,image,svg')) return null
  doc.querySelectorAll('script').forEach((node) => node.remove())
  const body = doc.body
  const blocks = [...body.querySelectorAll(BLOCKS)].filter(
    (node) => !node.querySelector(BLOCKS)
  )
  const lines = (blocks.length ? blocks : [body]).flatMap((node) =>
    (node.textContent ?? '')
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  )
  const text = lines.join('')
  const display = lines.join('\n')
  const first = align(text, compatibilityText, false)
  const last = align(text, compatibilityText, true)
  if (!first || !last) return null
  const displayOffsets = [0]
  for (const char of display.split(''))
    displayOffsets.push(displayOffsets.at(-1)! + (char === '\n' ? 0 : 1))
  return { text, display, displayOffsets, first, last }
}

// Both extremal alignments must agree at each endpoint. Inserted spaces can
// otherwise make a source space ambiguous even when whole streams match.
function align(
  source: string,
  target: string,
  reverse: boolean
): number[] | null {
  const result = new Array<number>(source.length)
  const step = reverse ? -1 : 1
  let sourceIndex = reverse ? source.length - 1 : 0
  for (
    let index = reverse ? target.length - 1 : 0;
    index >= 0 && index < target.length;
    index += step
  ) {
    if (
      sourceIndex >= 0 &&
      sourceIndex < source.length &&
      target[index] === source[sourceIndex]
    ) {
      result[sourceIndex] = index
      sourceIndex += step
    } else if (target[index] !== ' ') return null
  }
  const complete = reverse ? -1 : source.length
  return sourceIndex === complete ? result : null
}

type NativeSegment = {
  sectionIndex: number
  startOffset: number
  endOffset: number
}
export type NativeRangePage = {
  source: NativeTextSource
  sectionIndex: number
  text: string
}

function isSegment(value: unknown): value is NativeSegment {
  if (!value || typeof value !== 'object') return false
  const segment = value as NativeSegment
  return (
    [segment.sectionIndex, segment.startOffset, segment.endOffset].every(
      Number.isInteger
    ) &&
    segment.sectionIndex >= 0 &&
    segment.startOffset >= 0 &&
    segment.endOffset > segment.startOffset
  )
}

export function projectNativeRange(
  range: LegacyRangeLike,
  page: (id: string) => NativeRangePage | undefined
): LegacyRangeLike | null {
  const startPage = page(range.start.selectionId)
  const endPage = page(range.end.selectionId)
  const segments = range.nativeTextSegments
  const samePage = range.start.selectionId === range.end.selectionId
  if (
    !startPage ||
    !endPage ||
    !Array.isArray(segments) ||
    segments.length !== (samePage ? 1 : 2) ||
    !segments.every(isSegment)
  )
    return null
  const first = segments[0]
  const last = segments.at(-1)!
  if (
    first.sectionIndex !== startPage.sectionIndex ||
    last.sectionIndex !== endPage.sectionIndex ||
    (!samePage && last.sectionIndex !== first.sectionIndex + 1)
  )
    return null
  if (
    first.endOffset > startPage.source.display.length ||
    last.endOffset > endPage.source.display.length ||
    startPage.source.displayOffsets[first.startOffset] !== range.start.offset ||
    endPage.source.displayOffsets[last.endOffset] !== range.end.offset
  )
    return null
  if (
    !samePage &&
    (first.endOffset !== startPage.source.display.length ||
      last.startOffset !== 0)
  )
    return null
  const selected = samePage
    ? startPage.source.display.slice(first.startOffset, first.endOffset)
    : startPage.source.display.slice(first.startOffset) +
      '\n\n' +
      endPage.source.display.slice(0, last.endOffset)
  if (selected !== range.text) return null
  const start = range.start.offset
  const end = range.end.offset - 1
  if (
    startPage.source.first[start] === undefined ||
    endPage.source.first[end] === undefined ||
    startPage.source.first[start] !== startPage.source.last[start] ||
    endPage.source.first[end] !== endPage.source.last[end]
  )
    return null
  const startOffset = startPage.source.first[start]
  const endOffset = endPage.source.first[end] + 1
  return {
    ...range,
    start: { ...range.start, offset: startOffset },
    end: { ...range.end, offset: endOffset },
    text: samePage
      ? startPage.text.slice(startOffset, endOffset)
      : startPage.text.slice(startOffset) + endPage.text.slice(0, endOffset),
    epubRangeCoordinates: EPUB_COMPAT_COORDINATES
  }
}
