export interface SafeAreaInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }

/** All inputs are in the outer document's CSS client coordinates. Insets
 * describe the layout viewport, never an offset relative to the reader. */
export function resolveVisibleMagnifierRect(
  root: DOMRectReadOnly,
  viewport: { width: number; height: number },
  insets: SafeAreaInsets = ZERO_INSETS,
  visible: DOMRectReadOnly = new DOMRect(0, 0, viewport.width, viewport.height)
): DOMRect {
  const left = Math.max(root.left, visible.left, insets.left)
  const top = Math.max(root.top, visible.top, insets.top)
  const right = Math.min(
    root.right,
    visible.right,
    viewport.width - insets.right
  )
  const bottom = Math.min(
    root.bottom,
    visible.bottom,
    viewport.height - insets.bottom
  )
  return new DOMRect(
    left,
    top,
    Math.max(0, right - left),
    Math.max(0, bottom - top)
  )
}

/** One probe per active text session, with no author-visible layout or input. */
export function createSafeAreaProbe(doc: Document) {
  const probe = doc.createElement('div')
  probe.dataset.magnifierSafeArea = 'true'
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;contain:strict;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);'
  doc.body.append(probe)
  return {
    read(): SafeAreaInsets {
      const style = doc.defaultView!.getComputedStyle(probe)
      const px = (value: string) => Math.max(0, parseFloat(value) || 0)
      return {
        top: px(style.paddingTop),
        right: px(style.paddingRight),
        bottom: px(style.paddingBottom),
        left: px(style.paddingLeft)
      }
    },
    dispose: () => probe.remove()
  }
}

/** Share layout reads within a frame; remeasure insets only on layout signals.
 * The active session owns every observer, frame and probe. */
export function observeMagnifierViewport(
  root: HTMLElement,
  onChange: () => void
) {
  const doc = root.ownerDocument
  const view = doc.defaultView!
  const probe = createSafeAreaProbe(doc)
  let insets: SafeAreaInsets | null = null
  let rect: DOMRect | null = null
  let cacheFrame: number | null = null
  let updateFrame: number | null = null
  let disposed = false
  const invalidate = () => {
    rect = null
    insets = null
    if (updateFrame !== null || disposed) return
    updateFrame = view.requestAnimationFrame(() => {
      updateFrame = null
      if (!disposed) onChange()
    })
  }
  const visual = view.visualViewport
  const observer = new view.ResizeObserver(invalidate)
  observer.observe(root)
  view.addEventListener('resize', invalidate)
  view.addEventListener('orientationchange', invalidate)
  doc.addEventListener('scroll', invalidate, true)
  visual?.addEventListener('resize', invalidate)
  visual?.addEventListener('scroll', invalidate)
  return {
    read(): DOMRect {
      if (rect) return rect
      insets ??= probe.read()
      rect = resolveVisibleMagnifierRect(
        root.getBoundingClientRect(),
        { width: view.innerWidth, height: view.innerHeight },
        insets,
        visual
          ? new DOMRect(
              visual.offsetLeft,
              visual.offsetTop,
              visual.width,
              visual.height
            )
          : undefined
      )
      if (cacheFrame === null)
        cacheFrame = view.requestAnimationFrame(() => {
          cacheFrame = null
          rect = null
        })
      return rect
    },
    dispose() {
      disposed = true
      observer.disconnect()
      view.removeEventListener('resize', invalidate)
      view.removeEventListener('orientationchange', invalidate)
      doc.removeEventListener('scroll', invalidate, true)
      visual?.removeEventListener('resize', invalidate)
      visual?.removeEventListener('scroll', invalidate)
      if (cacheFrame !== null) view.cancelAnimationFrame(cacheFrame)
      if (updateFrame !== null) view.cancelAnimationFrame(updateFrame)
      probe.dispose()
    }
  }
}
