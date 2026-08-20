import {
  Icon,
  Menu,
  MenuItem,
  MenuLabel,
  Popover
} from '@hamster-note/components'

import type { ReaderFontScale } from '../../types/fontScale'
import type { ReaderLineHeight } from '../../types/lineHeight'
import type { ReaderPageTool } from '../Page'
import {
  DEFAULT_BOTTOM_BAR_TOOLS,
  DEFAULT_FONT_SCALE_OPTIONS,
  DEFAULT_LINE_HEIGHT_OPTIONS,
  DEFAULT_LAYOUT_ZOOM_OPTIONS,
  type ReaderLayoutZoom
} from './defaultBottomBarConfig'
import type {
  useBottomBarMenus,
  usePrefersColorScheme
} from './useDefaultBottomBar'

type DefaultBottomBarMenusProps = {
  readonly fontScale: ReaderFontScale | undefined
  readonly lineHeight: ReaderLineHeight | undefined
  readonly selectedTool: ReaderPageTool
  readonly layoutZoom: ReaderLayoutZoom | undefined
  readonly theme: ReturnType<typeof usePrefersColorScheme>
  readonly menus: ReturnType<typeof useBottomBarMenus>
  readonly onFontScaleChange: (scale: ReaderFontScale) => void
  readonly onLineHeightChange: (lineHeight: ReaderLineHeight) => void
  readonly onSelectedToolChange: (tool: ReaderPageTool) => void
  readonly onLayoutZoomChange: (zoom: ReaderLayoutZoom) => void
}

const selectedItemStyle = {
  backgroundColor:
    'color-mix(in srgb, var(--hn-color-accent) 14%, transparent)',
  color: 'var(--hn-color-accent)'
}

const selectedFontItemStyle = {
  backgroundColor:
    'color-mix(in srgb, var(--hn-color-accent) 24%, transparent)',
  color: 'var(--hn-color-text)'
}

export function DefaultBottomBarMenus({
  fontScale,
  lineHeight,
  selectedTool,
  layoutZoom,
  theme,
  menus,
  onFontScaleChange,
  onLineHeightChange,
  onSelectedToolChange,
  onLayoutZoomChange
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
                    className='hamster-reader__font-menu-check'
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
            className='hamster-reader__font-menu'
          >
            <MenuLabel className='hamster-reader__font-menu-heading'>
              字号
            </MenuLabel>
            {DEFAULT_FONT_SCALE_OPTIONS.map(({ label, scale }) => {
              const selected = fontScale === scale
              return (
                <MenuItem
                  key={label}
                  aria-pressed={selected}
                  aria-label={label}
                  data-selected={selected}
                  style={selected ? selectedFontItemStyle : undefined}
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
            {lineHeight !== undefined && (
              <MenuLabel className='hamster-reader__font-menu-heading'>
                行间距
              </MenuLabel>
            )}
            {lineHeight !== undefined &&
              DEFAULT_LINE_HEIGHT_OPTIONS.map((option) => {
                const selected = lineHeight === option
                return (
                  <MenuItem
                    key={`line-height-${option}`}
                    aria-pressed={selected}
                    aria-label={`行距 ${option}`}
                    data-selected={selected}
                    style={selected ? selectedFontItemStyle : undefined}
                    onClick={() => {
                      onLineHeightChange(option)
                      menus.closeMenusAndRestoreFocus()
                    }}
                  >
                    <span
                      aria-hidden='true'
                      className='hamster-reader__font-menu-check'
                      style={{ visibility: selected ? 'visible' : 'hidden' }}
                    >
                      <Icon name='check' />
                    </span>
                    {option}
                  </MenuItem>
                )
              })}
          </Menu>
        </Popover>
      )}
      {layoutZoom !== undefined && menus.zoomMenuAnchor !== null && (
        <Popover
          anchor={menus.zoomMenuAnchor}
          placement='top-start'
          theme={theme}
          data-testid='tool-bottom-bar-layout-zoom-popover'
        >
          <Menu
            id={menus.zoomMenuId}
            ref={menus.zoomMenuRef}
            aria-label='缩放菜单'
          >
            {DEFAULT_LAYOUT_ZOOM_OPTIONS.map(({ label, zoom }) => {
              const selected = layoutZoom === zoom
              return (
                <MenuItem
                  key={label}
                  aria-pressed={selected}
                  aria-label={label}
                  data-selected={selected}
                  style={selected ? selectedItemStyle : undefined}
                  onClick={() => {
                    onLayoutZoomChange(zoom)
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
