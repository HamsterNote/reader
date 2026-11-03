import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DrawingBottomBarStack } from '../src/components/Reader/DefaultBottomBarControls'
import { createPaintingSettings } from '../src/painting/paintingSettings'

const renderToolbar = (
  onPaintingSettingsChange = vi.fn(),
  colors = [{ name: 'brand', color: '#123456' }]
) => {
  const paintingSettings = createPaintingSettings()
  render(
    <DrawingBottomBarStack
      bottomBarRef={createRef<HTMLDivElement>()}
      readerToolbar={<div>Reader tools</div>}
      paintingSettings={paintingSettings}
      colors={colors}
      theme='light'
      onPaintingSettingsChange={onPaintingSettingsChange}
    />
  )
  return { onPaintingSettingsChange, paintingSettings }
}

describe('DrawingBottomBarStack', () => {
  it('preserves all brush settings when changing the active tool', () => {
    const onPaintingSettingsChange = vi.fn()
    const { paintingSettings } = renderToolbar(onPaintingSettingsChange)
    const freehand = screen.getByRole('button', { name: '自由笔' })
    const rectangle = screen.getByRole('button', { name: '矩形' })

    expect(freehand).toHaveAttribute('aria-pressed', 'true')
    expect(freehand.className).toContain('hn-button--primary')
    fireEvent.click(rectangle)

    expect(onPaintingSettingsChange).toHaveBeenCalledWith({
      ...paintingSettings,
      activeTool: 'rect'
    })
    expect(rectangle).toHaveAttribute('aria-pressed', 'false')
    expect(rectangle.className).toContain('hn-button--ghost')
  })

  it('uses the shared color list and changes only the painting snapshot colors', () => {
    const onPaintingSettingsChange = vi.fn()
    const { paintingSettings } = renderToolbar(onPaintingSettingsChange)
    const color = screen.getByRole('button', { name: '绘图brand颜色' })

    expect(color).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(color)

    expect(onPaintingSettingsChange).toHaveBeenCalledWith({
      ...paintingSettings,
      settings: {
        freehand: { ...paintingSettings.settings.freehand, color: '#123456' },
        shape: { ...paintingSettings.settings.shape, color: '#123456' }
      }
    })
  })

  it('updates both brush widths and ignores incomplete or invalid input', () => {
    const onPaintingSettingsChange = vi.fn()
    const { paintingSettings } = renderToolbar(onPaintingSettingsChange)
    const width = screen.getByRole('spinbutton', { name: '绘图笔宽' })

    expect(width).toHaveAttribute('min', '0.5')
    expect(width).toHaveAttribute('max', '200')
    expect(width).toHaveAttribute('step', '0.5')
    fireEvent.change(width, { target: { value: '7.5' } })
    expect(onPaintingSettingsChange).toHaveBeenLastCalledWith({
      ...paintingSettings,
      settings: {
        freehand: { ...paintingSettings.settings.freehand, nominalSize: 7.5 },
        shape: { ...paintingSettings.settings.shape, width: 7.5 }
      }
    })

    fireEvent.change(width, { target: { value: '' } })
    fireEvent.change(width, { target: { value: '0' } })
    expect(onPaintingSettingsChange).toHaveBeenCalledTimes(1)
  })
})
