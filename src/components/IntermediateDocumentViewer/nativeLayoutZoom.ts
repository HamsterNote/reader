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

export type NativeLayoutIntrinsicSize = Readonly<{
  width: number
  height: number
}>

export function computeNativeLayoutTransformExtent(
  intrinsicSize: NativeLayoutIntrinsicSize,
  scale: number
): NativeLayoutIntrinsicSize {
  return {
    width: intrinsicSize.width * scale,
    height: intrinsicSize.height * scale
  }
}

export type NativeLayoutScaleStyle =
  | Readonly<{ zoom: number }>
  | Readonly<{ transform: string; transformOrigin: 'top left' }>

export function resolveNativeLayoutScaleStyle(
  scale: number,
  useTransform: boolean
): NativeLayoutScaleStyle {
  return useTransform
    ? { transform: `scale(${scale})`, transformOrigin: 'top left' }
    : { zoom: scale }
}

export function isIPadOS(
  navigatorData: Pick<Navigator, 'maxTouchPoints' | 'platform' | 'userAgent'>
): boolean {
  return (
    navigatorData.userAgent.includes('iPad') ||
    (navigatorData.platform === 'MacIntel' && navigatorData.maxTouchPoints > 1)
  )
}

export function resolveNativeLayoutTouchAction(
  touchPanMode: 'single-finger' | 'two-finger' | undefined,
  stylusOnly: boolean
): 'none' | 'pan-x pan-y' {
  if (stylusOnly || touchPanMode === 'two-finger') return 'none'
  return 'pan-x pan-y'
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
  nextScale: number,
  intrinsicSize?: NativeLayoutIntrinsicSize
): CenteredScrollPosition {
  const previousOffsetX = intrinsicSize
    ? Math.max(0, (clientWidth - intrinsicSize.width * previousScale) / 2)
    : 0
  const nextOffsetX = intrinsicSize
    ? Math.max(0, (clientWidth - intrinsicSize.width * nextScale) / 2)
    : 0
  const contentCenterX =
    (scrollLeft + clientWidth / 2 - previousOffsetX) / previousScale
  const contentCenterY = (scrollTop + clientHeight / 2) / previousScale

  return {
    left: Math.max(
      0,
      contentCenterX * nextScale + nextOffsetX - clientWidth / 2
    ),
    top: Math.max(0, contentCenterY * nextScale - clientHeight / 2)
  }
}
