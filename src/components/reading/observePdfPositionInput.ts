const controls =
  '[role="dialog"], [role="complementary"], .hamster-reader__page-browser, button, input, select, textarea, [contenteditable="true"]'
const readingKeys = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' '
])

/** Observe intent before PDF/selection listeners can stop propagation. Do not
 * use scroll events: initial restore and layout reflow also produce them. */
export function observePdfPositionInput(root: HTMLElement, moved: () => void) {
  const paper = (event: Event) =>
    event.target instanceof Element && !event.target.closest(controls)
  const wheel = (event: WheelEvent) => {
    if (
      paper(event) &&
      Number.isFinite(event.deltaX) &&
      Number.isFinite(event.deltaY) &&
      (event.deltaX !== 0 || event.deltaY !== 0)
    )
      moved()
  }
  const keydown = (event: KeyboardEvent) => {
    if (paper(event) && readingKeys.has(event.key)) moved()
  }
  const pointers = new Map<number, { x: number; y: number }>()
  const pointerdown = (event: PointerEvent) => {
    // Mouse/pen may start scrollbar dragging, panning or selection auto-scroll.
    // A stationary finger does not count as touch reading.
    if (!paper(event)) return
    if (event.pointerType === 'touch')
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    else moved()
  }
  const pointermove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId)
    if (
      previous &&
      (previous.x !== event.clientX || previous.y !== event.clientY)
    ) {
      moved()
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
  }
  const clearPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
  }
  const touches = new Map<number, { x: number; y: number }>()
  const touchstart = (event: TouchEvent) => {
    touches.clear()
    if (!paper(event)) return
    for (const point of Array.from(event.touches))
      touches.set(point.identifier, { x: point.clientX, y: point.clientY })
  }
  const touchmove = (event: TouchEvent) => {
    // Both single-finger reading and pinch zoom can move the reading line.
    const changed = Array.from(event.touches).some((point) => {
      const previous = touches.get(point.identifier)
      return (
        previous &&
        Number.isFinite(point.clientX) &&
        Number.isFinite(point.clientY) &&
        (point.clientX !== previous.x || point.clientY !== previous.y)
      )
    })
    if (changed) moved()
    touchstart(event)
  }
  const clearTouch = () => {
    touches.clear()
  }
  const listeners = {
    wheel,
    keydown,
    pointerdown,
    pointermove,
    pointerup: clearPointer,
    pointercancel: clearPointer,
    touchstart,
    touchmove,
    touchend: touchstart,
    touchcancel: clearTouch
  }
  for (const [type, listener] of Object.entries(listeners))
    root.addEventListener(type, listener as EventListener, {
      capture: true,
      passive: true
    })
  return () => {
    for (const [type, listener] of Object.entries(listeners))
      root.removeEventListener(type, listener as EventListener, true)
  }
}
