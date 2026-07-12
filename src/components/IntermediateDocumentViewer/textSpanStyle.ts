import { TextDir } from '@hamster-note/types'
import type { CSSProperties } from 'react'

import {
  getPolygonTextGeometry,
  getTextBbox,
  type RenderableIntermediateText
} from './pageContentGeometry'

const SCALE_TOLERANCE = 0.00008

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

const buildCanvasFont = (text: RenderableIntermediateText): string | null => {
  if (!Number.isFinite(text.fontSize) || text.fontSize <= 0) return null

  const fontStyle = text.italic ? 'italic' : 'normal'
  const fontWeight = Number.isFinite(text.fontWeight) ? text.fontWeight : 400
  const fontFamily = normalizeCanvasFontFamily(text.fontFamily)

  return `${fontStyle} ${fontWeight} ${text.fontSize}px ${fontFamily}`
}

const canMeasureWithCanvas = (): boolean => {
  if (typeof document === 'undefined') return false
  if (typeof navigator === 'undefined') return true

  return !(
    navigator.userAgent.includes('jsdom/') &&
    HTMLCanvasElement.prototype.getContext.name === 'getContext'
  )
}

const measureTextWidth = (text: RenderableIntermediateText): number | null => {
  if (!canMeasureWithCanvas()) return null

  const context = document.createElement('canvas').getContext('2d')
  const font = buildCanvasFont(text)

  if (!context || !font) return null

  context.font = font
  const metrics = context.measureText(text.content)

  return Number.isFinite(metrics.width) && metrics.width > 0
    ? metrics.width
    : null
}

const getTextWidthScale = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>
): number | undefined => {
  if (text.vertical || text.dir === TextDir.TTB) return undefined
  if (!getPolygonTextGeometry(text.polygon)) return undefined
  if (!Number.isFinite(bbox.width) || bbox.width <= 0) return undefined

  const measuredWidth = measureTextWidth(text)
  if (measuredWidth === null) return undefined

  const scaleX = bbox.width / measuredWidth

  if (!Number.isFinite(scaleX) || scaleX <= 0) return undefined
  return Math.abs(scaleX - 1) > SCALE_TOLERANCE ? scaleX : undefined
}

export const buildTextSpanStyle = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>,
  enableTextWidthScale = false
): CSSProperties => {
  const textTransform = getTextTransform(text, !!bbox.rotation)
  const textWidthScale = enableTextWidthScale
    ? getTextWidthScale(text, bbox)
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
    fontSize:
      Number.isFinite(text.fontSize) && text.fontSize > 0
        ? `${text.fontSize}px`
        : undefined,
    fontFamily: text.fontFamily || undefined,
    fontWeight: text.fontWeight || undefined,
    fontStyle: text.italic ? 'italic' : undefined,
    color: text.color || undefined,
    lineHeight:
      Number.isFinite(text.lineHeight) && text.lineHeight > 0
        ? `${text.lineHeight}px`
        : undefined,
    transform,
    transformOrigin: 'left top',
    whiteSpace: 'pre'
  }
}
