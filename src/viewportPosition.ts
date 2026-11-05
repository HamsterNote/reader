import { normalizePercentage } from './readingProgress'

export type ViewportRect = Pick<
  DOMRect,
  'left' | 'right' | 'top' | 'bottom' | 'height' | 'width'
>

export function intersects(a: ViewportRect, b: ViewportRect): boolean {
  return (
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  )
}

export function pagePercentage(
  top: number,
  rect: ViewportRect
): number | undefined {
  return rect.height > 0
    ? normalizePercentage(((top - rect.top) / rect.height) * 100)
    : undefined
}

type VisibleCharacter = { range: Range; offset: number; top: number }

function visibleCharacterInNode(
  node: Node,
  viewport: ViewportRect,
  within?: Range
): VisibleCharacter | undefined {
  if (within && !within.intersectsNode(node)) return undefined
  const text = node.textContent ?? ''
  const start = within?.startContainer === node ? within.startOffset : 0
  const end = within?.endContainer === node ? within.endOffset : text.length
  let first: VisibleCharacter | undefined
  for (let i = start; i < end; i++) {
    if (!text[i].trim()) continue
    const range = node.ownerDocument!.createRange()
    range.setStart(node, i)
    range.setEnd(node, i + 1)
    const rect = Array.from(range.getClientRects()).find((rect) =>
      intersects(rect, viewport)
    )
    if (rect && (!first || rect.top < first.top - 1))
      first = { range, offset: i, top: rect.top }
  }
  return first
}

/** Range geometry, including wrapped text nodes. Offsets count source UTF-16. */
export function firstVisibleCharacter(
  element: Element,
  viewport: ViewportRect,
  within?: Range
): VisibleCharacter | undefined {
  if (!within && !intersects(element.getBoundingClientRect(), viewport))
    return undefined
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT
  )
  let node: Node | null
  let base = 0
  let first: VisibleCharacter | undefined
  while ((node = walker.nextNode())) {
    const character = visibleCharacterInNode(node, viewport, within)
    if (character && (!first || character.top < first.top - 1))
      first = { ...character, offset: base + character.offset }
    base += node.textContent?.length ?? 0
  }
  return first
}
