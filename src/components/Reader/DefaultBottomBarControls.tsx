import { Button, Icon } from '@hamster-note/components'
import type {
  LayeredEditorTool,
  LayeredToolsSnapshot
} from '@hamster-note/painting/core'
import type { ReactNode, RefObject } from 'react'

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

const DRAWING_TOOLS: readonly (readonly [LayeredEditorTool, string])[] = [
  ['freehand', '自由笔'],
  ['line', '直线'],
  ['rect', '矩形'],
  ['ellipse', '椭圆'],
  ['polygon', '多边形'],
  ['bezier', '贝塞尔'],
  ['text', '文字'],
  ['image', '图片'],
  ['selection', '选择'],
  ['lasso', '套索'],
  ['eraser', '橡皮擦']
]

type DrawingBottomBarStackProps = {
  readonly bottomBarRef: RefObject<HTMLDivElement | null>
  readonly readerToolbar: ReactNode
  readonly paintingSettings: LayeredToolsSnapshot
  readonly theme: 'light' | 'dark'
  readonly onPaintingSettingsChange: (data: LayeredToolsSnapshot) => void
}

export function DrawingBottomBarStack(props: DrawingBottomBarStackProps) {
  return (
    <div
      ref={props.bottomBarRef}
      className='hamster-reader__bottom-bar-stack hamster-reader__bottom-bar-stack--drawing'
    >
      {props.readerToolbar}
      <div
        role='toolbar'
        aria-label='绘图工具'
        data-theme={props.theme}
        className='hamster-reader__drawing-toolbar'
      >
        {DRAWING_TOOLS.map(([tool, label]) => (
          <button
            key={tool}
            type='button'
            aria-label={label}
            aria-pressed={props.paintingSettings.activeTool === tool}
            onClick={() =>
              props.onPaintingSettingsChange({
                ...props.paintingSettings,
                activeTool: tool
              })
            }
          >
            {label}
          </button>
        ))}
        <label>
          绘图颜色
          <input
            type='color'
            aria-label='绘图颜色'
            value={props.paintingSettings.settings.freehand.color}
            onChange={(event) =>
              props.onPaintingSettingsChange({
                ...props.paintingSettings,
                settings: {
                  freehand: {
                    ...props.paintingSettings.settings.freehand,
                    color: event.target.value
                  },
                  shape: {
                    ...props.paintingSettings.settings.shape,
                    color: event.target.value
                  }
                }
              })
            }
          />
        </label>
        <label>
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
      </div>
    </div>
  )
}

type BottomBarColorControlsProps = {
  readonly colors: readonly ReaderColorOption[]
  readonly renderMode: ReaderRenderMode
  readonly drawingStrokeColor: string
  readonly highlightColor: string | undefined
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
        aria-label={`${name}工具颜色`}
        aria-pressed={isSelected}
        data-testid={`tool-bottom-bar-color-${name}`}
        onClick={() => {
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
