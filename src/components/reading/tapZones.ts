export function readingTapZone(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  x: number,
  y: number
) {
  const localX = x - rect.left
  const localY = y - rect.top
  if (localX < 0 || localX >= rect.width || localY < 0 || localY >= rect.height)
    return null
  if (localY < rect.height / 4 || localY >= (rect.height * 3) / 4)
    return 'toggle'
  if (localX < rect.width / 3) return 'previous'
  return localX >= (rect.width * 2) / 3 ? 'next' : 'toggle'
}

type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
export function readingBounds(paper: Element): Box {
  const box = paper.getBoundingClientRect()
  const root = paper.closest<HTMLElement>('[data-testid="reader-root"]')
  if (!root) return box
  let { top, left, bottom } = box
  const toolbar = root.querySelector<HTMLElement>(
    '[data-testid="tool-bottom-bar"]'
  )
  if (toolbar) {
    const bar = toolbar.getBoundingClientRect()
    const header = Number(root.dataset.readingHeaderInset ?? 0)
    top = Math.max(top, root.getBoundingClientRect().top + header)
    if (bar.height && bar.top < bottom && bar.bottom > top) {
      if (bar.top + bar.height / 2 < box.top + box.height / 2)
        top = Math.max(top, bar.bottom)
      else bottom = Math.min(bottom, bar.top)
    }
  }
  const sidebar = root.querySelector('.hamster-reader__page-browser--open')
  if (sidebar) left = Math.max(left, sidebar.getBoundingClientRect().right)
  return {
    top,
    left,
    width: Math.max(0, box.right - left),
    height: Math.max(0, bottom - top)
  }
}
export type ReadingAction = NonNullable<ReturnType<typeof readingTapZone>>

export function swipeAction(
  box: Box,
  dx: number,
  dy: number
): ReadingAction | null {
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= box.width / 3)
    return dx < 0 ? 'next' : 'previous'
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= box.height / 3)
    return 'toggle'
  return null
}

export function isInteractiveTap(event: MouseEvent) {
  return (
    event.defaultPrevented ||
    event
      .composedPath()
      .some((target) =>
        (target as Element).matches?.(
          'a[href], button, input, textarea, select, label, summary, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="menuitem"], [role="dialog"], [role="toolbar"], .hsn-selection-popover, .hamster-reader__page-browser'
        )
      )
  )
}

export function trackReadingPress(
  target: HTMLElement | Document,
  options: {
    bounds: () => Box | null
    blocked?: (event: MouseEvent) => boolean
    mask?: boolean
    capturePointer?: boolean
    selectionRoot?: HTMLElement
    swipe: (action: ReadingAction) => void
  }
) {
  const doc = target.ownerDocument ?? (target as Document)
  const selectionActive = () => {
    const selection = doc.getSelection()
    if (!selection || selection.isCollapsed) return false
    return (
      !options.selectionRoot ||
      (options.selectionRoot.contains(selection.anchorNode) &&
        options.selectionRoot.contains(selection.focusNode))
    )
  }
  let press: {
    id: number
    x: number
    y: number
    time: number
    released: boolean
    dragged: boolean
    box: Box
  } | null = null
  let suppressClick = false
  const cancel = () => {
    press = null
  }
  const down = (event: PointerEvent) => {
    cancel()
    suppressClick = false
    const box = options.bounds()
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      !event.composedPath().includes(target) ||
      !box ||
      !readingTapZone(box, event.clientX, event.clientY) ||
      (!options.mask && selectionActive()) ||
      options.blocked?.(event) ||
      isInteractiveTap(event)
    )
      return
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      released: false,
      dragged: false,
      box
    }
    if (options.capturePointer && event.isTrusted)
      (event.target as Element).setPointerCapture?.(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (
      press &&
      event.pointerId === press.id &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 0
    )
      press.dragged = true
  }
  const up = (event: PointerEvent) => {
    if (
      press &&
      event.pointerId === press.id &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > 1
    )
      press.dragged = true
    if (!press || event.pointerId !== press.id) return
    if (!readingTapZone(press.box, event.clientX, event.clientY))
      return cancel()
    if (!press.dragged) {
      press.released = true
      return
    }
    const action = swipeAction(
      press.box,
      event.clientX - press.x,
      event.clientY - press.y
    )
    cancel()
    suppressClick = true
    if (
      action &&
      (options.mask || !selectionActive()) &&
      !options.blocked?.(event)
    )
      options.swipe(action)
  }
  const trailingClick = (event: Event) => {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const listeners: [string, EventListener][] = [
    ['pointerdown', down as EventListener],
    ['pointermove', move as EventListener],
    ['pointerup', up as EventListener],
    ['click', trailingClick],
    ['pointercancel', cancel],
    ['wheel', cancel],
    ['scroll', cancel],
    ['contextmenu', cancel]
  ]
  for (const [type, fn] of listeners) doc.addEventListener(type, fn, true)
  return {
    consume(event: MouseEvent) {
      const current = press
      cancel()
      return current?.released &&
        event.button === 0 &&
        event.detail === 1 &&
        event.timeStamp - current.time < 500 &&
        (options.mask || !selectionActive()) &&
        !isInteractiveTap(event)
        ? readingTapZone(current.box, event.clientX, event.clientY)
        : null
    },
    dispose() {
      for (const [type, fn] of listeners)
        doc.removeEventListener(type, fn, true)
    }
  }
}
