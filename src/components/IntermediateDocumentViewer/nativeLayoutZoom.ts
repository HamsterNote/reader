export type CenteredScrollPosition = Readonly<{
  left: number
  top: number
}>

export type ReaderLayoutZoom = 0.25 | 0.5 | 0.75 | 1 | 1.5 | 2 | 3 | 'fit-width'

export type NativeLayoutViewportMetrics = Readonly<{
  scrollLeft: number
  scrollTop: number
  clientWidth: number
  clientHeight: number
}>

export function resolveNativeLayoutTouchAction(
  touchPanMode: 'single-finger' | 'two-finger' | undefined,
  stylusOnly: boolean
): 'none' | 'pan-x pan-y' {
  return stylusOnly || touchPanMode !== 'two-finger'
    ? 'pan-x pan-y'
    : 'none'
}

/**
 * 缩放前先把视口中心换算为内容坐标，再用新缩放值还原滚动位置。
 * 这样页面中心处的内容在缩放前后会停留在相同的屏幕位置。
 */
export function computeCenteredScrollPosition(
  {
    scrollLeft,
    scrollTop,
    clientWidth,
    clientHeight
  }: NativeLayoutViewportMetrics,
  previousScale: number,
  nextScale: number
): CenteredScrollPosition {
  const contentCenterX = (scrollLeft + clientWidth / 2) / previousScale
  const contentCenterY = (scrollTop + clientHeight / 2) / previousScale

  return {
    left: Math.max(0, contentCenterX * nextScale - clientWidth / 2),
    top: Math.max(0, contentCenterY * nextScale - clientHeight / 2)
  }
}
