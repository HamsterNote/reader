import { Icon, Menu, MenuItem, Popover } from '@hamster-note/components'

import type { ReaderFontScale } from '../../types/fontScale'
import type { ReaderPageTool } from '../Page'
import {
  DEFAULT_BOTTOM_BAR_TOOLS,
  DEFAULT_FONT_SCALE_OPTIONS
} from './defaultBottomBarConfig'
import type {
  useBottomBarMenus,
  usePrefersColorScheme
} from './useDefaultBottomBar'

type DefaultBottomBarMenusProps = {
  readonly fontScale: ReaderFontScale | undefined
  readonly selectedTool: ReaderPageTool
  readonly theme: ReturnType<typeof usePrefersColorScheme>
  readonly menus: ReturnType<typeof useBottomBarMenus>
  readonly onFontScaleChange: (scale: ReaderFontScale) => void
  readonly onSelectedToolChange: (tool: ReaderPageTool) => void
}

const selectedItemStyle = {
  backgroundColor:
    'color-mix(in srgb, var(--hn-color-accent) 14%, transparent)',
  color: 'var(--hn-color-accent)'
}

export function DefaultBottomBarMenus({
  fontScale,
  selectedTool,
  theme,
  menus,
  onFontScaleChange,
  onSelectedToolChange
}: DefaultBottomBarMenusProps) {
  return (
    <>
      {menus.toolMenuAnchor !== null && (
        <Popover
          anchor={menus.toolMenuAnchor}
          placement='top-start'
          theme={theme}
          data-testid='tool-bottom-bar-tool-menu-popover'
        >
          <Menu
            id={menus.toolMenuId}
            ref={menus.toolMenuRef}
            aria-label='选择工具'
          >
            {DEFAULT_BOTTOM_BAR_TOOLS.map(({ tool, icon, label }) => {
              const selected = selectedTool === tool
              return (
                <MenuItem
                  key={tool}
                  aria-pressed={selected}
                  aria-label={`${label}工具`}
                  data-selected={selected}
                  data-testid={`tool-bottom-bar-${tool}`}
                  style={selected ? selectedItemStyle : undefined}
                  onClick={() => {
                    onSelectedToolChange(tool)
                    menus.closeMenusAndRestoreFocus()
                  }}
                >
                  <span
                    aria-hidden='true'
                    style={{ visibility: selected ? 'visible' : 'hidden' }}
                  >
                    <Icon name='check' />
                  </span>
                  <Icon name={icon} />
                  {label}
                </MenuItem>
              )
            })}
          </Menu>
        </Popover>
      )}
      {fontScale !== undefined && menus.fontMenuAnchor !== null && (
        <Popover
          anchor={menus.fontMenuAnchor}
          placement='top-start'
          theme={theme}
          data-testid='tool-bottom-bar-font-scale-popover'
        >
          <Menu
            id={menus.fontMenuId}
            ref={menus.fontMenuRef}
            aria-label='字号菜单'
          >
            {DEFAULT_FONT_SCALE_OPTIONS.map(({ label, scale }) => {
              const selected = fontScale === scale
              return (
                <MenuItem
                  key={label}
                  aria-pressed={selected}
                  aria-label={label}
                  data-selected={selected}
                  style={selected ? selectedItemStyle : undefined}
                  onClick={() => {
                    onFontScaleChange(scale)
                    menus.closeMenusAndRestoreFocus()
                  }}
                >
                  <span
                    aria-hidden='true'
                    style={{ visibility: selected ? 'visible' : 'hidden' }}
                  >
                    <Icon name='check' />
                  </span>
                  {label}
                </MenuItem>
              )
            })}
          </Menu>
        </Popover>
      )}
    </>
  )
}
