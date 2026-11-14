import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  HIGHLIGHT_HANDOFF_TIMEOUT_MS,
  type ReaderHighlightDragHandoff,
  type ReaderHighlightDragCancelReason
} from '../../types/highlightDrag'
import type { ReaderSelectionRange } from '../../types/selection'

type Input = ReactPointerEvent<HTMLDivElement> | PointerEvent
type Candidate = {
  pointerId: number
  pointerType: 'touch' | 'mouse'
  x: number
  y: number
  highlight: ReaderSelectionRange
  handoff: ReaderHighlightDragHandoff
  state: 'pending' | 'waiting' | 'owned'
  timer?: ReturnType<typeof setTimeout>
}

/** Observes the existing pointer stream without making a tracker element or ghost. */
export function useHighlightHandoff({
  viewerRootElement,
  resolveHighlight,
  handoff
}: {
  viewerRootElement: HTMLElement | null
  resolveHighlight: (x: number, y: number) => ReaderSelectionRange | null
  handoff?: ReaderHighlightDragHandoff
}) {
  const current = useRef<Candidate | null>(null)
  const processedMoves = useRef(new WeakSet<Event>())
  const consumedUps = useRef(new WeakSet<Event>())
  const [activePointerType, setActivePointerType] = useState<
    'touch' | 'mouse' | null
  >(null)
  const [suppressNativeSelection, setSuppressNativeSelection] = useState(false)
  const clear = useCallback(() => {
    if (current.current?.timer) clearTimeout(current.current.timer)
    current.current = null
    setActivePointerType(null)
    setSuppressNativeSelection(false)
  }, [])
  const cancel = useCallback(
    (reason: ReaderHighlightDragCancelReason) => {
      const candidate = current.current
      clear()
      if (candidate && candidate.state !== 'pending') {
        candidate.handoff.onGesture(
          { phase: 'cancel', pointerId: candidate.pointerId, reason },
          () => {}
        )
      }
    },
    [clear]
  )
  const activate = useCallback(
    (candidate: Candidate) => {
      if (current.current !== candidate || candidate.state !== 'pending') return
      clearTimeout(candidate.timer)
      candidate.state = 'waiting'
      viewerRootElement?.ownerDocument.getSelection()?.removeAllRanges()
      setActivePointerType(candidate.pointerType)
      candidate.timer = setTimeout(
        () => cancel('handoff-timeout'),
        HIGHLIGHT_HANDOFF_TIMEOUT_MS
      )
      try {
        candidate.handoff.onGesture(
          {
            phase: 'start',
            pointerId: candidate.pointerId,
            pointerType: candidate.pointerType,
            client: { x: candidate.x, y: candidate.y },
            highlight: candidate.highlight
          },
          (status) => {
            if (current.current !== candidate) return
            if (status === 'accepted' && candidate.state === 'waiting') {
              clearTimeout(candidate.timer)
              candidate.state = 'owned'
            } else if (status === 'rejected') cancel('host-rejected')
            else if (status === 'ended') clear()
          }
        )
      } catch {
        cancel('host-rejected')
      }
    },
    [cancel, clear, viewerRootElement]
  )
  const handleHighlightPointerMove = useCallback(
    (event: Input) => {
      const native = 'nativeEvent' in event ? event.nativeEvent : event
      if (processedMoves.current.has(native)) return
      processedMoves.current.add(native)
      const candidate = current.current
      if (!candidate || candidate.pointerId !== event.pointerId) return
      if (candidate.state === 'owned') return
      if (candidate.state === 'waiting') {
        candidate.handoff.onGesture(
          {
            phase: 'move',
            pointerId: event.pointerId,
            client: { x: event.clientX, y: event.clientY }
          },
          () => {}
        )
        return
      }
      if (
        Math.abs(event.clientX - candidate.x) <= 4 &&
        Math.abs(event.clientY - candidate.y) <= 4
      )
        return
      if (candidate.pointerType === 'touch') clear()
      else {
        candidate.x = event.clientX
        candidate.y = event.clientY
        activate(candidate)
      }
    },
    [activate, clear]
  )
  const handleHighlightPointerUp = useCallback(
    (event: Input): boolean => {
      const native = 'nativeEvent' in event ? event.nativeEvent : event
      if (consumedUps.current.has(native)) return true
      const candidate = current.current
      if (!candidate || candidate.pointerId !== event.pointerId) return false
      const triggered = candidate.state !== 'pending'
      if (triggered) consumedUps.current.add(native)
      clear()
      if (candidate.state === 'waiting') {
        candidate.handoff.onGesture(
          {
            phase: 'end',
            pointerId: event.pointerId,
            client: { x: event.clientX, y: event.clientY }
          },
          () => {}
        )
      }
      return triggered
    },
    [clear]
  )
  const handleHighlightPointerCancel = useCallback(
    (event: Input) => {
      if (current.current?.pointerId !== event.pointerId) return
      // Native takeover can cancel the source WebView pointer stream.
      // Its owner decides whether the actual gesture was cancelled.
      if (current.current.state === 'owned') clear()
      else cancel('pointer-cancel')
    },
    [cancel, clear]
  )
  const handleHighlightPointerDown = useCallback(
    (event: Input) => {
      if (!viewerRootElement || !handoff) return
      if (current.current && current.current.pointerId !== event.pointerId) {
        cancel('pointer-cancel')
        return
      }
      if (
        current.current ||
        !event.isPrimary ||
        !['touch', 'mouse'].includes(event.pointerType) ||
        (event.pointerType === 'mouse' && event.button !== 0)
      )
        return
      const highlight = resolveHighlight(event.clientX, event.clientY)
      if (!highlight) return
      const candidate: Candidate = {
        pointerId: event.pointerId,
        pointerType: event.pointerType as 'touch' | 'mouse',
        x: event.clientX,
        y: event.clientY,
        highlight,
        handoff,
        state: 'pending'
      }
      current.current = candidate
      if (candidate.pointerType === 'touch')
        candidate.timer = setTimeout(() => activate(candidate), 500)
      setSuppressNativeSelection(candidate.pointerType === 'touch')
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
    },
    [activate, cancel, handoff, resolveHighlight, viewerRootElement]
  )
  useEffect(() => {
    const doc = viewerRootElement?.ownerDocument
    const win = doc?.defaultView
    if (!doc || !win) return
    const down = (event: PointerEvent) => {
      if (current.current && current.current.pointerId !== event.pointerId)
        cancel('pointer-cancel')
    }
    const blur = () => cancel('blur')
    const exit = (event: PointerEvent) => {
      if (
        !event.relatedTarget &&
        current.current?.state !== 'owned' &&
        current.current?.pointerId === event.pointerId
      )
        cancel('window-exit')
    }
    const touch = (event: TouchEvent) => {
      if (event.touches.length > 1) cancel('pointer-cancel')
      else if (current.current && event.cancelable) event.preventDefault()
    }
    doc.addEventListener('pointerout', exit, true)
    doc.addEventListener('pointerdown', down, true)
    doc.addEventListener('pointermove', handleHighlightPointerMove, true)
    doc.addEventListener('pointerup', handleHighlightPointerUp, true)
    doc.addEventListener('pointercancel', handleHighlightPointerCancel, true)
    viewerRootElement.addEventListener('touchstart', touch, {
      capture: true,
      passive: false
    })
    win.addEventListener('blur', blur)
    return () => {
      doc.removeEventListener('pointerout', exit, true)
      doc.removeEventListener('pointerdown', down, true)
      doc.removeEventListener('pointermove', handleHighlightPointerMove, true)
      doc.removeEventListener('pointerup', handleHighlightPointerUp, true)
      doc.removeEventListener(
        'pointercancel',
        handleHighlightPointerCancel,
        true
      )
      viewerRootElement.removeEventListener('touchstart', touch, true)
      win.removeEventListener('blur', blur)
      cancel('source-replaced')
    }
  }, [
    viewerRootElement,
    handoff,
    cancel,
    handleHighlightPointerMove,
    handleHighlightPointerUp,
    handleHighlightPointerCancel
  ])
  return {
    activePointerType,
    suppressNativeSelection,
    handleHighlightPointerDown,
    handleHighlightPointerMove,
    handleHighlightPointerUp,
    handleHighlightPointerCancel
  }
}
