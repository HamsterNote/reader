import { Button } from '@hamster-note/components'

import type { useBottomBarMenus } from './useDefaultBottomBar'

type DefaultBottomBarZoomControlProps = {
  readonly resolvedScale: number
  readonly menus: ReturnType<typeof useBottomBarMenus>
}

export function DefaultBottomBarZoomControl({
  resolvedScale,
  menus
}: DefaultBottomBarZoomControlProps) {
  return (
    <Button
      type='button'
      size='small'
      variant='ghost'
      aria-label='缩放'
      aria-haspopup='menu'
      aria-expanded={menus.zoomMenuAnchor !== null}
      aria-controls={menus.zoomMenuId}
      data-testid='tool-bottom-bar-layout-zoom'
      onClick={(event) => {
        const anchor = event.currentTarget
        menus.setToolMenuAnchor(null)
        menus.setFontMenuAnchor(null)
        menus.setZoomMenuAnchor((current) => (current === null ? anchor : null))
      }}
    >
      {Math.round(resolvedScale * 100)}%
    </Button>
  )
}
