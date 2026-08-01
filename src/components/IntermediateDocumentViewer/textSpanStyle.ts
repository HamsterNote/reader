import { TextDir } from '@hamster-note/types'
import type { CSSProperties } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import {
  getPolygonTextGeometry,
  type getTextBbox,
  type RenderableIntermediateText
} from './pageContentGeometry'

const SCALE_TOLERANCE = 0.00008

/** 将解析器提供的 px 字号转换为按用户档位缩放的 rem 值。 */
export const getScaledFontSize = (
  fontSize: number,
  fontScale: ReaderFontScale | undefined
): string | undefined => {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return undefined
  return fontScale === undefined
    ? `${fontSize}px`
    : `${(fontSize / 16) * fontScale}rem`
}

const getTextTransform = (
  text: RenderableIntermediateText,
  skipRotate?: boolean
) => {
  const transforms: string[] = []

  if (!skipRotate && text.rotate) {
    transforms.push(`rotate(${text.rotate}deg)`)
  }

  if (text.skew) {
    transforms.push(`skewX(${text.skew}deg)`)
  }

  return transforms.length > 0 ? transforms.join(' ') : undefined
}

const normalizeCanvasFontFamily = (fontFamily: string): string => {
  const trimmedFontFamily = fontFamily.trim()

  if (trimmedFontFamily.length === 0) return 'sans-serif'
  if (!trimmedFontFamily.includes(' ')) return trimmedFontFamily
  if (trimmedFontFamily.startsWith('"') || trimmedFontFamily.startsWith("'")) {
    return trimmedFontFamily
  }

  return `"${trimmedFontFamily.replaceAll('"', '\\"')}"`
}

const buildCanvasFont = (
  text: RenderableIntermediateText,
  fontScale?: ReaderFontScale
): string | null => {
  if (!Number.isFinite(text.fontSize) || text.fontSize <= 0) return null

  const fontStyle = text.italic ? 'italic' : 'normal'
  const fontWeight = Number.isFinite(text.fontWeight) ? text.fontWeight : 400
  const fontFamily = normalizeCanvasFontFamily(text.fontFamily)
  const fontSize = text.fontSize * (fontScale ?? 1)

  return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
}

const canMeasureWithCanvas = (): boolean => {
  if (typeof document === 'undefined') return false
  if (typeof navigator === 'undefined') return true

  return !(
    navigator.userAgent.includes('jsdom/') &&
    HTMLCanvasElement.prototype.getContext.name === 'getContext'
  )
}

export type TextLogicalLine = {
  readonly content: string
  readonly startOffset: number
  readonly endOffset: number
}

export const getTextLogicalLines = (
  content: string
): readonly TextLogicalLine[] => {
  const lines: TextLogicalLine[] = []
  const lineBreakPattern = /\r\n|\r|\n/g
  let lineStart = 0
  let lineBreak = lineBreakPattern.exec(content)

  while (lineBreak) {
    lines.push({
      content: content.slice(lineStart, lineBreak.index),
      startOffset: lineStart,
      endOffset: lineBreak.index
    })
    lineStart = lineBreak.index + lineBreak[0].length
    lineBreak = lineBreakPattern.exec(content)
  }

  if (lineStart < content.length || lines.length === 0) {
    lines.push({
      content: content.slice(lineStart),
      startOffset: lineStart,
      endOffset: content.length
    })
  }

  return lines
}

export const measureTextWidth = (
  text: RenderableIntermediateText,
  content = text.content,
  fontScale?: ReaderFontScale
): number | null => {
  if (!canMeasureWithCanvas()) return null

  const context = document.createElement('canvas').getContext('2d')
  const font = buildCanvasFont(text, fontScale)

  if (!context || !font) return null

  context.font = font
  const metrics = context.measureText(content)

  // 空前缀的合法宽度是 0；高亮适配器需要它来精确映射 offset 0。
  return Number.isFinite(metrics.width) && metrics.width >= 0
    ? metrics.width
    : null
}

export const measureLongestTextLineWidth = (
  text: RenderableIntermediateText,
  fontScale?: ReaderFontScale
): number | null => {
  let longestWidth: number | null = null
  for (const line of getTextLogicalLines(text.content)) {
    const width = measureTextWidth(text, line.content, fontScale)
    if (width !== null && (longestWidth === null || width > longestWidth)) {
      longestWidth = width
    }
  }
  return longestWidth
}

const getTextWidthScale = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>,
  fontScale?: ReaderFontScale
): number | undefined => {
  if (text.vertical || text.dir === TextDir.TTB) return undefined
  if (!getPolygonTextGeometry(text.polygon)) return undefined
  if (!Number.isFinite(bbox.width) || bbox.width <= 0) return undefined

  const measuredWidth = measureLongestTextLineWidth(text, fontScale)
  if (measuredWidth === null) return undefined

  const scaleX = bbox.width / measuredWidth

  if (!Number.isFinite(scaleX) || scaleX <= 0) return undefined
  return Math.abs(scaleX - 1) > SCALE_TOLERANCE ? scaleX : undefined
}

export const buildTextSpanStyle = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>,
  enableTextWidthScale = false,
  fontScale?: ReaderFontScale
): CSSProperties => {
  const textTransform = getTextTransform(text, !!bbox.rotation)
  const textWidthScale = enableTextWidthScale
    ? getTextWidthScale(text, bbox, fontScale)
    : undefined
  const transform = [
    bbox.rotation ? `rotate(${bbox.rotation}deg)` : '',
    textWidthScale ? `scaleX(${textWidthScale})` : '',
    textTransform
  ]
    .filter(Boolean)
    .join(' ')

  return {
    position: 'absolute',
    left: Number.isFinite(bbox.x) ? `${bbox.x}px` : '0px',
    top: Number.isFinite(bbox.y) ? `${bbox.y}px` : '0px',
    width:
      Number.isFinite(bbox.width) && bbox.width > 0
        ? `${bbox.width}px`
        : undefined,
    height:
      Number.isFinite(bbox.height) && bbox.height > 0
        ? `${bbox.height}px`
        : undefined,
    fontSize: getScaledFontSize(text.fontSize, fontScale),
    fontFamily: text.fontFamily || undefined,
    fontWeight: text.fontWeight || undefined,
    fontStyle: text.italic ? 'italic' : undefined,
    color: text.color || undefined,
    lineHeight: getScaledFontSize(text.lineHeight, fontScale),
    transform,
    transformOrigin: 'left top',
    whiteSpace: 'pre'
  }
}
