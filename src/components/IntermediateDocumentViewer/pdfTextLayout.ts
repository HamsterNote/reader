import type { IntermediateText } from '@hamster-note/types'

import { shouldSeparatePdfText } from './pdfTextSpacing'

export type PdfTextGlyph = {
  readonly text: IntermediateText
  readonly spaceBefore: boolean
  readonly fontSizeRatio: number
}

export type PdfTextLine = {
  readonly glyphs: readonly PdfTextGlyph[]
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly height: number
  readonly fontSize: number
}

export type PdfTextParagraph = {
  readonly lines: readonly PdfTextLine[]
}

export type PdfTextLayout = {
  readonly bodyFontSize: number
  readonly paragraphs: readonly PdfTextParagraph[]
  readonly hasPositionedText: boolean
}

type TextBox = {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
  readonly centerY: number
}

type PositionedText = {
  readonly text: IntermediateText
  readonly box: TextBox
}

type MutableLine = {
  glyphs: PositionedText[]
  centerY: number
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0
  const lower = sorted[middle - 1] ?? upper
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper
}

const getTextBox = (text: IntermediateText): TextBox | null => {
  const points = text.polygon.filter(
    (point) => Number.isFinite(point[0]) && Number.isFinite(point[1])
  )
  if (points.length === 0) return null

  const xs = points.flatMap((point) =>
    point[0] === undefined ? [] : [point[0]]
  )
  const ys = points.flatMap((point) =>
    point[1] === undefined ? [] : [point[1]]
  )
  if (xs.length === 0 || ys.length === 0) return null

  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  const width = right - left
  const height = bottom - top
  if (width < 0 || height <= 0) return null

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerY: top + height / 2
  }
}

const getBodyFontSize = (texts: readonly IntermediateText[]): number => {
  const weightedFontSizes = texts
    .flatMap((text) =>
      Number.isFinite(text.fontSize) && text.fontSize > 0
        ? [
            {
              fontSize: text.fontSize,
              weight: Math.max(1, [...text.content.trim()].length)
            }
          ]
        : []
    )
    .sort((left, right) => left.fontSize - right.fontSize)
  const totalWeight = weightedFontSizes.reduce(
    (sum, entry) => sum + entry.weight,
    0
  )
  const middleWeight = totalWeight / 2
  let accumulatedWeight = 0
  for (const entry of weightedFontSizes) {
    accumulatedWeight += entry.weight
    if (accumulatedWeight >= middleWeight) return entry.fontSize
  }
  return 16
}

const shouldInsertSpace = (
  previous: PositionedText,
  current: PositionedText
): boolean => {
  const previousContent = previous.text.content
  const currentContent = current.text.content
  if (!shouldSeparatePdfText(previousContent, currentContent)) return false

  const gap = current.box.left - previous.box.right
  const previousLength = Math.max(1, [...previousContent].length)
  const currentLength = Math.max(1, [...currentContent].length)
  const averageCharacterWidth =
    (previous.box.width / previousLength + current.box.width / currentLength) / 2
  const averageFontSize = (previous.text.fontSize + current.text.fontSize) / 2
  return gap > Math.max(averageCharacterWidth * 0.35, averageFontSize * 0.18)
}

const createLine = (
  positionedGlyphs: readonly PositionedText[],
  bodyFontSize: number
): PdfTextLine => {
  const sortedGlyphs = [...positionedGlyphs].sort(
    (left, right) => left.box.left - right.box.left
  )
  const glyphs = sortedGlyphs.map((glyph, index): PdfTextGlyph => {
    const previous = index > 0 ? sortedGlyphs[index - 1] : undefined
    const rawRatio = glyph.text.fontSize / bodyFontSize
    return {
      text: glyph.text,
      spaceBefore: previous ? shouldInsertSpace(previous, glyph) : false,
      fontSizeRatio: Math.min(3, Math.max(0.65, rawRatio))
    }
  })
  const tops = sortedGlyphs.map((glyph) => glyph.box.top)
  const bottoms = sortedGlyphs.map((glyph) => glyph.box.bottom)
  const lefts = sortedGlyphs.map((glyph) => glyph.box.left)
  const rights = sortedGlyphs.map((glyph) => glyph.box.right)
  const heights = sortedGlyphs.map((glyph) => glyph.box.height)
  const fontSizes = sortedGlyphs.map((glyph) => glyph.text.fontSize)

  return {
    glyphs,
    top: Math.min(...tops),
    bottom: Math.max(...bottoms),
    left: Math.min(...lefts),
    right: Math.max(...rights),
    height: median(heights),
    fontSize: median(fontSizes)
  }
}

const startsParagraph = (previous: PdfTextLine, current: PdfTextLine): boolean => {
  const verticalGap = current.top - previous.bottom
  const gapThreshold = Math.max(previous.height, current.height) * 1.25
  const fontRatio = Math.max(previous.fontSize, current.fontSize) /
    Math.max(1, Math.min(previous.fontSize, current.fontSize))
  return verticalGap > gapThreshold || fontRatio > 1.45
}

export const reconstructPdfTextLayout = (
  texts: readonly IntermediateText[]
): PdfTextLayout => {
  const visibleTexts = texts.filter((text) => text.content.trim().length > 0)
  const bodyFontSize = getBodyFontSize(visibleTexts)
  const positionedTexts = visibleTexts.flatMap((text) => {
    const box = getTextBox(text)
    return box ? [{ text, box }] : []
  })
  if (
    positionedTexts.length === 0 ||
    positionedTexts.length !== visibleTexts.length
  ) {
    return { bodyFontSize, paragraphs: [], hasPositionedText: false }
  }

  const mutableLines: MutableLine[] = []
  const sortedTexts = [...positionedTexts].sort(
    (left, right) => left.box.centerY - right.box.centerY || left.box.left - right.box.left
  )
  for (const glyph of sortedTexts) {
    const matchingLine = mutableLines.find((line) => {
      const lineHeight = median(line.glyphs.map((item) => item.box.height))
      return Math.abs(line.centerY - glyph.box.centerY) <=
        Math.max(lineHeight, glyph.box.height) * 0.55
    })
    if (matchingLine) {
      matchingLine.glyphs.push(glyph)
      matchingLine.centerY = median(
        matchingLine.glyphs.map((item) => item.box.centerY)
      )
    } else {
      mutableLines.push({ glyphs: [glyph], centerY: glyph.box.centerY })
    }
  }

  const lines = mutableLines
    .map((line) => createLine(line.glyphs, bodyFontSize))
    .sort((left, right) => left.top - right.top || left.left - right.left)
  const paragraphs: PdfTextParagraph[] = []
  for (const line of lines) {
    const currentParagraph = paragraphs.at(-1)
    const previousLine = currentParagraph?.lines.at(-1)
    if (!currentParagraph || !previousLine || startsParagraph(previousLine, line)) {
      paragraphs.push({ lines: [line] })
    } else {
      paragraphs[paragraphs.length - 1] = {
        lines: [...currentParagraph.lines, line]
      }
    }
  }

  return { bodyFontSize, paragraphs, hasPositionedText: true }
}
