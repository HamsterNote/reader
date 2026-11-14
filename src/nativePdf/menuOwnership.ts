export type NativeMenuOwner = 'native' | 'web' | null
export type NativeMenuValue = { left: number; top: number } | null
export type NativeMenuState = { owner: NativeMenuOwner; value: NativeMenuValue }

export function shouldPreserveNativeWebMenu(
  owner: NativeMenuOwner,
  eventType: 'geometry' | 'cancelled'
): boolean {
  return owner === 'native' && (eventType === 'geometry' || eventType === 'cancelled')
}

export function reduceNativeMenu(
  state: NativeMenuState,
  update: { source: string; value: NativeMenuValue }
): { state: NativeMenuState; ignored: boolean } {
  const webUpdate = update.source === 'web-menu' || update.source === 'web-hide-menu'
  if (webUpdate && state.owner === 'native') return { state, ignored: true }
  if (update.source === 'native-geometry' && update.value === null && state.owner === 'native')
    return { state, ignored: true }
  if (update.source === 'native-selection-consumed' && state.owner === 'native')
    return { state: { owner: null, value: update.value }, ignored: false }
  const owner =
    update.source === 'native-selection-end'
      ? 'native'
      : update.source === 'web-menu' || update.source === 'web-panel'
        ? 'web'
        : update.source === 'close' || update.source === 'app-state'
          ? null
          : state.owner
  return { state: { owner, value: update.value }, ignored: false }
}
