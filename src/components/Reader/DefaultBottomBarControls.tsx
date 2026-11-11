import {
  Button,
  Icon,
  type IconName,
  Popover,
  PopoverSeparator
} from '@hamster-note/components'
import type {
  LayeredEditorTool,
  LayeredToolsSnapshot
} from '@hamster-note/painting/core'
import type { RefObject } from 'react'

import type {
  ReaderAnnotationHistoryStatus,
  ReaderSelectionRef
} from '../../types/selection'
import type {
  ReaderColorOption,
  ReaderPageTool,
  ReaderRenderMode
} from '../../types/readerOptions'
import {
  DEFAULT_BOTTOM_BAR_COLORS,
  getTranslucentColor,
  type DEFAULT_BOTTOM_BAR_TOOLS
} from './defaultBottomBarConfig'

type BottomBarHistoryControlsProps = {
  readonly historyStatus: ReaderAnnotationHistoryStatus
  readonly selectionRef: RefObject<ReaderSelectionRef | null>
}

export function BottomBarHistoryControls(props: BottomBarHistoryControlsProps) {
  return (
    <>
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
    </>
  )
}

type BottomBarToolButtonsProps = {
  readonly tools: typeof DEFAULT_BOTTOM_BAR_TOOLS
  readonly selectedTool: ReaderPageTool
  readonly showLabels: boolean
  readonly onSelectedToolChange: (tool: ReaderPageTool) => void
}

export function BottomBarToolButtons(props: BottomBarToolButtonsProps) {
  return props.tools.map(({ tool, icon, label }) => (
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
      {props.showLabels && label}
    </Button>
  ))
}

const DRAWING_TOOLS: readonly {
  readonly tool: LayeredEditorTool
  readonly icon: IconName
  readonly label: string
}[] = [
  { tool: 'freehand', icon: 'pen', label: '自由笔' },
  { tool: 'line', icon: 'line', label: '直线' },
  { tool: 'rect', icon: 'rectangle', label: '矩形' },
  { tool: 'ellipse', icon: 'ellipse', label: '椭圆' },
  { tool: 'polygon', icon: 'polygon', label: '多边形' },
  { tool: 'bezier', icon: 'curve', label: '贝塞尔' },
  { tool: 'text', icon: 'type', label: '文字' },
  { tool: 'image', icon: 'image', label: '图片' },
  { tool: 'selection', icon: 'mouse', label: '选择' },
  { tool: 'lasso', icon: 'lasso', label: '套索' },
  { tool: 'eraser', icon: 'eraser', label: '橡皮擦' }
]

type DrawingBottomBarControlsProps = {
  readonly paintingSettings: LayeredToolsSnapshot
  readonly colors: readonly ReaderColorOption[]
  readonly theme: 'light' | 'dark'
  readonly onPaintingSettingsChange: (data: LayeredToolsSnapshot) => void
}

export function DrawingBottomBarControls(props: DrawingBottomBarControlsProps) {
  const paintingColor =
    props.paintingSettings.activeTool === 'freehand'
      ? props.paintingSettings.settings.freehand.color
      : props.paintingSettings.settings.shape.color

  return (
    <Popover
      relative
      style={{
        position: 'static',
        transform: 'none',
        maxWidth: 'calc(100% - 32px)',
        overflowX: 'auto',
        pointerEvents: 'auto'
      }}
      theme={props.theme}
      role='toolbar'
      aria-label='绘图工具'
      className='hamster-reader__drawing-toolbar'
    >
      {DRAWING_TOOLS.map(({ tool, icon, label }) => (
        <Button
          key={tool}
          type='button'
          size='small'
          variant={
            props.paintingSettings.activeTool === tool ? 'primary' : 'ghost'
          }
          aria-label={label}
          aria-pressed={props.paintingSettings.activeTool === tool}
          onClick={() =>
            props.onPaintingSettingsChange({
              ...props.paintingSettings,
              activeTool: tool
            })
          }
        >
          <Icon name={icon} />
        </Button>
      ))}
      <PopoverSeparator />
      <BottomBarColorControls
        colors={props.colors ?? DEFAULT_BOTTOM_BAR_COLORS}
        renderMode='drawing'
        drawingStrokeColor={paintingColor}
        highlightColor={undefined}
        onDrawingStrokeColorChange={(color) =>
          props.onPaintingSettingsChange({
            ...props.paintingSettings,
            settings: {
              freehand: {
                ...props.paintingSettings.settings.freehand,
                color
              },
              shape: { ...props.paintingSettings.settings.shape, color }
            }
          })
        }
        colorAriaLabel={(name) => `绘图${name}颜色`}
        onHighlightColorChange={undefined}
      />
      <PopoverSeparator />
      <label className='hamster-reader__drawing-stroke-width'>
        笔宽
        <input
          type='number'
          aria-label='绘图笔宽'
          min={0.5}
          max={200}
          step={0.5}
          value={
            props.paintingSettings.activeTool === 'freehand'
              ? props.paintingSettings.settings.freehand.nominalSize
              : props.paintingSettings.settings.shape.width
          }
          onChange={(event) => {
            const width = event.target.valueAsNumber
            if (!Number.isFinite(width) || width <= 0) return
            props.onPaintingSettingsChange({
              ...props.paintingSettings,
              settings: {
                freehand: {
                  ...props.paintingSettings.settings.freehand,
                  nominalSize: width
                },
                shape: { ...props.paintingSettings.settings.shape, width }
              }
            })
          }}
        />
      </label>
    </Popover>
  )
}

type BottomBarColorControlsProps = {
  readonly colors: readonly ReaderColorOption[]
  readonly renderMode: ReaderRenderMode | 'drawing'
  readonly drawingStrokeColor: string
  readonly highlightColor: string | undefined
  readonly colorAriaLabel?: (name: string) => string
  readonly onDrawingStrokeColorChange: (color: string) => void
  readonly onHighlightColorChange: ((color: string) => void) | undefined
}

export function BottomBarColorControls(props: BottomBarColorControlsProps) {
  return props.colors.map(({ name, color }) => {
    const highlightColor = getTranslucentColor(color)
    const isSelected =
      props.renderMode === 'text'
        ? props.highlightColor === highlightColor
        : props.drawingStrokeColor === color

    return (
      <button
        key={name}
        type='button'
        className='hamster-reader__bottom-bar-color'
        aria-label={props.colorAriaLabel?.(name) ?? `${name}工具颜色`}
        aria-pressed={isSelected}
        data-testid={`tool-bottom-bar-color-${name}`}
        onClick={() => {
          if (props.renderMode === 'drawing') {
            props.onDrawingStrokeColorChange(color)
            return
          }
          if (props.renderMode === 'text') {
            props.onHighlightColorChange?.(highlightColor)
            return
          }
          props.onDrawingStrokeColorChange(color)
          props.onHighlightColorChange?.(highlightColor)
        }}
        style={{
          backgroundColor: color,
          borderColor: isSelected ? 'currentColor' : 'transparent'
        }}
      />
    )
  })
}
