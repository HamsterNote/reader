import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createWordRangeFromCaret } from '../components/selection/wordRange'

/** Only accept real glyph hits in this viewer's enhanced, visible text layers. */
export function pdfCaretAtPoint(
  root: HTMLElement,
  x: number,
  y: number
): Range | null {
  const doc = root.ownerDocument
  const hit = doc
    .elementsFromPoint(x, y)
    .find(
      (element) =>
        root.contains(element) &&
        element.closest('.textLayer [data-selection-start-offset]')
    )
  const span = hit?.closest<HTMLElement>(
    '.textLayer [data-selection-start-offset]'
  )
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
  // WebKit may exclude user-select:none nodes from its caret API. Read glyph
  // geometry instead; do not briefly enable native selection to obtain a hit.
  const walker = doc.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  let text: Node | null
  while ((text = walker.nextNode())) {
    const value = text.textContent ?? ''
    for (let i = 0; i < value.length; i++) {
      const character = doc.createRange()
      character.setStart(text, i)
      character.setEnd(text, i + 1)
      for (const rect of Array.from(character.getClientRects())) {
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          character.collapse(x < rect.left + rect.width / 2)
          return character
        }
      }
    }
  }
  return null
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
  const [touch, setTouch] = useState(false)
  const latest = useRef({ validate, onChange })
  latest.current = { validate, onChange }
  const setRange = (range: Range | null, notify = false) => {
    managed.current = range
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
        doc.getSelection()?.removeAllRanges()
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
    const blur = () => {
      cancel()
      pointers.clear()
    }
    // Observe the second finger even when it lands outside this viewer.
    doc.addEventListener('pointerdown', down, true)
    doc.addEventListener('pointermove', move, true)
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', up, true)
    root.addEventListener('scroll', cancel, true)
    root.addEventListener('contextmenu', context)
    doc.defaultView?.addEventListener('blur', blur)
    const observer = new MutationObserver(() => {
      if (
        managed.current &&
        (!managed.current.startContainer.isConnected ||
          !managed.current.endContainer.isConnected ||
          !latest.current.validate(managed.current))
      )
        setRange(null, true)
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      cancel()
      observer.disconnect()
      doc.removeEventListener('pointerdown', down, true)
      doc.removeEventListener('pointermove', move, true)
      doc.removeEventListener('pointerup', up, true)
      doc.removeEventListener('pointercancel', up, true)
      root.removeEventListener('scroll', cancel, true)
      root.removeEventListener('contextmenu', context)
      doc.defaultView?.removeEventListener('blur', blur)
      if (managed.current) setRange(null, true)
    }
  }, [rootRef, source, enabled])
  return { managed, touch, setRange }
}
