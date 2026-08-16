import {
  Button,
  Icon,
  Popover,
  PopoverSeparator
} from '@hamster-note/components'
import type { PaintingControllerData } from '@hamster-note/painting'
import { type RefObject, useEffect } from 'react'

import type { ReaderFontScale } from '../../types/fontScale'
import type {
  ReaderColorOption,
  ReaderPageTool,
  ReaderRenderMode
} from '../../types/readerOptions'
import type {
  ReaderAnnotationHistoryStatus,
  ReaderSelectionRef
} from '../../types/selection'
import type { ReaderTouchPanMode } from '../IntermediateDocumentViewer'
import {
  BottomBarColorControls,
  BottomBarHistoryControls,
  BottomBarToolButtons,
  DrawingBottomBarStack
} from './DefaultBottomBarControls'
import { DefaultBottomBarFontScaleControl } from './DefaultBottomBarFontScaleControl'
import { DefaultBottomBarMenus } from './DefaultBottomBarMenus'
import { DefaultBottomBarModeControls } from './DefaultBottomBarModeControls'
import { DefaultBottomBarZoomControl } from './DefaultBottomBarZoomControl'
import {
  DEFAULT_BOTTOM_BAR_TOOLS,
  type ReaderLayoutZoom
} from './defaultBottomBarConfig'
import {
  useBottomBarMenus,
  usePrefersColorScheme,
  useWindowWidth
} from './useDefaultBottomBar'

export type DefaultBottomBarProps = {
  readonly bottomBarRef: RefObject<HTMLDivElement | null>
  readonly renderMode: ReaderRenderMode
  readonly isEpub: boolean | undefined
  readonly ocrEnabled: boolean
  readonly fontScale: ReaderFontScale | undefined
  readonly layoutZoom: ReaderLayoutZoom | undefined
  readonly resolvedLayoutScale: number
  readonly touchPanMode: ReaderTouchPanMode
  readonly edgeCropEditing: boolean
  readonly selectedTool: ReaderPageTool
  readonly colors: readonly ReaderColorOption[]
  readonly drawingStrokeColor: string
  readonly highlightColor: string | undefined
  readonly paintingControllerData: PaintingControllerData
  readonly historyStatus: ReaderAnnotationHistoryStatus
  readonly selectionRef: RefObject<ReaderSelectionRef | null>
  readonly onRenderModeChange: (mode: ReaderRenderMode) => void
  readonly onOcrChange: (enabled: boolean) => void
  readonly onFontScaleChange: (scale: ReaderFontScale) => void
  readonly onLayoutZoomChange: (zoom: ReaderLayoutZoom) => void
  readonly onTouchPanModeChange: (mode: ReaderTouchPanMode) => void
  readonly onEdgeCropEditingChange: (editing: boolean) => void
  readonly onSelectedToolChange: (tool: ReaderPageTool) => void
  readonly onDrawingStrokeColorChange: (color: string) => void
  readonly onPaintingControllerDataChange: (
    data: PaintingControllerData
  ) => void
  readonly onHighlightColorChange: ((color: string) => void) | undefined
}

export function DefaultBottomBar(props: DefaultBottomBarProps) {
  const width = useWindowWidth()
  const theme = usePrefersColorScheme()
  const menus = useBottomBarMenus()
  const layoutDisabled = props.renderMode === 'text'
  const visibleFontScale =
    props.renderMode === 'text' || props.isEpub ? props.fontScale : undefined

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

  const readerToolbar = (
    <Popover
      ref={props.selectedTool === 'drawing' ? undefined : props.bottomBarRef}
      edge='bottom'
      edgeOffset={32}
      relative
      theme={theme}
      role='toolbar'
      aria-label='工具栏'
      data-testid='tool-bottom-bar'
      style={{
        boxSizing: 'border-box',
        flexWrap: width < 768 ? 'wrap' : 'nowrap',
        justifyContent: width < 768 ? 'center' : undefined,
        maxWidth: 'calc(100% - 16px)',
        overflowX: width < 768 ? 'hidden' : 'auto',
        whiteSpace: width < 768 ? 'normal' : 'nowrap'
      }}
    >
      <BottomBarHistoryControls
        historyStatus={props.historyStatus}
        selectionRef={props.selectionRef}
      />
      <DefaultBottomBarFontScaleControl
        fontScale={visibleFontScale}
        menus={menus}
      />
      <PopoverSeparator />
      {props.layoutZoom !== undefined && (
        <>
          <DefaultBottomBarZoomControl
            resolvedScale={props.resolvedLayoutScale}
            menus={menus}
          />
          <PopoverSeparator />
        </>
      )}
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
            variant={props.touchPanMode === 'two-finger' ? 'primary' : 'ghost'}
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
      {width < 768 && !layoutDisabled && !props.edgeCropEditing && (
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
      )}
      {width >= 768 && (
        <BottomBarToolButtons
          tools={visibleTools}
          selectedTool={props.selectedTool}
          showLabels={width >= 1280}
          onSelectedToolChange={props.onSelectedToolChange}
        />
      )}
      {(width >= 768 || !props.edgeCropEditing) && (
        <>
          <PopoverSeparator />
          <BottomBarColorControls
            colors={props.colors}
            renderMode={props.renderMode}
            drawingStrokeColor={props.drawingStrokeColor}
            highlightColor={props.highlightColor}
            onDrawingStrokeColorChange={props.onDrawingStrokeColorChange}
            onHighlightColorChange={props.onHighlightColorChange}
          />
        </>
      )}
    </Popover>
  )

  return (
    <>
      {props.selectedTool === 'drawing' ? (
        <DrawingBottomBarStack
          bottomBarRef={props.bottomBarRef}
          readerToolbar={readerToolbar}
          paintingControllerData={props.paintingControllerData}
          theme={theme}
          onPaintingControllerDataChange={props.onPaintingControllerDataChange}
        />
      ) : (
        <div className='hamster-reader__bottom-bar-stack'>{readerToolbar}</div>
      )}
      <DefaultBottomBarMenus
        fontScale={visibleFontScale}
        layoutZoom={props.layoutZoom}
        selectedTool={props.selectedTool}
        theme={theme}
        menus={menus}
        onFontScaleChange={props.onFontScaleChange}
        onLayoutZoomChange={props.onLayoutZoomChange}
        onSelectedToolChange={props.onSelectedToolChange}
      />
    </>
  )
}
