/**
 * Scrolls only when the target still belongs to the document and is not
 * `display: none`. Layout commits (page range/crop/hidden pages) and document
 * switches can otherwise call `scrollIntoView` on a page view that was just
 * hidden or belongs to the previous document; Chromium throws
 * "offsetParent is not set -- cannot scroll".
 */
export function scrollIntoViewIfAttached(
  element: Element | null | undefined,
  options?: ScrollIntoViewOptions
): boolean {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false
  const view = element.ownerDocument.defaultView
  if (view && view.getComputedStyle(element).display === 'none') return false
  try {
    element.scrollIntoView(options)
    return true
  } catch {
    // A hidden ancestor can still leave offsetParent unset; never surface a
    // layout error from an optional scroll.
    return false
  }
}
