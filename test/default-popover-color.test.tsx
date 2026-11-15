import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DefaultHighlightPopover } from '../src/components/DefaultPopover'
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
  it('uses keyboard-reachable swatches with a selected state instead of a native color well', () => {
    render(
      <DefaultHighlightPopover
        selectionRef={selectionRef}
        highlightColor='#ffc107'
        selectedRangeId='saved'
        ranges={[range]}
      />
    )

    expect(
      screen.getByRole('group', { name: 'Highlight color' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Highlight color #ffc107' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'Highlight color #00ff00' })
    ).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('input[type="color"]')).toBeNull()
  })

  it('keeps a custom current color visible and selected', () => {
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

    expect(
      screen.getByRole('button', { name: 'Highlight color #ff3366' })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('commits through the existing callback after toolbar mousedown and from the keyboard', async () => {
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
      name: 'Highlight color #00ff00'
    })

    fireEvent.mouseDown(screen.getByRole('toolbar', { name: '高亮操作' }))
    fireEvent.click(green)
    expect(onHighlightColorChange).toHaveBeenLastCalledWith('#00ff00')
    expect(onUpdateRange).toHaveBeenLastCalledWith({
      ...range,
      markerStyle: { ...range.markerStyle, backgroundColor: '#00ff00' }
    })

    const blue = screen.getByRole('button', {
      name: 'Highlight color #0000ff'
    })
    blue.focus()
    await user.keyboard('{Enter}')
    expect(onHighlightColorChange).toHaveBeenLastCalledWith('#0000ff')
    expect(onUpdateRange).toHaveBeenCalledTimes(2)
  })
})
