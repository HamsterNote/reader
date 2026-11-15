/** PDF.js scrollIntoView requires an attached layout box, not just pagesloaded. */
export function isPdfLayoutReady(
  container: HTMLElement | null | undefined,
  page: HTMLElement | null | undefined
) {
  return [container, page].every((element) => {
    if (!element?.isConnected || element.offsetParent === null) return false
    const box = element.getBoundingClientRect()
    return (
      element.clientWidth > 0 &&
      element.clientHeight > 0 &&
      box.width > 0 &&
      box.height > 0
    )
  })
}
/**
 * ResizeObserver wakes a pending restore when display:none/zero dimensions end.
 * rAF rechecks the actual target after layout; it is not a fixed delay. The
 * navigation owns the 10s deadline and calls the returned cleanup on every exit.
 */
export function observePdfLayout(
  container: HTMLElement,
  getPage: () => HTMLElement | undefined,
  onReady: () => void
) {
  let frame = 0
  let stopped = false
  let page: HTMLElement | undefined
  const schedule = () => {
    if (!stopped && !frame) frame = requestAnimationFrame(check)
  }
  const observer = new ResizeObserver(schedule)
  const check = () => {
    frame = 0
    if (stopped) return
    const next = getPage()
    if (next !== page) {
      if (page) observer.unobserve(page)
      page = next
      if (page) observer.observe(page)
    }
    if (isPdfLayoutReady(container, page)) onReady()
  }
  observer.observe(container)
  // The viewer's extent changes when PDF.js attaches page shells.
  if (container.firstElementChild) observer.observe(container.firstElementChild)
  schedule()
  return () => {
    stopped = true
    observer.disconnect()
    cancelAnimationFrame(frame)
    frame = 0
  }
}
