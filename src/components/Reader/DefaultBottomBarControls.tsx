import { Button, Icon } from '@hamster-note/components'
import {
  PaintingController,
  type PaintingControllerData
} from '@hamster-note/painting'
import type { ReactNode, RefObject } from 'react'

import type {
  ReaderAnnotationHistoryStatus,
  ReaderSelectionRef
} from '../../types/selection'
import type { ReaderPageTool } from '../Page'
import {
  DEFAULT_BOTTOM_BAR_COLORS,
  DEFAULT_BOTTOM_BAR_TOOLS,
  getTranslucentColor
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

type DrawingBottomBarStackProps = {
  readonly bottomBarRef: RefObject<HTMLDivElement | null>
  readonly readerToolbar: ReactNode
  readonly paintingControllerData: PaintingControllerData
  readonly theme: 'light' | 'dark'
  readonly onPaintingControllerDataChange: (
    data: PaintingControllerData
  ) => void
}

export function DrawingBottomBarStack(props: DrawingBottomBarStackProps) {
  return (
    <div
      ref={props.bottomBarRef}
      className='hamster-reader__bottom-bar-stack hamster-reader__bottom-bar-stack--drawing'
    >
      {props.readerToolbar}
      <PaintingController
        data={props.paintingControllerData}
        onDataChange={props.onPaintingControllerDataChange}
        theme={props.theme}
        edgeOffset={64}
        multiBoard
        relative
        style={{
          boxSizing: 'border-box',
          maxWidth: 'calc(100% - 16px)',
          overflowX: 'auto'
        }}
      />
    </div>
  )
}

type BottomBarColorControlsProps = {
  readonly drawingStrokeColor: string
  readonly onDrawingStrokeColorChange: (color: string) => void
  readonly onHighlightColorChange: ((color: string) => void) | undefined
}

export function BottomBarColorControls(props: BottomBarColorControlsProps) {
  return DEFAULT_BOTTOM_BAR_COLORS.map(({ name, label, value }) => (
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
          props.drawingStrokeColor === value ? 'currentColor' : 'transparent'
      }}
    />
  ))
}
