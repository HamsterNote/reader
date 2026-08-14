import { type IntermediateContent, IntermediateText } from '@hamster-note/types'

import { isIntermediateText } from './intermediateContent'

type TextPolygon = IntermediateText['polygon']

export function getTxtLineStart(text: IntermediateText): number | null {
  const [topLeft, topRight, bottomRight, bottomLeft] = text.polygon
  const topY = topLeft[1]
  const bottomY = bottomRight[1]
  const hasPerLineShape =
    topRight[1] === topY &&
    bottomLeft[1] === bottomY &&
    bottomY === topY + 1 &&
    Number.isInteger(topY) &&
    topY >= 0

  return hasPerLineShape ? topY : null
}

export function isPerLineTxtContent(
  content: readonly IntermediateContent[],
  sourceHeight: number
): boolean {
  const texts = content.filter(isIntermediateText)
  if (texts.length !== sourceHeight) return false

  const expectedRows = new Set(
    Array.from({ length: sourceHeight }, (_, index) => index)
  )
  for (const text of texts) {
    const row = getTxtLineStart(text)
    if (row === null || !expectedRows.delete(row)) return false
  }
  return expectedRows.size === 0
}

function makeLinePolygon(
  sourcePolygon: TextPolygon,
  row: number,
  contentWidth: number
): TextPolygon {
  const left = sourcePolygon[0][0]
  const top = sourcePolygon[0][1] + row
  return [
    [left, top],
    [left + contentWidth, top],
    [left + contentWidth, top + 1],
    [left, top + 1]
  ]
}

export function normalizeGiantTxtContent(
  content: readonly IntermediateContent[],
  sourceHeight: number
): IntermediateContent[] | undefined {
  const [sourceText] = content
  if (content.length !== 1 || !sourceText || !isIntermediateText(sourceText)) {
    return undefined
  }

  const lines = sourceText.content.split(/\r\n|\r|\n/)
  if (lines.length !== sourceHeight) return undefined

  const delimiters = sourceText.content.match(/\r\n|\r|\n/g) ?? []
  return lines.map((line, index) => {
    const delimiter = delimiters[index] ?? ''
    return new IntermediateText({
      ...IntermediateText.serialize(sourceText),
      id: `${sourceText.id}:line:${index + 1}`,
      content: `${line}${delimiter}`,
      polygon: makeLinePolygon(sourceText.polygon, index, line.length),
      isEOL: false
    })
  })
}
