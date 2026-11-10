import type { LinkedSelectionData, LinkedSelectionRange, SelectionEndpoint } from '@hamster-note/selection'
import { useEffect, useRef } from 'react'
import { EngineSelectionControls } from '../components/EngineSelectionControls'

function contentFor(root: HTMLElement, id: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-selection-id]'))
    .find(element => element.dataset.selectionId === id)
    ?.querySelector<HTMLElement>('.hsn-selection-content') ?? null
}

function resolve(root: HTMLElement, endpoint: SelectionEndpoint) {
  const content = contentFor(root, endpoint.selectionId)
  if (!content) return null
  const walker = root.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  let offset = endpoint.offset
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (offset <= node.length) return { node, offset }
    offset -= node.length
  }
  return null
}

function endpointFor(root: HTMLElement, node: Node, offset: number): SelectionEndpoint | null {
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
export function PdfTextSelectionControls({ root, data, color, onDraft, onUpdate, onEditingChange }: {
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
  const active = data.activeRange ?? data.items.find(item => item.id === data.selectedRangeId)
  const rangeCache = useRef<{ key: string; root: HTMLElement; range: Range | null } | null>(null)
  const key = JSON.stringify([active?.start, active?.end])
  if (root && active && (rangeCache.current?.key !== key || rangeCache.current.root !== root ||
    !rangeCache.current.range?.startContainer.isConnected ||
    rangeCache.current.range.startContainer.nodeType !== Node.TEXT_NODE)) {
    const start = resolve(root, active.start), end = resolve(root, active.end)
    let next: Range | null = null
    if (start && end) {
      next = root.ownerDocument.createRange()
      next.setStart(start.node, start.offset)
      next.setEnd(end.node, end.offset)
      if (next.collapsed) next = null
    }
    rangeCache.current = { key, root, range: next }
  }
  const range = root && active ? rangeCache.current?.range ?? null : null
  const convert = (next: Range): LinkedSelectionRange | null => {
    if (!root || !active) return null
    const start = endpointFor(root, next.startContainer, next.startOffset)
    const end = endpointFor(root, next.endContainer, next.endOffset)
    return start && end ? { ...active, start, end, text: next.toString(), rectsBySelectionId: {} } : null
  }
  return <EngineSelectionControls
    range={range}
    containerRef={containerRef}
    showHandles
    managedText
    color={data.activeRange ? color : active?.markerStyle?.backgroundColor ?? color}
    onEditingChange={value => {
      editing.current = value
      onEditingChange(value)
      if (value) root?.ownerDocument.getSelection()?.removeAllRanges()
    }}
    onUpdate={next => {
      const converted = convert(next)
      if (!converted) return
      if (data.activeRange) onDraft({ ...data, activeRange: { ...converted, markerStyle: { ...converted.markerStyle, backgroundColor: color } } })
      else onUpdate(converted)
    }}
  >{null}</EngineSelectionControls>
}
