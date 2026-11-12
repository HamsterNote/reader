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

export function isPageViewActivatable<T extends { readonly div: HTMLElement }>(
  pageView: T | null | undefined
): pageView is T {
  if (!pageView) return false
  const div = pageView.div
  if (!div.isConnected) return false
  return !hasHiddenAncestor(div)
}

/** Public navigation precondition: page is in the current visible set and its
 * view is attached with no display:none ancestor. */
export function canTargetPdfPage(
  viewer: ActivatableViewer | null | undefined,
  visiblePages: readonly number[],
  pageNumber: number
): boolean {
  if (!viewer || !visiblePages.includes(pageNumber)) return false
  return isPageViewActivatable(viewer.getPageView(pageNumber - 1))
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

/**
 * Waits until a page view is attached and visible. Used by internal document
 * restore, which may legitimately run before pagesinit/crop settles. Public
 * navigation keeps the immediate-reject contract instead.
 */
export function waitForPageActivation(
  isReady: () => boolean,
  options: {
    readonly timeoutMs: number
    readonly now?: () => number
    readonly schedule?: (callback: () => void) => void
    readonly signal?: AbortSignal
  }
): Promise<void> {
  const now = options.now ?? (() => Date.now())
  const schedule =
    options.schedule ??
    ((callback) => {
      if (typeof requestAnimationFrame === 'function')
        requestAnimationFrame(callback)
      else setTimeout(callback, 16)
    })
  const signal = options.signal
  const deadline = now() + options.timeoutMs
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener('abort', abort)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('PDF navigation superseded', 'AbortError')
      )
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    const poll = () => {
      if (signal?.aborted) return
      if (isReady()) {
        signal?.removeEventListener('abort', abort)
        resolve()
        return
      }
      if (now() >= deadline) {
        signal?.removeEventListener('abort', abort)
        reject(new Error('目标页面不可用，原位置已保留'))
        return
      }
      schedule(poll)
    }
    poll()
  })
}
