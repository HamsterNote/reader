import { type RefObject, useEffect, useState } from 'react'

type BottomBarInsetElements = {
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly bottomBarRef: RefObject<HTMLDivElement | null>
  readonly layoutKey?: string
  readonly edge?: 'top' | 'bottom'
  readonly enabled: boolean
}

/**
 * 测量 Reader 内置底栏实际遮挡的底部区域。
 *
 * 使用底栏顶部到 Reader 底部的距离，而非固定高度，因此会自然包含底栏自身高度、
 * 定位偏移和响应式尺寸变化。自定义底栏不属于 Reader 的布局契约，由宿主自行管理。
 */
export function useBottomBarInset({
  rootRef,
  bottomBarRef,
  enabled,
  layoutKey,
  edge = 'bottom'
}: BottomBarInsetElements): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setInset(0)
      return
    }

    const root = rootRef.current
    const bottomBar = bottomBarRef.current
    if (!root || !bottomBar) {
      setInset(0)
      return
    }

    const measure = () => {
      const rootBox = root.getBoundingClientRect()
      const barBox = bottomBar.getBoundingClientRect()
      const obstruction =
        edge === 'top'
          ? barBox.bottom - rootBox.top
          : rootBox.bottom - barBox.top
      const nextInset =
        barBox.height > 0 && rootBox.height > 0
          ? Math.max(0, Math.min(rootBox.height, obstruction))
          : 0
      setInset((currentInset) =>
        currentInset === nextInset ? currentInset : nextInset
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(bottomBar)
    bottomBar
      .querySelectorAll('[role="toolbar"]')
      .forEach((toolbar) => observer.observe(toolbar))
    measure()

    return () => observer.disconnect()
  }, [bottomBarRef, enabled, rootRef, layoutKey, edge])

  return inset
}
