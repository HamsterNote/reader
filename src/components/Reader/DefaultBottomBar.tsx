import {
  Button,
  Icon,
  Popover,
  PopoverSeparator
} from '@hamster-note/components'
import { type RefObject, useEffect } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import type {
  ReaderAnnotationHistoryStatus,
  ReaderSelectionRef
} from '../../types/selection'
import type { ReaderTouchPanMode } from '../IntermediateDocumentViewer'
import type { ReaderPageTool } from '../Page'
import type { ReaderRenderMode } from '../Reader'
import { DefaultBottomBarMenus } from './DefaultBottomBarMenus'
import { DefaultBottomBarModeControls } from './DefaultBottomBarModeControls'
import {
  DEFAULT_BOTTOM_BAR_COLORS,
  DEFAULT_BOTTOM_BAR_TOOLS,
  getFontScaleLabel,
  getTranslucentColor
} from './defaultBottomBarConfig'
import {
  useBottomBarMenus,
  usePrefersColorScheme,
  useWindowWidth
} from './useDefaultBottomBar'

export type DefaultBottomBarProps = {
  readonly bottomBarRef: RefObject<HTMLDivElement | null>
  readonly renderMode: ReaderRenderMode
  readonly ocrEnabled: boolean
  readonly fontScale: ReaderFontScale | undefined
  readonly touchPanMode: ReaderTouchPanMode
  readonly edgeCropEditing: boolean
  readonly selectedTool: ReaderPageTool
  readonly drawingStrokeColor: string
  readonly historyStatus: ReaderAnnotationHistoryStatus
  readonly selectionRef: RefObject<ReaderSelectionRef | null>
  readonly onRenderModeChange: (mode: ReaderRenderMode) => void
  readonly onOcrChange: (enabled: boolean) => void
  readonly onFontScaleChange: (scale: ReaderFontScale) => void
  readonly onTouchPanModeChange: (mode: ReaderTouchPanMode) => void
  readonly onEdgeCropEditingChange: (editing: boolean) => void
  readonly onSelectedToolChange: (tool: ReaderPageTool) => void
  readonly onDrawingStrokeColorChange: (color: string) => void
  readonly onHighlightColorChange: ((color: string) => void) | undefined
}

export function DefaultBottomBar(props: DefaultBottomBarProps) {
  const width = useWindowWidth()
  const theme = usePrefersColorScheme()
  const menus = useBottomBarMenus()
  const layoutDisabled = props.renderMode === 'text'

  // 在 Text Render Mode 下，自动切换工具到 text-selection
  useEffect(() => {
    if (layoutDisabled && props.selectedTool !== 'text-selection') {
      props.onSelectedToolChange('text-selection')
    }
  }, [layoutDisabled, props.selectedTool, props.onSelectedToolChange])

  // 在 Text Render Mode 下，只显示文字选择工具
  const visibleTools = layoutDisabled
    ? DEFAULT_BOTTOM_BAR_TOOLS.filter(({ tool }) => tool === 'text-selection')
    : DEFAULT_BOTTOM_BAR_TOOLS

  const toolButtons = visibleTools.map(({ tool, icon, label }) => (
    <Button
      key={tool}
      type='button'
      size='small'
      variant={props.selectedTool === tool ? 'primary' : 'ghost'}
      aria-pressed={props.selectedTool === tool}
      aria-label={`${label}工具`}
      data-testid={`tool-bottom-bar-${tool}`}
      onClick={() => props.onSelectedToolChange(tool)}
    >
      <Icon name={icon} />
      {width >= 1280 && label}
    </Button>
  ))

  return (
    <>
      <Popover
        ref={props.bottomBarRef}
        edge='bottom'
        edgeOffset={16}
        relative
        theme={theme}
        role='toolbar'
        aria-label='工具栏'
        data-testid='tool-bottom-bar'
        style={{
          boxSizing: 'border-box',
          maxWidth: 'calc(100% - 16px)',
          overflowX: 'auto',
          whiteSpace: 'nowrap'
        }}
      >
        <Button
          type='button'
          size='small'
          variant='ghost'
          disabled={!props.historyStatus.canUndo}
          aria-label='撤销'
          data-testid='tool-bottom-bar-undo'
          onClick={() => props.selectionRef.current?.undo()}
        >
          <Icon name='undo' />
        </Button>
        <Button
          type='button'
          size='small'
          variant='ghost'
          disabled={!props.historyStatus.canRedo}
          aria-label='恢复'
          data-testid='tool-bottom-bar-redo'
          onClick={() => props.selectionRef.current?.redo()}
        >
          <Icon name='redo' />
        </Button>
        <PopoverSeparator />
        <DefaultBottomBarModeControls
          renderMode={props.renderMode}
          ocrEnabled={props.ocrEnabled}
          onRenderModeChange={props.onRenderModeChange}
          onOcrChange={props.onOcrChange}
        />
        {!layoutDisabled && (
          <>
            <Button
              type='button'
              size='small'
              variant={
                props.touchPanMode === 'two-finger' ? 'primary' : 'ghost'
              }
              disabled={layoutDisabled}
              aria-label={
                props.touchPanMode === 'single-finger'
                  ? '切换到双指滑动模式'
                  : '切换到单指滑动模式'
              }
              aria-pressed={props.touchPanMode === 'two-finger'}
              data-testid='tool-bottom-bar-touch-pan-mode'
              onClick={() =>
                props.onTouchPanModeChange(
                  props.touchPanMode === 'single-finger'
                    ? 'two-finger'
                    : 'single-finger'
                )
              }
            >
              <Icon name='touch' />
            </Button>
            <Button
              type='button'
              size='small'
              variant={props.edgeCropEditing ? 'primary' : 'ghost'}
              disabled={layoutDisabled}
              aria-label='边缘裁切'
              aria-pressed={props.edgeCropEditing}
              data-testid='tool-bottom-bar-edge-crop'
              onClick={() =>
                props.onEdgeCropEditingChange(!props.edgeCropEditing)
              }
            >
              <Icon name='rectangle' />
            </Button>
            <PopoverSeparator />
          </>
        )}
        {width < 768 ? (
          <Button
            type='button'
            size='small'
            variant='primary'
            aria-label='工具菜单'
            aria-haspopup='menu'
            aria-expanded={menus.toolMenuAnchor !== null}
            aria-controls={menus.toolMenuId}
            data-testid='tool-bottom-bar-tool-menu'
            onClick={(event) => {
              const anchor = event.currentTarget
              menus.setFontMenuAnchor(null)
              menus.setToolMenuAnchor((current) =>
                current === null ? anchor : null
              )
            }}
          >
            <Icon
              name={
                visibleTools.find(({ tool }) => tool === props.selectedTool)
                  ?.icon ?? 'type'
              }
            />
          </Button>
        ) : (
          toolButtons
        )}
        {!layoutDisabled && (
          <>
            <PopoverSeparator />
            {DEFAULT_BOTTOM_BAR_COLORS.map(({ name, label, value }) => (
              <button
                key={name}
                type='button'
                className='hamster-reader__bottom-bar-color'
                aria-label={`${label}工具颜色`}
                aria-pressed={props.drawingStrokeColor === value}
                data-testid={`tool-bottom-bar-color-${name}`}
                onClick={() => {
                  props.onDrawingStrokeColorChange(value)
                  props.onHighlightColorChange?.(getTranslucentColor(value))
                }}
                style={{
                  backgroundColor: value,
                  borderColor:
                    props.drawingStrokeColor === value
                      ? 'currentColor'
                      : 'transparent'
                }}
              />
            ))}
          </>
        )}
        {props.fontScale !== undefined && (
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
              字体：{getFontScaleLabel(props.fontScale)}
            </Button>
          </>
        )}
      </Popover>
      <DefaultBottomBarMenus
        fontScale={props.fontScale}
        selectedTool={props.selectedTool}
        theme={theme}
        menus={menus}
        onFontScaleChange={props.onFontScaleChange}
        onSelectedToolChange={props.onSelectedToolChange}
      />
    </>
  )
}
