import { useLayoutEffect, useState, type RefObject } from 'react'

/** The Reader margin already contains its measured toolbar inset. Merge by max,
 * never add that occupied region again. Ignore transient zero-size layouts. */
export function useReadingViewport({
  root,
  controlsRef,
  enabled,
  bottomInset = 0,
  topInset = 0,
  horizontalInset = 0
}: {
  root: HTMLElement | null
  controlsRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  bottomInset?: number
  topInset?: number
  horizontalInset?: number
}) {
  const [size, setSize] = useState({
    width: 0,
    height: 0,
    bottomInset: 0,
    available: false
  })
  useLayoutEffect(() => {
    if (!enabled || !root) return
    let frame = 0
    const measure = () => {
      const box = root.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) {
        setSize((current) =>
          current.available ? { ...current, available: false } : current
        )
        return
      }
      const controls = controlsRef.current?.getBoundingClientRect()
      const inset =
        Math.max(
          bottomInset,
          controls?.height ? box.bottom - controls.top : 0
        ) + 8
      const next = {
        width: Math.max(0, box.width - horizontalInset * 2),
        height: Math.max(0, box.height - topInset - inset),
        bottomInset: inset,
        available: true
      }
      if (next.width <= 0 || next.height <= 0) {
        setSize((current) =>
          current.available ? { ...current, available: false } : current
        )
        return
      }
      setSize((current) =>
        current.available &&
        current.width === next.width &&
        current.height === next.height &&
        current.bottomInset === next.bottomInset
          ? current
          : next
      )
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(root)
    if (controlsRef.current) observer.observe(controlsRef.current)
    measure()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [root, enabled, bottomInset, topInset, horizontalInset, controlsRef])
  return {
    ...size,
    layoutWidth: size.available ? size.width : 0,
    layoutHeight: size.available ? size.height : 0
  }
}
