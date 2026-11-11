/** Compatibility viewers have no PDF pagination controller. Wait for loaded
 * visible pages, restored locators, fonts and stable geometry before ready. */
export function createFlowTextReadiness(
  root: HTMLElement,
  state: () => {
    loaded: boolean
    restoring: boolean
    error?: Error
    layoutKey?: string
  }
) {
  const view = root.ownerDocument.defaultView!
  const pending = new Set<(error: Error) => void>()
  let disposed = false
  return {
    waitForStable(): Promise<void> {
      if (disposed)
        return Promise.reject(new Error('Text document was disposed'))
      return new Promise((resolve, reject) => {
        let frame = 0
        let measured: string | null = null
        const finish = (error?: Error) => {
          view.cancelAnimationFrame(frame)
          pending.delete(cancel)
          if (error) reject(error)
          else resolve()
        }
        const cancel = (error: Error) => finish(error)
        pending.add(cancel)
        const measure = () => {
          if (disposed) return
          const current = state()
          if (current.error) {
            finish(current.error)
            return
          }
          const visible =
            root.isConnected && root.clientWidth > 0 && root.clientHeight > 0
          if (current.loaded && !current.restoring && visible) {
            // Validate the settled DOM again after the browser has laid it out.
            const geometry = `${root.clientWidth}:${root.clientHeight}:${root.scrollTop}:${current.layoutKey ?? ''}`
            if (measured === geometry) {
              finish()
              return
            }
            measured = geometry
          } else measured = null
          frame = view.requestAnimationFrame(measure)
        }
        Promise.resolve(root.ownerDocument.fonts?.ready).then(
          () => {
            if (!disposed) frame = view.requestAnimationFrame(measure)
          },
          (reason) =>
            finish(reason instanceof Error ? reason : new Error(String(reason)))
        )
      })
    },
    dispose() {
      disposed = true
      for (const cancel of [...pending])
        cancel(new Error('Text document was disposed'))
    }
  }
}

/** A final loaded page can be restored even when the browser cannot align its
 * start with the viewport: scrollTop has reached its actual maximum. */
export function isClampedFlowTargetVisible(
  root: HTMLElement,
  page: number
): boolean {
  if (
    Math.abs(
      root.scrollTop - Math.max(0, root.scrollHeight - root.clientHeight)
    ) > 1
  )
    return false
  const target = root.querySelector<HTMLElement>(
    `[data-page-number="${page}"][data-page-measurable="true"]`
  )
  if (!target) return false
  const viewport = root.getBoundingClientRect()
  const bounds = target.getBoundingClientRect()
  return (
    bounds.height > 0 &&
    bounds.top >= viewport.top &&
    bounds.top < viewport.bottom &&
    bounds.bottom <= viewport.bottom + 1
  )
}
