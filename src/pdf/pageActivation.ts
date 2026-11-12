/**
 * PDF.js logs "offsetParent is not set -- cannot scroll" from inside
 * `currentPageNumber`/`scrollPageIntoView`. Guard before touching either API:
 * a page view may be detached (previous document) or inside a display:none
 * subtree (hidden/cropped-out page).
 */
export function hasHiddenAncestor(element: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node) {
    const view = node.ownerDocument.defaultView
    if (view && view.getComputedStyle(node).display === 'none') return true
    node = node.parentElement
  }
  return false
}

export function isPageViewActivatable(
  pageView: { readonly div: HTMLElement } | null | undefined
): pageView is { readonly div: HTMLElement } {
  if (!pageView) return false
  const div = pageView.div
  if (!div.isConnected) return false
  return !hasHiddenAncestor(div)
}

type ActivatableViewer = {
  currentPageNumber: number
  getPageView(index: number): { readonly div: HTMLElement } | undefined
}

/** Returns false without touching the setter when the page cannot be shown. */
export function activatePageIfReady(
  viewer: ActivatableViewer,
  pageNumber: number
): boolean {
  if (!isPageViewActivatable(viewer.getPageView(pageNumber - 1))) return false
  if (viewer.currentPageNumber !== pageNumber)
    viewer.currentPageNumber = pageNumber
  return true
}
