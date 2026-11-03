/** Restrict publication scrolling without consuming selection or tool pointers. */
export function buttonOnlyInput(
  target: Document | HTMLElement,
  shouldBlock: (event: Event) => boolean = () => true
) {
  const prevent = (event: Event) => {
    if (shouldBlock(event)) event.preventDefault()
  }
  const keydown = (event: Event) => {
    if (!shouldBlock(event)) return
    const key = event as KeyboardEvent
    const element = key.target as Element | null
    if (
      element?.closest?.(
        'button, input, textarea, select, [contenteditable="true"], [role="slider"]'
      )
    )
      return
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        ' ',
        'PageUp',
        'PageDown',
        'Home',
        'End'
      ].includes(key.key)
    )
      key.preventDefault()
  }
  target.addEventListener('wheel', prevent, { passive: false })
  target.addEventListener('touchmove', prevent, { passive: false })
  target.addEventListener('keydown', keydown)
  return () => {
    target.removeEventListener('wheel', prevent)
    target.removeEventListener('touchmove', prevent)
    target.removeEventListener('keydown', keydown)
  }
}
