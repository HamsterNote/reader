const resolvedFills = new Map<string, string>()

/** PDF fill must remain readable even when WebKit cannot blend the overlay. */
export function pdfHighlightFill(color: string, enabled = true): string {
  if (!enabled) return color
  const value = color.trim()
  const cached = resolvedFills.get(value)
  if (cached) return cached
  const parsed = hexFill(value) ?? functionalFill(value)
  if (parsed) return parsed
  const resolved = resolveCssColor(value)
  if (/^rgba?\(/i.test(resolved)) {
    const fill = pdfHighlightFill(resolved)
    resolvedFills.set(value, fill)
    return fill
  }
  // Modern color spaces require modern CSS; apply alpha in the fill itself.
  const fill = `color-mix(in srgb, ${value} 35%, transparent)`
  resolvedFills.set(value, fill)
  resolvedFills.set(fill, fill)
  return fill
}

function hexFill(value: string): string | null {
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value)
  if (!hex) return null
  const digits =
    hex[1].length < 5
      ? [...hex[1]].map((digit) => digit + digit).join('')
      : hex[1]
  const rgb = [0, 2, 4].map((offset) =>
    parseInt(digits.slice(offset, offset + 2), 16)
  )
  const alpha = digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1
  return `rgba(${rgb.join(', ')}, ${Math.min(alpha, 0.35)})`
}

function functionalFill(value: string): string | null {
  const fn = /^(rgba?|hsla?)\((.*)\)$/i.exec(value)
  if (!fn) return null
  const parts = fn[2].split(/[,/\s]+/).filter(Boolean)
  if (parts.length !== 3 && parts.length !== 4) return null
  let alpha = 1
  if (parts[3] !== undefined)
    alpha = parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1)
  if (alpha <= 0.35) return value
  const name = fn[1].toLowerCase().startsWith('rgb') ? 'rgba' : 'hsla'
  return `${name}(${parts.slice(0, 3).join(', ')}, 0.35)`
}

function resolveCssColor(value: string): string {
  if (typeof document === 'undefined' || !document.body) return value
  // Resolve named colors with the browser's CSS parser, including older WebKit.
  const probe = document.createElement('span')
  probe.style.color = value
  probe.style.display = 'none'
  document.body.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}

export type PdfPaintRect = {
  left: number
  top: number
  width: number
  height: number
}

/** Join only touching fragments on the same line; never inflate line height. */
export function mergePdfLineRects(
  rects: readonly PdfPaintRect[]
): PdfPaintRect[] {
  const merged: PdfPaintRect[] = []
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue
    const previous = merged.at(-1)
    const tolerance = Math.min(1, rect.height * 0.08)
    if (
      previous &&
      Math.abs(previous.top - rect.top) <= tolerance &&
      Math.abs(previous.top + previous.height - rect.top - rect.height) <=
        tolerance &&
      rect.left <= previous.left + previous.width + tolerance &&
      previous.left <= rect.left + rect.width + tolerance
    ) {
      const right = Math.max(
        previous.left + previous.width,
        rect.left + rect.width
      )
      const bottom = Math.min(
        previous.top + previous.height,
        rect.top + rect.height
      )
      previous.left = Math.min(previous.left, rect.left)
      previous.top = Math.max(previous.top, rect.top)
      previous.width = right - previous.left
      previous.height = bottom - previous.top
    } else merged.push({ ...rect })
  }
  return merged
}

/**
 * A multi-span Range includes element boxes as well as text boxes. Chromium's
 * font box can also exceed PDF.js' positioned span. Measure text fragments only
 * and clip to the PDF.js span, keeping fractional geometry through projection.
 */
export function pdfRangeClientRects(range: Range): DOMRect[] {
  const doc = range.startContainer.ownerDocument
  if (!doc || typeof range.getClientRects !== 'function') return []
  const root = range.commonAncestorContainer
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const rects: PdfPaintRect[] = []
  let node: Node | null =
    root.nodeType === Node.TEXT_NODE ? root : walker.nextNode()
  while (node) {
    if (range.intersectsNode(node)) {
      rects.push(...textFragmentRects(range, node))
    }
    node = walker.nextNode()
  }
  return mergePdfLineRects(rects).map(
    (rect) => new DOMRect(rect.left, rect.top, rect.width, rect.height)
  )
}

function textFragmentRects(range: Range, node: Node): PdfPaintRect[] {
  const fragment = node.ownerDocument!.createRange()
  fragment.setStart(node, node === range.startContainer ? range.startOffset : 0)
  fragment.setEnd(
    node,
    node === range.endContainer ? range.endOffset : node.textContent!.length
  )
  if (fragment.collapsed) return []
  const box = node.parentElement
    ?.closest('[data-selection-start-offset]')
    ?.getBoundingClientRect()
  return Array.from(fragment.getClientRects(), (rect) =>
    clipTextRect(rect, box)
  )
}

function clipTextRect(rect: DOMRect, box: DOMRect | undefined): PdfPaintRect {
  if (!box || box.width <= 0 || box.height <= 0)
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
  const left = Math.max(rect.left, box.left)
  const top = Math.max(rect.top, box.top)
  const right = Math.min(rect.right, box.right)
  const bottom = Math.min(rect.bottom, box.bottom)
  return { left, top, width: right - left, height: bottom - top }
}
