import type {
  LinkedSelectionData,
  LinkedSelectionRange,
  SelectionEndpoint
} from '@hamster-note/selection'
import { useEffect, useRef } from 'react'
import { EngineSelectionControls } from '../components/EngineSelectionControls'
import { textCaretAtPoint } from '../components/selection/textCaretAtPoint'

function contentFor(root: HTMLElement, id: string): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLElement>('[data-selection-id]'))
      .find((element) => element.dataset.selectionId === id)
      ?.querySelector<HTMLElement>('.hsn-selection-content') ?? null
  )
}

function resolve(root: HTMLElement, endpoint: SelectionEndpoint) {
  const content = contentFor(root, endpoint.selectionId)
  if (!content) return null
  const walker = root.ownerDocument.createTreeWalker(
    content,
    NodeFilter.SHOW_TEXT
  )
  let offset = endpoint.offset
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (offset <= node.length) return { node, offset }
    offset -= node.length
  }
  return null
}

function endpointFor(
  root: HTMLElement,
  node: Node,
  offset: number
): SelectionEndpoint | null {
  const page = node.parentElement?.closest<HTMLElement>('[data-selection-id]')
  const id = page?.dataset.selectionId
  const content = id ? contentFor(root, id) : null
  if (!content || !content.contains(node)) return null
  const prefix = root.ownerDocument.createRange()
  prefix.selectNodeContents(content)
  prefix.setEnd(node, offset)
  return { selectionId: id!, offset: prefix.toString().length }
}

/** Keep handles outside the dependency's transient drag/unmount lifecycle.
 * Only draft previews are published; a saved edit commits once on release. */
export function PdfTextSelectionControls({
  root,
  data,
  color,
  onDraft,
  onUpdate,
  onEditingChange
}: {
  root: HTMLDivElement | null
  data: LinkedSelectionData
  color: string
  onEditingChange: (editing: boolean) => void
  onDraft: (data: LinkedSelectionData) => void
  onUpdate: (range: LinkedSelectionRange) => void
}) {
  const editing = useRef(false)
  useEffect(() => {
    const doc = root?.ownerDocument
    const suppress = (event: Event) => {
      if (editing.current) event.stopImmediatePropagation()
    }
    doc?.addEventListener('selectionchange', suppress, true)
    return () => {
      doc?.removeEventListener('selectionchange', suppress, true)
    }
  }, [root])
  const containerRef = useRef(root)
  containerRef.current = root
  const active =
    data.activeRange ??
    data.items.find((item) => item.id === data.selectedRangeId)
  const rangeCache = useRef<{
    key: string
    root: HTMLElement
    range: Range | null
  } | null>(null)
  const key = JSON.stringify([active?.start, active?.end])
  if (
    root &&
    active &&
    (rangeCache.current?.key !== key ||
      rangeCache.current.root !== root ||
      !rangeCache.current.range?.startContainer.isConnected ||
      !rangeCache.current.range?.endContainer.isConnected ||
      rangeCache.current.range.startContainer.nodeType !== Node.TEXT_NODE)
  ) {
    const resolvedStart = resolve(root, active.start),
      resolvedEnd = resolve(root, active.end)
    const content = root.querySelector<HTMLElement>('.hsn-selection-content')
    const walker =
      content &&
      root.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker?.nextNode()) nodes.push(walker.currentNode as Text)
    // Only the current original PDF page is mounted. Clip the preview to its
    // text, but keep a missing fixed endpoint in linked source coordinates.
    const start =
      resolvedStart ?? (nodes[0] ? { node: nodes[0], offset: 0 } : null)
    const tail = nodes.at(-1)
    const end =
      resolvedEnd ?? (tail ? { node: tail, offset: tail.length } : null)
    let next: Range | null = null
    if (start && end && (resolvedStart || resolvedEnd)) {
      next = root.ownerDocument.createRange()
      next.setStart(start.node, start.offset)
      next.setEnd(end.node, end.offset)
      if (next.collapsed) next = null
    }
    rangeCache.current = { key, root, range: next }
  }
  const range = root && active ? (rangeCache.current?.range ?? null) : null
  const convert = (next: Range): LinkedSelectionRange | null => {
    if (!root || !active) return null
    const hasStart = !!resolve(root, active.start)
    const hasEnd = !!resolve(root, active.end)
    const start = hasStart
      ? endpointFor(root, next.startContainer, next.startOffset)
      : active.start
    const end = hasEnd
      ? endpointFor(root, next.endContainer, next.endOffset)
      : active.end
    if (!start || !end || !range) return null
    let text = next.toString()
    if (!hasStart || !hasEnd) {
      text = active.text
      const difference = range.cloneRange()
      if (hasStart) {
        const earlier =
          next.compareBoundaryPoints(Range.START_TO_START, range) < 0
        difference.setStart(
          earlier ? next.startContainer : range.startContainer,
          earlier ? next.startOffset : range.startOffset
        )
        difference.setEnd(
          earlier ? range.startContainer : next.startContainer,
          earlier ? range.startOffset : next.startOffset
        )
        const delta = difference.toString()
        text = earlier ? delta + text : text.slice(delta.length)
      }
      if (hasEnd) {
        const later = next.compareBoundaryPoints(Range.END_TO_END, range) > 0
        difference.setStart(
          later ? range.endContainer : next.endContainer,
          later ? range.endOffset : next.endOffset
        )
        difference.setEnd(
          later ? next.endContainer : range.endContainer,
          later ? next.endOffset : range.endOffset
        )
        const delta = difference.toString()
        text = later ? text + delta : text.slice(0, text.length - delta.length)
      }
    }
    return { ...active, start, end, text, rectsBySelectionId: {} }
  }
  return (
    <EngineSelectionControls
      range={range}
      containerRef={containerRef}
      showHandles
      showStart={!!(root && active && resolve(root, active.start))}
      showEnd={!!(root && active && resolve(root, active.end))}
      pdfCustomHandles
      managedText
      hitTest={(x, y) => {
        if (!root) return null
        const caret = textCaretAtPoint(root.ownerDocument, x, y)
        const content = caret?.startContainer.parentElement?.closest(
          '.hsn-selection-content'
        )
        return content && root.contains(content) ? caret : null
      }}
      color={
        data.activeRange
          ? color
          : (active?.markerStyle?.backgroundColor ?? color)
      }
      onEditingChange={(value) => {
        editing.current = value
        onEditingChange(value)
        if (value) root?.ownerDocument.getSelection()?.removeAllRanges()
      }}
      onUpdate={(next) => {
        const converted = convert(next)
        if (!converted) return
        if (data.activeRange)
          onDraft({
            ...data,
            activeRange: {
              ...converted,
              markerStyle: { ...converted.markerStyle, backgroundColor: color }
            }
          })
        else onUpdate(converted)
      }}
    >
      {null}
    </EngineSelectionControls>
  )
}
