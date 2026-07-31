import { Button, Icon } from '@hamster-note/components'

import type { ReaderRenderMode } from '../Reader'

type DefaultBottomBarModeControlsProps = {
  readonly renderMode: ReaderRenderMode
  readonly ocrEnabled: boolean
  readonly onRenderModeChange: (mode: ReaderRenderMode) => void
  readonly onOcrChange: (enabled: boolean) => void
}

export function DefaultBottomBarModeControls({
  renderMode,
  ocrEnabled,
  onRenderModeChange,
  onOcrChange
}: DefaultBottomBarModeControlsProps) {
  const layoutDisabled = renderMode === 'text'

  return (
    <>
      <Button
        type='button'
        size='small'
        variant={renderMode === 'text' ? 'primary' : 'ghost'}
        aria-label={
          renderMode === 'layout' ? '切换到文字渲染模式' : '切换到布局渲染模式'
        }
        aria-pressed={renderMode === 'text'}
        data-testid='tool-bottom-bar-render-mode'
        onClick={() =>
          onRenderModeChange(renderMode === 'layout' ? 'text' : 'layout')
        }
      >
        <Icon name='switch' />
      </Button>
      {!layoutDisabled && (
        <Button
          type='button'
          size='small'
          variant={ocrEnabled ? 'primary' : 'ghost'}
          aria-label='OCR'
          aria-pressed={ocrEnabled}
          data-testid='tool-bottom-bar-ocr'
          onClick={() => onOcrChange(!ocrEnabled)}
        >
          OCR
        </Button>
      )}
    </>
  )
}
