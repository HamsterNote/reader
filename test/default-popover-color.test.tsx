import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  DefaultHighlightPopover,
  DefaultSelectionPopover
} from '../src/components/DefaultPopover'
import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '../src/types/selection'

const range = {
  id: 'saved',
  createdAt: 1,
  text: 'QA',
  start: { selectionId: 'page-1', offset: 4 },
  end: { selectionId: 'page-1', offset: 6 },
  overlayRectType: 'px',
  markerStyle: { backgroundColor: '#ffc107', opacity: 0.5 },
  rectsBySelectionId: {
    'page-1': [{ x: 40, y: 50, width: 320, height: 50 }]
  }
} as ReaderSelectionRange

const selectionRef = {
  current: {
    confirm: vi.fn()
  } as unknown as ReaderSelectionRef
}

describe('DefaultHighlightPopover color palette', () => {
  it('renders the six bottom-bar presets and a final custom color action', () => {
    const preset = {
      ...range,
      markerStyle: { ...range.markerStyle, backgroundColor: '#7d9ec0' }
    } as ReaderSelectionRange
    render(
      <DefaultHighlightPopover
        selectionRef={selectionRef}
        highlightColor='#7d9ec0'
        selectedRangeId='saved'
        ranges={[preset]}
      />
    )

    const group = screen.getByRole('group', { name: 'Highlight color' })
    const swatches = within(group).getAllByRole('button')
    expect(swatches).toHaveLength(7)
    expect(swatches[0]).toHaveAccessibleName('Highlight color #7d9ec0')
    expect(swatches[0]).toHaveAttribute('aria-pressed', 'true')
    expect(swatches[5]).toHaveAccessibleName('Highlight color #2a2a2a')
    expect(swatches[5]).toHaveAttribute('aria-pressed', 'false')
    expect(swatches[6]).toHaveAccessibleName('自由选色')
    expect(swatches[6]).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByLabelText('自定义高亮颜色')).toHaveValue(
      '#7d9ec0'
    )
  })

  it('keeps a custom current color visible and selected on the final action', () => {
    const custom = {
      ...range,
      markerStyle: { backgroundColor: '#ff3366' }
    } as ReaderSelectionRange
    render(
      <DefaultHighlightPopover
        selectionRef={selectionRef}
        highlightColor='#ffc107'
        selectedRangeId='saved'
        ranges={[custom]}
      />
    )

    const customButton = screen.getByRole('button', { name: '自由选色' })
    expect(customButton).toHaveAttribute('aria-pressed', 'true')
    expect(customButton).toHaveAttribute('data-color', '#ff3366')
    expect(screen.getByLabelText('自定义高亮颜色')).toHaveValue('#ff3366')
  })

  it('opens the native color input from the custom color action', async () => {
    const user = userEvent.setup()
    const inputClick = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined)
    render(
      <DefaultHighlightPopover
        selectionRef={selectionRef}
        highlightColor='#ffc107'
        selectedRangeId='saved'
        ranges={[range]}
      />
    )

    await user.click(screen.getByRole('button', { name: '自由选色' }))

    expect(inputClick).toHaveBeenCalledOnce()
    inputClick.mockRestore()
  })

  it('commits presets through the existing callback after toolbar mousedown and from the keyboard', async () => {
    const user = userEvent.setup()
    const onHighlightColorChange = vi.fn()
    const onUpdateRange = vi.fn()
    render(
      <DefaultHighlightPopover
        selectionRef={selectionRef}
        highlightColor='#ffc107'
        onHighlightColorChange={onHighlightColorChange}
        selectedRangeId='saved'
        ranges={[range]}
        onUpdateRange={onUpdateRange}
      />
    )
    const green = screen.getByRole('button', {
      name: 'Highlight color #8eba8e'
    })

    fireEvent.mouseDown(screen.getByRole('toolbar', { name: '高亮操作' }))
    fireEvent.click(green)
    expect(onHighlightColorChange).toHaveBeenLastCalledWith('#8eba8e')
    expect(onUpdateRange).toHaveBeenLastCalledWith({
      ...range,
      markerStyle: { ...range.markerStyle, backgroundColor: '#8eba8e' }
    })

    const blue = screen.getByRole('button', {
      name: 'Highlight color #7d9ec0'
    })
    blue.focus()
    await user.keyboard('{Enter}')
    expect(onHighlightColorChange).toHaveBeenLastCalledWith('#7d9ec0')
    expect(onUpdateRange).toHaveBeenCalledTimes(2)
  })

  it('commits a custom color to the global color and selected range', () => {
    const onHighlightColorChange = vi.fn()
    const onUpdateRange = vi.fn()
    render(
      <DefaultHighlightPopover
        selectionRef={selectionRef}
        highlightColor='#ffc107'
        onHighlightColorChange={onHighlightColorChange}
        selectedRangeId='saved'
        ranges={[range]}
        onUpdateRange={onUpdateRange}
      />
    )

    fireEvent.change(screen.getByLabelText('自定义高亮颜色'), {
      target: { value: '#123456' }
    })

    expect(onHighlightColorChange).toHaveBeenCalledExactlyOnceWith('#123456')
    expect(onUpdateRange).toHaveBeenCalledExactlyOnceWith({
      ...range,
      markerStyle: { ...range.markerStyle, backgroundColor: '#123456' }
    })
  })

  it('uses the same custom color action in the selection popover', () => {
    const onHighlightColorChange = vi.fn()
    const onUpdateRange = vi.fn()
    render(
      <DefaultSelectionPopover
        selectionRef={selectionRef}
        highlightColor='#ffc107'
        onHighlightColorChange={onHighlightColorChange}
        selectedRangeId='saved'
        ranges={[range]}
        onUpdateRange={onUpdateRange}
      />
    )

    fireEvent.change(screen.getByLabelText('自定义高亮颜色'), {
      target: { value: '#654321' }
    })

    expect(onHighlightColorChange).toHaveBeenCalledExactlyOnceWith('#654321')
    expect(onUpdateRange).not.toHaveBeenCalled()
  })
})
