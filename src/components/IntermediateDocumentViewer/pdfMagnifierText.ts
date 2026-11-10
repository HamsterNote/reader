import type { MagnifierPoint } from './rangeMagnifierGeometry'
import {
  TEXT_LENS_SIZE_PX,
  TEXT_LENS_MAGNIFICATION,
  type TextMagnifierFocus
} from './selectionInteraction'

export type PdfMagnifierFocus = TextMagnifierFocus

// Only PDF.js-generated text presentation is copied, never PDF annotations,
// images, SVG highlights, event handlers or publication attributes.
const TEXT_PROPERTIES = [
  'display',
  'position',
  'left',
  'top',
  'width',
  'height',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'white-space',
  'direction',
  'writing-mode',
  'transform',
  'transform-origin'
]

const caches = new WeakMap<
  HTMLElement,
  Map<HTMLElement, { key: string; copy: HTMLElement }>
>()

function copyText(source: HTMLElement): HTMLElement {
  const doc = source.ownerDocument
  const copy = doc.createElement(source.tagName === 'BR' ? 'br' : 'span')
  const computed = doc.defaultView!.getComputedStyle(source)
  copy.style.all = 'initial'
  for (const property of TEXT_PROPERTIES)
    copy.style.setProperty(property, computed.getPropertyValue(property))
  copy.style.color = '#111'
  copy.style.background = 'transparent'
  copy.style.pointerEvents = 'none'
  copy.style.userSelect = 'none'
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE)
      copy.append(doc.createTextNode(child.textContent ?? ''))
    else if (child instanceof HTMLElement && /^(SPAN|BR)$/.test(child.tagName))
      copy.append(copyText(child))
  }
  return copy
}

export function clearPdfMagnifierText(output: HTMLElement): void {
  caches.delete(output)
  output.replaceChildren()
}

/** Render the current viewport, not a snapshot of the drag's starting page. */
export function renderPdfMagnifierText(
  output: HTMLElement,
  source: HTMLElement,
  point: MagnifierPoint
): void {
  const radius = TEXT_LENS_SIZE_PX / (2 * TEXT_LENS_MAGNIFICATION)
  const previous = caches.get(output)
  const next = new Map<HTMLElement, { key: string; copy: HTMLElement }>()
  const layers = source.querySelectorAll<HTMLElement>('.page .textLayer')
  for (const layer of layers) {
    const rect = layer.getBoundingClientRect()
    if (
      !rect.width ||
      !rect.height ||
      rect.right < point.clientX - radius ||
      rect.left > point.clientX + radius ||
      rect.bottom < point.clientY - radius ||
      rect.top > point.clientY + radius ||
      layer.closest<HTMLElement>('.page')?.style.display === 'none'
    )
      continue
    const key = `${rect.width}:${rect.height}:${layer.textContent}:${Array.from(
      layer.querySelectorAll<HTMLElement>('span')
    )
      .map((span) => span.getAttribute('style'))
      .join(';')}:${layer.getAttribute('style')}`
    const cached = previous?.get(layer)
    const copy = cached?.key === key ? cached.copy : copyText(layer)
    next.set(layer, { key, copy })
    copy.dataset.pdfMagnifierText = 'true'
    const computed = layer.ownerDocument.defaultView!.getComputedStyle(layer)
    // Keep the layer's rotation around its original transform origin. Its
    // bounding box can start before its untransformed layout origin.
    let shiftX = 0,
      shiftY = 0
    if (computed.transform && computed.transform !== 'none') {
      const matrix = new DOMMatrix(computed.transform)
      const [ox, oy] = computed.transformOrigin.split(' ').map(parseFloat)
      const width = parseFloat(computed.width),
        height = parseFloat(computed.height)
      const corners = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height]
      ]
      shiftX = Math.min(
        ...corners.map(
          ([x, y]) => matrix.a * (x - ox) + matrix.c * (y - oy) + matrix.e + ox
        )
      )
      shiftY = Math.min(
        ...corners.map(
          ([x, y]) => matrix.b * (x - ox) + matrix.d * (y - oy) + matrix.f + oy
        )
      )
    }
    Object.assign(copy.style, {
      position: 'absolute',
      left: `${radius + rect.left - point.clientX - shiftX}px`,
      top: `${radius + rect.top - point.clientY - shiftY}px`,
      margin: '0'
    })
    if (copy.parentElement !== output) output.append(copy)
  }
  for (const [layer, cached] of previous ?? [])
    if (!next.has(layer)) cached.copy.remove()
  caches.set(output, next)
}
