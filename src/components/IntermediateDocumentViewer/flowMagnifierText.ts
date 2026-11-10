import type { MagnifierPoint } from './rangeMagnifierGeometry'
import {
  TEXT_LENS_MAGNIFICATION,
  TEXT_LENS_SIZE_PX
} from './selectionInteraction'

const FONT_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-feature-settings',
  'font-kerning',
  'letter-spacing',
  'word-spacing',
  'direction'
]
interface GlyphCopy {
  copy: HTMLElement
  left: number
  top: number
}
interface Entry {
  key: string
  glyphs: GlyphCopy[]
}
const fontGenerations = new WeakMap<Document, number>()
function fontGeneration(doc: Document): number {
  if (!fontGenerations.has(doc)) {
    fontGenerations.set(doc, 0)
    doc.fonts?.addEventListener('loadingdone', () => {
      fontGenerations.set(doc, (fontGenerations.get(doc) ?? 0) + 1)
    })
  }
  return fontGenerations.get(doc) ?? 0
}
const caches = new WeakMap<HTMLElement, Map<Text, Entry>>()

export function clearFlowMagnifierText(output: HTMLElement): void {
  caches.delete(output)
  output.replaceChildren()
}

function measureGlyphs(
  output: HTMLElement,
  text: Text,
  rect: DOMRect,
  font: string[],
  fontSize: string
): GlyphCopy[] {
  const glyphs: GlyphCopy[] = []
  const range = text.ownerDocument.createRange()
  let offset = 0
  let previousBox: DOMRect | null = null
  for (const character of text.data) {
    range.setStart(text, offset)
    offset += character.length
    range.setEnd(text, offset)
    const box = range.getBoundingClientRect()
    if (!box.height) continue
    const previousLine = glyphs.at(-1)
    if (
      previousLine &&
      previousBox &&
      Math.abs(box.top - previousBox.top) < 0.5 &&
      Math.abs(box.height - previousBox.height) < 0.5 &&
      Math.min(
        Math.abs(box.left - previousBox.right),
        Math.abs(box.right - previousBox.left)
      ) < parseFloat(fontSize)
    ) {
      previousLine.copy.textContent += character
      previousLine.left = Math.min(previousLine.left, box.left - rect.left)
      previousBox = box
      continue
    }
    previousBox = box
    const copy = output.ownerDocument.createElement('span')
    copy.textContent = character
    copy.style.cssText =
      'all:initial;position:absolute;color:#111;background:transparent;white-space:pre;pointer-events:none;user-select:none;'
    FONT_PROPERTIES.forEach((property, i) =>
      copy.style.setProperty(property, font[i])
    )
    copy.style.lineHeight = `${box.height}px`
    glyphs.push({ copy, left: box.left - rect.left, top: box.top - rect.top })
  }
  return glyphs
}

function textParent(text: Text): HTMLElement | null {
  const parent = text.parentElement
  if (
    !parent ||
    !text.data.trim() ||
    parent.closest(
      'script, style, noscript, svg, button, [aria-hidden="true"], .hsn-selection-overlay, .hsn-selection-handle, .hsn-selection-popover, .hamster-reader__range-magnifier'
    )
  )
    return null
  return parent
}

function intersectsLens(rect: DOMRect, x: number, y: number, radius: number) {
  return (
    rect.width &&
    rect.height &&
    rect.right >= x - radius &&
    rect.left <= x + radius &&
    rect.bottom >= y - radius &&
    rect.top <= y + radius
  )
}

function positionGlyphs(
  output: HTMLElement,
  glyphs: GlyphCopy[],
  rect: DOMRect,
  x: number,
  y: number,
  radius: number
) {
  for (const glyph of glyphs) {
    glyph.copy.style.left = `${radius + rect.left + glyph.left - x}px`
    glyph.copy.style.top = `${radius + rect.top + glyph.top - y}px`
    if (glyph.copy.parentElement !== output) output.append(glyph.copy)
  }
}

/** Copy only glyphs in the current view. No publication nodes, attributes,
 * executable content, backgrounds, selection overlays or event handlers. */
export function renderFlowMagnifierText(
  output: HTMLElement,
  source: HTMLElement,
  point: MagnifierPoint
): void {
  const doc = source.ownerDocument
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
  const x = point.clientX - (frame?.left ?? 0)
  const y = point.clientY - (frame?.top ?? 0)
  const radius = TEXT_LENS_SIZE_PX / (2 * TEXT_LENS_MAGNIFICATION)
  const previous = caches.get(output) ?? new Map<Text, Entry>()
  const next = new Map<Text, Entry>()
  const walker = doc.createTreeWalker(source, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    const parent = textParent(text)
    if (!parent) continue
    const rect = parent.getBoundingClientRect()
    if (!intersectsLens(rect, x, y, radius)) continue
    const computed = doc.defaultView!.getComputedStyle(parent)
    if (computed.visibility === 'hidden' || computed.display === 'none')
      continue
    const font = FONT_PROPERTIES.map((property) =>
      computed.getPropertyValue(property)
    )
    // Translation is applied below; dimensions/font/content invalidate glyph geometry.
    const key = `${fontGeneration(doc)}:${rect.width}:${rect.height}:${font.join(':')}:${text.data}`
    let entry = previous.get(text)
    if (entry?.key !== key) {
      entry?.glyphs.forEach((glyph) => glyph.copy.remove())
      entry = {
        key,
        glyphs: measureGlyphs(output, text, rect, font, computed.fontSize)
      }
    }
    next.set(text, entry)
    positionGlyphs(output, entry.glyphs, rect, x, y, radius)
  }
  for (const [text, entry] of previous)
    if (!next.has(text)) entry.glyphs.forEach((glyph) => glyph.copy.remove())
  caches.set(output, next)
}
