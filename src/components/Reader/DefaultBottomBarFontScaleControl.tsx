import { Button, PopoverSeparator } from '@hamster-note/components'

import type { ReaderFontScale } from '../../types/fontScale'
import { getFontScaleLabel } from './defaultBottomBarConfig'
import type { useBottomBarMenus } from './useDefaultBottomBar'

type DefaultBottomBarFontScaleControlProps = {
  readonly fontScale: ReaderFontScale | undefined
  readonly menus: ReturnType<typeof useBottomBarMenus>
}

export function DefaultBottomBarFontScaleControl({
  fontScale,
  menus
}: DefaultBottomBarFontScaleControlProps) {
  if (fontScale === undefined) return null

  return (
    <>
      <PopoverSeparator />
      <Button
        type='button'
        size='small'
        variant='ghost'
        aria-haspopup='menu'
        aria-expanded={menus.fontMenuAnchor !== null}
        aria-controls={menus.fontMenuId}
        data-testid='tool-bottom-bar-font-scale'
        onClick={(event) => {
          const anchor = event.currentTarget
          menus.setToolMenuAnchor(null)
          menus.setFontMenuAnchor((current) =>
            current === null ? anchor : null
          )
        }}
      >
        字体：{getFontScaleLabel(fontScale)}
      </Button>
    </>
  )
}
