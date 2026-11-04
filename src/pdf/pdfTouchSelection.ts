import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createWordRangeFromCaret } from '../components/selection/wordRange'
import { PdfRangeRetention, snapshotPdfRange } from './pdfRangeRetention'

/** Clear only this reader's native text selection, never another reader/editor. */
export function clearPdfNativeSelection(root: HTMLElement): void {
  const selection = root.ownerDocument.getSelection()
  if (!selection?.rangeCount) return
  const reader = root.closest('.hamster-reader') ?? root
  const editable = (node: Node | null) =>
    (node?.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node?.parentElement
    )?.closest(
      'input, textarea, [contenteditable]:not([contenteditable="false"])'
    )
  if (editable(selection.anchorNode) || editable(selection.focusNode)) return
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(reader)) {
      selection.removeAllRanges()
      return
    }
  }
}

const glyphDistance = (rect: DOMRect, x: number, y: number) => {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  return dx * dx + dy * dy * 4
}

function nearestPdfSpan(root: HTMLElement, x: number, y: number) {
  const bounds = root.getBoundingClientRect()
  let distance = Infinity
  let span: HTMLElement | null = null
  for (const candidate of root.querySelectorAll<HTMLElement>(
    '.page .textLayer [data-selection-start-offset]'
  )) {
    const box = candidate.getBoundingClientRect()
    const visible =
      box.width &&
      box.height &&
      box.bottom > Math.max(0, bounds.top) &&
      box.top < Math.min(innerHeight, bounds.bottom) &&
      box.right >= bounds.left &&
      box.left <= bounds.right
    if (!visible) continue
    const next = glyphDistance(box, x, y)
    if (next < distance) {
      distance = next
      span = candidate
    }
  }
  return span
}

function* glyphRects(span: HTMLElement) {
  const doc = span.ownerDocument
  const walker = doc.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  let text: Node | null
  while ((text = walker.nextNode())) {
    for (let i = 0; i < (text.textContent?.length ?? 0); i++) {
      const range = doc.createRange()
      range.setStart(text, i)
      range.setEnd(text, i + 1)
      for (const rect of Array.from(range.getClientRects()))
        yield { range, rect }
    }
  }
}

function geometryCaret(
  span: HTMLElement,
  x: number,
  y: number,
  nearest: boolean
) {
  let closest: Range | null = null
  let distance = Infinity
  for (const { range, rect } of glyphRects(span)) {
    const next = glyphDistance(rect, x, y)
    if (!nearest && next > 0) continue
    if (next < distance) {
      distance = next
      closest = range.cloneRange()
      closest.collapse(x < rect.left + rect.width / 2)
    }
    if (!next) return closest
  }
  return closest
}

/** Long presses require a real hit; active handles may seek nearby visible text. */
export function pdfCaretAtPoint(
  root: HTMLElement,
  x: number,
  y: number,
  nearest = false
): Range | null {
  const doc = root.ownerDocument
  const hit = doc
    .elementsFromPoint(x, y)
    .find(
      (element) =>
        root.contains(element) &&
        element.closest('.textLayer [data-selection-start-offset]')
    )
  const span =
    hit?.closest<HTMLElement>('.textLayer [data-selection-start-offset]') ??
    (nearest ? nearestPdfSpan(root, x, y) : null)
  if (!span || !root.contains(span)) return null
  const page = span.closest<HTMLElement>('.page')
  if (!page || page.style.display === 'none') return null
  const caretDoc = doc as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const position = caretDoc.caretPositionFromPoint?.(x, y)
  const native = caretDoc.caretRangeFromPoint?.(x, y)
  const node = position?.offsetNode ?? native?.startContainer
  const offset = position?.offset ?? native?.startOffset
  if (
    node?.nodeType === Node.TEXT_NODE &&
    span.contains(node) &&
    offset !== undefined
  ) {
    const caret = doc.createRange()
    caret.setStart(node, offset)
    caret.collapse(true)
    return caret
  }
  // WebKit excludes user-select:none nodes from its caret API. Never briefly
  // enable native selection to obtain a hit.
  return geometryCaret(span, x, y, nearest)
}

export function usePdfTouchSelection({
  rootRef,
  source,
  enabled,
  validate,
  onChange
}: {
  rootRef: RefObject<HTMLDivElement | null>
  source: unknown
  enabled: boolean
  validate: (range: Range) => boolean
  onChange: () => void
}) {
  const managed = useRef<Range | null>(null)
  const retention = useRef(new PdfRangeRetention())
  const recoverRange = useRef<(() => boolean) | null>(null)
  const [touch, setTouch] = useState(false)
  const latest = useRef({ validate, onChange })
  latest.current = { validate, onChange }
  const activate = () => {
    const root = rootRef.current
    if (!root) return
    root.dataset.pdfTouchSelection = 'true'
    setTouch(true)
    clearPdfNativeSelection(root)
  }
  const setRange = (range: Range | null, notify = false) => {
    if (!range) retention.current.clear()
    else if (notify) retention.current.restrictTo(range)
    // Independent of any visible Selection, which WebKit may collapse later.
    managed.current = range?.cloneRange() ?? null
    recoverRange.current = managed.current
      ? snapshotPdfRange(managed.current)
      : null
    const root = rootRef.current
    if (root && managed.current) retention.current.track(root, managed.current)
    if (root?.dataset.pdfTouchSelection) clearPdfNativeSelection(root)
    if (notify) latest.current.onChange()
  }
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const doc = root.ownerDocument
    let timer: ReturnType<typeof setTimeout> | undefined
    let candidate: { pointer: number; x: number; y: number } | null = null
    const pointers = new Set<number>()
    const cancel = () => {
      clearTimeout(timer)
      candidate = null
    }
    const down = (event: PointerEvent) => {
      if (!root.contains(event.target as Node) && !pointers.size) return
      if (event.pointerType !== 'touch') {
        cancel()
        delete root.dataset.pdfTouchSelection
        setTouch(false)
        if (managed.current) setRange(null, true)
        return
      }
      // Apply before the browser's default action, including the first touch.
      root.dataset.pdfTouchSelection = 'true'
      setTouch(true)
      clearPdfNativeSelection(root)
      pointers.add(event.pointerId)
      if (pointers.size > 1 || event.isPrimary === false) {
        cancel()
        return
      }
      if (
        !enabled ||
        event.button !== 0 ||
        !root.contains(event.target as Node)
      )
        return
      if (
        (event.target as Element).closest(
          'a, button, input, textarea, .annotationLayer'
        )
      )
        return
      const caret = pdfCaretAtPoint(root, event.clientX, event.clientY)
      if (!caret) return
      candidate = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY
      }
      timer = setTimeout(() => {
        timer = undefined
        const word = createWordRangeFromCaret(caret)
        if (
          !candidate ||
          !word ||
          !word.startContainer.isConnected ||
          !latest.current.validate(word)
        )
          return
        clearPdfNativeSelection(root)
        setRange(word, true)
      }, 500)
    }
    const move = (event: PointerEvent) => {
      if (
        candidate?.pointer === event.pointerId &&
        Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 8
      )
        cancel()
    }
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (candidate?.pointer === event.pointerId) cancel()
    }
    const context = (event: Event) => {
      if (
        root.dataset.pdfTouchSelection &&
        enabled &&
        (event.target as Element).closest('.textLayer')
      )
        event.preventDefault()
    }
    const suppressNative = () => {
      if (enabled && root.dataset.pdfTouchSelection)
        clearPdfNativeSelection(root)
    }
    const selectStart = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : (event.target as Node).parentElement
      if (!target) return
      const reader = root.closest('.hamster-reader') ?? root
      if (
        enabled &&
        root.dataset.pdfTouchSelection &&
        reader.contains(target) &&
        !target.closest(
          'input, textarea, [contenteditable]:not([contenteditable="false"])'
        )
      )
        event.preventDefault()
    }
    const blur = () => {
      cancel()
      pointers.clear()
    }
    const scroll = () => {
      // Scrolling only cancels a pending long press, never a managed Range.
      if (!root.closest('[data-pdf-handle-dragging]')) cancel()
    }
    // Observe the second finger even when it lands outside this viewer.
    doc.addEventListener('selectionchange', suppressNative)
    doc.addEventListener('selectstart', selectStart, true)
    doc.addEventListener('pointerdown', down, true)
    doc.addEventListener('pointermove', move, true)
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', up, true)
    root.addEventListener('scroll', scroll, true)
    root.addEventListener('contextmenu', context)
    doc.defaultView?.addEventListener('blur', blur)
    const observer = new MutationObserver(() => {
      if (
        managed.current &&
        (!retention.current.restore(root) ||
          !recoverRange.current?.() ||
          !latest.current.validate(managed.current))
      )
        setRange(null, true)
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      cancel()
      observer.disconnect()
      doc.removeEventListener('selectionchange', suppressNative)
      doc.removeEventListener('selectstart', selectStart, true)
      doc.removeEventListener('pointerdown', down, true)
      doc.removeEventListener('pointermove', move, true)
      doc.removeEventListener('pointerup', up, true)
      doc.removeEventListener('pointercancel', up, true)
      root.removeEventListener('scroll', scroll, true)
      root.removeEventListener('contextmenu', context)
      doc.defaultView?.removeEventListener('blur', blur)
      if (managed.current) setRange(null, true)
    }
  }, [rootRef, source, enabled])
  return { managed, touch, setRange, activate }
}
